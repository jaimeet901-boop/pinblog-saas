/**
 * Pin Generation Pipeline — orchestrator only.
 * Coordinates Content → Variables → AI Image Provider → Template (read-only clone)
 * → Renderer → Export Engine → Final Pin.
 *
 * Does NOT implement provider / variable / render / export logic.
 * Does NOT mutate templates (deep-clones configuration).
 */

import {
	PIN_GENERATION_IMAGE_MODES,
	PIN_GENERATION_RECOVERABLE_CODES,
	isTerminalGenerationStage,
	stageProgress,
} from './pinGenerationConstants.js';

export class PinGenerationError extends Error {
	constructor(message, { code = 'GENERATION_ERROR', recoverable = false, cause = null } = {}) {
		super(message);
		this.name = 'PinGenerationError';
		this.code = code;
		this.recoverable = recoverable || PIN_GENERATION_RECOVERABLE_CODES.includes(code);
		this.cause = cause;
	}
}

function deepClone(value) {
	return JSON.parse(JSON.stringify(value ?? null));
}

function throwIfAborted(signal) {
	if (signal?.aborted) {
		const err = new PinGenerationError('Generation cancelled', {
			code: 'CANCELLED',
			recoverable: false,
		});
		throw err;
	}
}

/**
 * Build a step log entry (immutable append pattern).
 */
export function createStepLog(stage, status, detail = {}) {
	return {
		stage,
		status,
		at: new Date().toISOString(),
		...detail,
	};
}

/**
 * Validate generation choices without calling modules.
 */
export function validateGenerationRequest(request = {}) {
	const issues = [];
	const imageMode = String(request.imageMode || 'generate_ai');
	if (!PIN_GENERATION_IMAGE_MODES.includes(imageMode)) {
		issues.push({ field: 'imageMode', reason: 'invalid', value: imageMode });
	}
	if (imageMode === 'use_featured' && !String(request.featuredImageUrl || '').trim()) {
		issues.push({ field: 'featuredImageUrl', reason: 'required_for_featured_mode' });
	}
	if (imageMode === 'provided_url' && !String(request.imageUrl || '').trim()) {
		issues.push({ field: 'imageUrl', reason: 'required_for_provided_url' });
	}
	if (!request.templateConfiguration && !request.templateId && !request.templateSnapshot) {
		issues.push({ field: 'template', reason: 'templateId_or_configuration_required' });
	}
	const format = String(request.format || request.outputFormat || 'png').toLowerCase();
	if (!format) {
		issues.push({ field: 'format', reason: 'required' });
	}
	return {
		ok: issues.length === 0,
		issues,
		normalized: {
			imageMode,
			templateId: request.templateId || null,
			exportProfileId: request.exportProfileId || request.profileId || 'pinterest_standard',
			format,
			content: request.content || {},
			variables: request.variables || {},
			brandKit: request.brandKit || null,
			featuredImageUrl: request.featuredImageUrl || '',
			imageUrl: request.imageUrl || '',
			extensions: request.extensions || {},
		},
	};
}

/**
 * Clone template configuration for a run — never mutates the source object.
 */
export function cloneTemplateForGeneration(configuration) {
	if (!configuration || typeof configuration !== 'object') {
		throw new PinGenerationError('Template configuration missing', {
			code: 'TEMPLATE_MISSING',
			recoverable: false,
		});
	}
	return deepClone(configuration);
}

/**
 * Inject generated/featured image into variable context (content layer).
 * Does not write into the template document permanently — returns a new context.
 */
export function buildGenerationVariableContext({
	content = {},
	variables = {},
	imageUrl = '',
	brandKit = null,
}) {
	const ctx = {
		...deepClone(content),
		...deepClone(variables),
		image: imageUrl || content.image || variables.image || '',
		title: content.title || variables.title || '',
		subtitle: content.subtitle || variables.subtitle || '',
		description: content.description || variables.description || '',
		overlayText: content.overlayText || variables.overlayText || '',
		category: content.category || variables.category || '',
		website: content.website || variables.website || brandKit?.websiteUrl || '',
		author: content.author || variables.author || '',
	};
	if (brandKit) {
		ctx.brand = {
			...(ctx.brand || {}),
			logo: brandKit.logoUrl || brandKit.logo || ctx.brand?.logo,
			primary_color: brandKit.primaryColor || brandKit.primary_color,
			watermark: brandKit.watermarkText || brandKit.watermark,
		};
		if (brandKit.logoUrl) ctx.logo = brandKit.logoUrl;
	}
	if (imageUrl) {
		ctx.post = { ...(ctx.post || {}), image: imageUrl, title: ctx.title };
	}
	return ctx;
}

/**
 * Classify errors for retry policy.
 */
export function classifyGenerationError(error) {
	const code = error?.code || error?.errorCode || '';
	const message = String(error?.message || error || '');
	if (code === 'CANCELLED' || /cancel/i.test(message)) {
		return { code: 'CANCELLED', recoverable: false };
	}
	if (PIN_GENERATION_RECOVERABLE_CODES.includes(code)) {
		return { code, recoverable: true };
	}
	if (/timeout|ETIMEDOUT|aborted/i.test(message)) {
		return { code: 'PROVIDER_TIMEOUT', recoverable: true };
	}
	if (/rate.?limit|429/i.test(message)) {
		return { code: 'PROVIDER_RATE_LIMIT', recoverable: true };
	}
	if (/network|ECONNRESET|fetch failed|502|503|504/i.test(message)) {
		return { code: 'NETWORK_ERROR', recoverable: true };
	}
	if (/upload/i.test(message)) {
		return { code: 'UPLOAD_TRANSIENT', recoverable: true };
	}
	return { code: code || 'GENERATION_ERROR', recoverable: false };
}

/**
 * Compute next retry delay (ms) — exponential backoff.
 */
export function nextRetryDelayMs(attemptCount = 1) {
	const attempt = Math.max(1, Number(attemptCount) || 1);
	return Math.min(300_000, attempt * 60_000);
}

/**
 * Core orchestrator. Adapters inject module implementations.
 *
 * @param {object} request
 * @param {object} adapters
 * @param {Function} adapters.onStage - (stage, meta) => void|Promise
 * @param {Function} adapters.logStep - (entry) => void|Promise
 * @param {Function} [adapters.loadTemplate] - () => configuration (read-only source)
 * @param {Function} [adapters.generateImage] - ({ provider, content, signal }) => { imageUrl }
 * @param {Function} [adapters.resolveVariables] - (document, context) => document|context
 * @param {Function} adapters.exportPin - ({ document, profileId, format, variables, signal }) => { bytes, mimeType, format, ... }
 * @param {Function} [adapters.uploadResult] - ({ bytes, mimeType }) => { imageUrl }
 * @param {AbortSignal} [adapters.signal]
 */
export async function runPinGenerationPipeline(request = {}, adapters = {}) {
	const started = Date.now();
	const signal = adapters.signal || request.signal || null;
	const steps = [];

	async function setStage(stage, meta = {}) {
		throwIfAborted(signal);
		if (typeof adapters.onStage === 'function') {
			await adapters.onStage(stage, {
				progress: stageProgress(stage),
				...meta,
			});
		}
		const entry = createStepLog(stage, meta.status || 'started', meta);
		steps.push(entry);
		if (typeof adapters.logStep === 'function') {
			await adapters.logStep(entry);
		}
	}

	const validation = validateGenerationRequest(request);
	if (!validation.ok) {
		throw new PinGenerationError('Invalid generation request', {
			code: 'VALIDATION_ERROR',
			recoverable: false,
			cause: validation.issues,
		});
	}
	const plan = validation.normalized;

	await setStage('preparing', { status: 'started' });

	let templateConfiguration = request.templateSnapshot
		? deepClone(request.templateSnapshot)
		: null;
	if (!templateConfiguration && typeof adapters.loadTemplate === 'function') {
		const loaded = await adapters.loadTemplate({
			templateId: plan.templateId,
			readOnly: true,
		});
		templateConfiguration = cloneTemplateForGeneration(loaded);
	} else if (!templateConfiguration && request.templateConfiguration) {
		templateConfiguration = cloneTemplateForGeneration(request.templateConfiguration);
	}
	if (!templateConfiguration) {
		throw new PinGenerationError('Template configuration unavailable', {
			code: 'TEMPLATE_MISSING',
			recoverable: false,
		});
	}

	await setStage('preparing', {
		status: 'completed',
		templateId: plan.templateId,
		exportProfileId: plan.exportProfileId,
		format: plan.format,
	});

	// --- Image acquisition (AI provider interface or featured/url) ---
	let imageUrl = '';
	if (plan.imageMode === 'generate_ai') {
		await setStage('generating_image', {
			status: 'started',
		});
		if (typeof adapters.generateImage !== 'function') {
			throw new PinGenerationError('generateImage adapter required for generate_ai', {
				code: 'ADAPTER_MISSING',
				recoverable: false,
			});
		}
		const generated = await adapters.generateImage({
			content: plan.content,
			prompt: request.prompt || plan.content.imagePrompt || '',
			signal,
		});
		imageUrl = String(generated?.imageUrl || '').trim();
		if (!imageUrl) {
			throw new PinGenerationError('AI image provider returned no imageUrl', {
				code: 'PROVIDER_EMPTY',
				recoverable: true,
			});
		}
		await setStage('generating_image', { status: 'completed', imageUrl });
	} else if (plan.imageMode === 'use_featured') {
		await setStage('generating_image', { status: 'skipped', reason: 'use_featured' });
		imageUrl = plan.featuredImageUrl;
	} else {
		await setStage('generating_image', { status: 'skipped', reason: 'provided_url' });
		imageUrl = plan.imageUrl;
	}

	throwIfAborted(signal);

	// --- Variables ---
	await setStage('resolving_variables', { status: 'started' });
	const variableContext = buildGenerationVariableContext({
		content: plan.content,
		variables: plan.variables,
		imageUrl,
		brandKit: plan.brandKit,
	});
	let documentForExport = templateConfiguration;
	if (typeof adapters.resolveVariables === 'function') {
		const resolved = await adapters.resolveVariables(templateConfiguration, variableContext);
		// Adapter may return document or { document, context }
		if (resolved?.document) {
			documentForExport = resolved.document;
		} else if (resolved && resolved.layers) {
			documentForExport = resolved;
		}
		// Always keep original clone intact — resolveVariables should not mutate input;
		// if it does, we already cloned earlier.
	}
	await setStage('resolving_variables', {
		status: 'completed',
		variableKeys: Object.keys(variableContext),
	});

	throwIfAborted(signal);

	// --- Render + Export (Export Engine owns RenderTarget; compositor inside) ---
	await setStage('rendering', { status: 'started' });
	if (typeof adapters.exportPin !== 'function') {
		throw new PinGenerationError('exportPin adapter required', {
			code: 'ADAPTER_MISSING',
			recoverable: false,
		});
	}

	// Notify rendering then exporting around the single export call
	await setStage('exporting', { status: 'started', profileId: plan.exportProfileId });

	const exported = await adapters.exportPin({
		document: documentForExport,
		configuration: documentForExport,
		profileId: plan.exportProfileId,
		format: plan.format,
		variables: variableContext,
		brandKit: plan.brandKit,
		signal,
	});

	await setStage('rendering', { status: 'completed' });
	await setStage('exporting', {
		status: 'completed',
		format: exported?.format,
		byteLength: exported?.bytes?.byteLength ?? exported?.bytes?.length ?? 0,
	});

	throwIfAborted(signal);

	let finalImageUrl = exported?.imageUrl || '';
	if (!finalImageUrl && typeof adapters.uploadResult === 'function' && exported?.bytes) {
		const uploaded = await adapters.uploadResult({
			bytes: exported.bytes,
			mimeType: exported.mimeType,
			format: exported.format,
		});
		finalImageUrl = uploaded?.imageUrl || '';
	}

	await setStage('completed', {
		status: 'completed',
		imageUrl: finalImageUrl,
		durationMs: Date.now() - started,
	});

	return {
		ok: true,
		stage: 'completed',
		imageUrl: finalImageUrl,
		bytes: exported?.bytes || null,
		mimeType: exported?.mimeType || null,
		format: exported?.format || plan.format,
		profileId: plan.exportProfileId,
		templateId: plan.templateId,
		variableContext,
		/** Cloned template used — never the live DB record. */
		templateSnapshot: templateConfiguration,
		steps,
		durationMs: Date.now() - started,
		extensions: plan.extensions,
	};
}

/**
 * Extension-point helpers (no-op factories for future Module 8+).
 */
export const pinGenerationExtensions = {
	/** Batch: map items → independent pipeline requests sharing correlationId. */
	buildBatchRequests(items = [], shared = {}) {
		const correlationId = shared.correlationId || `batch_${Date.now()}`;
		return items.map((item, index) => ({
			...shared,
			...item,
			extensions: {
				...(shared.extensions || {}),
				...(item.extensions || {}),
				batchId: correlationId,
				batchIndex: index,
			},
		}));
	},

	/** A/B: attach variant metadata without altering template records. */
	withTemplateVariant(request, { variantId, abGroup } = {}) {
		return {
			...request,
			extensions: {
				...(request.extensions || {}),
				variantId: variantId || null,
				abGroup: abGroup || null,
			},
		};
	},

	/** Multi-language: locale rides in extensions + variables. */
	withLocale(request, locale) {
		return {
			...request,
			variables: { ...(request.variables || {}), locale },
			extensions: { ...(request.extensions || {}), locale },
		};
	},

	/** Scheduled generation: defer execution metadata only. */
	withSchedule(request, scheduleAt) {
		return {
			...request,
			extensions: { ...(request.extensions || {}), scheduleAt },
		};
	},

	/** Team workspace: tag run with teamId (RBAC enforced at API). */
	withTeamWorkspace(request, { workspaceId, teamId } = {}) {
		return {
			...request,
			extensions: {
				...(request.extensions || {}),
				workspaceId: workspaceId || null,
				teamId: teamId || null,
			},
		};
	},
};

export { isTerminalGenerationStage, stageProgress };
