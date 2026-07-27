/**
 * Pin Generation runs — metadata store + lifecycle (API).
 * Orchestrates existing modules; never writes to ai_pin_templates.
 */

import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import { httpError } from '../middleware/require-admin.js';
import { enqueueJob } from './queue/index.js';
import {
	PIN_GENERATION_IMAGE_MODES,
	PIN_GENERATION_RECOVERABLE_CODES,
	isPinGenerationStage,
	isTerminalGenerationStage,
	stageProgress,
	isRecoverableGenerationError,
} from '../constants/pin-generation.js';

function deepClone(value) {
	return JSON.parse(JSON.stringify(value ?? null));
}

function nowIso() {
	return new Date().toISOString();
}

function createStep(stage, status, detail = {}) {
	return {
		stage,
		status,
		at: nowIso(),
		...detail,
	};
}

export function mapGenerationRun(record, options = {}) {
	if (!record) return null;
	const steps = Array.isArray(record.steps) ? record.steps : [];
	const result = record.result && typeof record.result === 'object' ? record.result : {};
	const extensions = record.extensions && typeof record.extensions === 'object' ? record.extensions : {};
	const requestSnapshot = record.request_snapshot && typeof record.request_snapshot === 'object'
		? record.request_snapshot
		: {};
	return {
		id: record.id,
		owner: record.owner,
		workspaceId: record.workspace_id || null,
		status: record.status,
		stage: record.stage,
		progress: Number(record.progress) || stageProgress(record.stage),
		templateId: record.template_id || null,
		templateUuid: record.template_uuid || null,
		templateChecksum: record.template_checksum || null,
		exportProfileId: record.export_profile_id || 'pinterest_standard',
		outputFormat: record.output_format || 'png',
		imageProvider: record.image_provider || null,
		imageMode: record.image_mode || 'generate_ai',
		imageJobId: record.image_job_id || null,
		aiPinId: record.ai_pin_id || null,
		articleId: record.article_id || null,
		clientToken: record.client_token || null,
		requestSnapshot,
		hasTemplateSnapshot: Boolean(record.template_snapshot),
		templateSnapshot: options.includeSnapshot ? deepClone(record.template_snapshot) : undefined,
		steps,
		result,
		lastError: record.last_error || '',
		errorCode: record.error_code || '',
		attemptCount: Number(record.attempt_count) || 0,
		maxAttempts: Number(record.max_attempts) || 3,
		nextRetryAt: record.next_retry_at || null,
		extensions,
		correlationId: record.correlation_id || null,
		startedAt: record.started_at || null,
		completedAt: record.completed_at || null,
		cancelledAt: record.cancelled_at || null,
		createdAt: record.created,
		updatedAt: record.updated,
	};
}

async function getOwnedRun(owner, id) {
	const record = await pocketbaseClient.collection('ai_pin_generation_runs').getOne(id).catch(() => null);
	if (!record || record.owner !== owner || record.deleted_at) {
		throw httpError(404, 'Generation run not found', 'NOT_FOUND');
	}
	return record;
}

/**
 * Load template configuration read-only. Never updates the template record.
 */
export async function loadTemplateSnapshotReadOnly(owner, templateId) {
	if (!templateId) return null;
	const template = await pocketbaseClient.collection('ai_pin_templates').getOne(templateId).catch(() => null);
	if (!template) {
		throw httpError(404, 'Template not found', 'TEMPLATE_NOT_FOUND');
	}
	// Workspace templates may be shared; official/public allowed; private must match owner or workspace later.
	const configuration = deepClone(template.configuration || {});
	return {
		templateId: template.id,
		templateUuid: template.template_uuid || null,
		templateChecksum: template.config_checksum || null,
		name: template.name,
		editorVersion: template.editor_version || 1,
		schemaVersion: template.schema_version || 1,
		configuration,
	};
}

export async function createGenerationRun(req, body = {}) {
	const { stampCreateOwnership, getWorkspaceActor } = await import('./workspace-ownership.js');
	const actor = getWorkspaceActor(req);
	const owner = actor.workspaceOwnerId || req.pocketbaseUserId;
	if (!owner) throw httpError(401, 'Please sign in', 'UNAUTHENTICATED');

	const imageMode = String(body.imageMode || 'generate_ai');
	if (!PIN_GENERATION_IMAGE_MODES.includes(imageMode)) {
		throw httpError(422, 'Invalid imageMode', 'VALIDATION_ERROR');
	}

	const exportProfileId = String(body.exportProfileId || body.profileId || 'pinterest_standard');
	const outputFormat = String(body.format || body.outputFormat || 'png').toLowerCase();
	const imageProvider = body.imageProvider || body.provider || null;
	const maxAttempts = Math.min(8, Math.max(1, Number(body.maxAttempts) || 3));

	let templateMeta = null;
	let templateSnapshot = body.templateSnapshot || body.templateConfiguration || null;
	if (body.templateId) {
		templateMeta = await loadTemplateSnapshotReadOnly(owner, body.templateId);
		if (!templateSnapshot) {
			templateSnapshot = templateMeta.configuration;
		}
	}
	if (!templateSnapshot || typeof templateSnapshot !== 'object') {
		throw httpError(422, 'templateId or templateConfiguration required', 'VALIDATION_ERROR');
	}
	// Always store a clone — generation metadata owns the copy.
	templateSnapshot = deepClone(templateSnapshot);

	const requestSnapshot = {
		content: body.content || {},
		variables: body.variables || {},
		brandKit: body.brandKit || null,
		featuredImageUrl: body.featuredImageUrl || '',
		imageUrl: body.imageUrl || '',
		prompt: body.prompt || '',
		choices: {
			templateId: body.templateId || templateMeta?.templateId || null,
			exportProfileId,
			imageProvider,
			outputFormat,
			imageMode,
		},
	};

	const steps = [createStep('queued', 'started')];
	const extensions = {
		...(body.extensions && typeof body.extensions === 'object' ? body.extensions : {}),
		// Extension points reserved
		batchId: body.batchId || body.extensions?.batchId || null,
		variantId: body.variantId || body.extensions?.variantId || null,
		locale: body.locale || body.extensions?.locale || null,
		scheduleAt: body.scheduleAt || body.extensions?.scheduleAt || null,
		teamId: body.teamId || body.extensions?.teamId || null,
	};

	const record = await pocketbaseClient.collection('ai_pin_generation_runs').create(stampCreateOwnership(req, {
		owner,
		created_by: actor.creatorId || owner,
		workspace_id: req.workspace?.id || body.workspaceId || null,
		status: 'queued',
		stage: 'queued',
		progress: 0,
		template_id: templateMeta?.templateId || body.templateId || '',
		template_uuid: templateMeta?.templateUuid || body.templateUuid || '',
		template_checksum: templateMeta?.templateChecksum || body.templateChecksum || '',
		export_profile_id: exportProfileId,
		output_format: outputFormat,
		image_provider: imageProvider || '',
		image_mode: imageMode,
		image_job_id: '',
		ai_pin_id: body.aiPinId || body.pinId || '',
		article_id: body.articleId || '',
		client_token: body.clientToken || '',
		request_snapshot: requestSnapshot,
		template_snapshot: templateSnapshot,
		steps,
		result: {},
		last_error: '',
		error_code: '',
		attempt_count: 0,
		max_attempts: maxAttempts,
		next_retry_at: null,
		extensions,
		correlation_id: body.correlationId || extensions.batchId || '',
		started_at: nowIso(),
		completed_at: null,
		cancelled_at: null,
		deleted_at: null,
	}));

	logger.info('[pin-generation] run created', {
		runId: record.id,
		owner,
		imageMode,
		exportProfileId,
		outputFormat,
		templateId: record.template_id || null,
	});

	await recordGenerationHistoryEvent(owner, {
		event_type: 'image',
		title: 'Pin generation run created',
		metadata: {
			module: 'pin_generation',
			runId: record.id,
			stage: 'queued',
			imageMode,
			exportProfileId,
			outputFormat,
			imageProvider,
		},
	});

	// Background queue mirror (architecture-ready worker)
	if (body.enqueue !== false) {
		await enqueueJob({
			owner,
			workspaceKey: req.workspace?.id || '',
			type: 'template_rendering',
			priority: body.priority || 'normal',
			payload: {
				kind: 'pin_generation_run',
				runId: record.id,
				clientComposeRequired: true,
			},
			sourceCollection: 'ai_pin_generation_runs',
			sourceId: record.id,
			correlationId: record.correlation_id || record.id,
			meta: {
				module: 'pin_generation',
				stage: 'queued',
			},
		}).catch((err) => {
			logger.warn('[pin-generation] queue mirror failed', { error: err?.message, runId: record.id });
		});
	}

	return mapGenerationRun(record, { includeSnapshot: true });
}

async function recordGenerationHistoryEvent(owner, payload) {
	try {
		const { recordGenerationHistory } = await import('./ai-pin-credits.js');
		await recordGenerationHistory(pocketbaseClient, {
			owner,
			...payload,
		});
	} catch {
		/* history is best-effort */
	}
}

export async function getGenerationRun(req, id) {
	const record = await getOwnedRun(req.pocketbaseUserId, id);
	const includeSnapshot = req.query?.includeSnapshot === '1' || req.query?.includeSnapshot === 'true';
	return mapGenerationRun(record, { includeSnapshot: includeSnapshot || true });
}

export async function listGenerationRuns(req, query = {}) {
	const owner = req.pocketbaseUserId;
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(50, Math.max(1, Number(query.perPage) || 20));
	const status = query.status ? String(query.status) : '';
	const parts = [`owner = "${owner}"`, 'deleted_at = ""'];
	if (status) parts.push(`status = "${status}"`);
	if (query.correlationId) parts.push(`correlation_id = "${String(query.correlationId)}"`);
	if (query.batchId) parts.push(`correlation_id = "${String(query.batchId)}"`);

	const list = await pocketbaseClient.collection('ai_pin_generation_runs').getList(page, perPage, {
		filter: parts.join(' && '),
		sort: '-created',
	});
	return {
		page: list.page,
		perPage: list.perPage,
		totalItems: list.totalItems,
		totalPages: list.totalPages,
		items: list.items.map(mapGenerationRun),
	};
}

export async function appendGenerationStep(req, id, body = {}) {
	const record = await getOwnedRun(req.pocketbaseUserId, id);
	if (isTerminalGenerationStage(record.status) && body.force !== true) {
		throw httpError(409, 'Run already terminal', 'RUN_TERMINAL');
	}
	const stage = String(body.stage || record.stage);
	if (!isPinGenerationStage(stage)) {
		throw httpError(422, 'Invalid stage', 'VALIDATION_ERROR');
	}
	const steps = Array.isArray(record.steps) ? [...record.steps] : [];
	const entry = createStep(stage, body.status || 'started', body.detail || {});
	steps.push(entry);

	const patch = {
		steps,
		stage,
		status: stage,
		progress: body.progress != null ? Number(body.progress) : stageProgress(stage),
	};
	if (body.imageJobId) patch.image_job_id = String(body.imageJobId);
	if (body.lastError != null) patch.last_error = String(body.lastError).slice(0, 2000);
	if (body.errorCode != null) patch.error_code = String(body.errorCode).slice(0, 80);

	const updated = await pocketbaseClient.collection('ai_pin_generation_runs').update(record.id, patch);
	logger.info('[pin-generation] step', {
		runId: record.id,
		stage,
		status: entry.status,
	});
	return mapGenerationRun(updated);
}

export async function advanceGenerationRun(req, id, body = {}) {
	return appendGenerationStep(req, id, body);
}

export async function completeGenerationRun(req, id, body = {}) {
	const record = await getOwnedRun(req.pocketbaseUserId, id);
	const steps = Array.isArray(record.steps) ? [...record.steps] : [];
	steps.push(createStep('completed', 'completed', {
		imageUrl: body.imageUrl || null,
		format: body.format || record.output_format,
	}));

	const result = {
		...(record.result && typeof record.result === 'object' ? record.result : {}),
		imageUrl: body.imageUrl || '',
		format: body.format || record.output_format,
		mimeType: body.mimeType || 'image/png',
		byteLength: body.byteLength || null,
		profileId: body.profileId || record.export_profile_id,
		durationMs: body.durationMs || null,
		completedBy: 'client_or_worker',
	};

	const updated = await pocketbaseClient.collection('ai_pin_generation_runs').update(record.id, {
		status: 'completed',
		stage: 'completed',
		progress: 100,
		steps,
		result,
		last_error: '',
		error_code: '',
		completed_at: nowIso(),
		next_retry_at: null,
	});

	await recordGenerationHistoryEvent(req.pocketbaseUserId, {
		event_type: 'image',
		title: 'Pin generation completed',
		metadata: {
			module: 'pin_generation',
			runId: record.id,
			stage: 'completed',
			imageUrl: result.imageUrl,
		},
	});

	return mapGenerationRun(updated);
}

export async function failGenerationRun(req, id, body = {}) {
	const record = await getOwnedRun(req.pocketbaseUserId, id);
	const code = String(body.errorCode || body.code || 'GENERATION_ERROR');
	const recoverable = body.recoverable != null
		? Boolean(body.recoverable)
		: isRecoverableGenerationError(code);
	const attemptCount = Number(record.attempt_count) || 0;
	const maxAttempts = Number(record.max_attempts) || 3;
	const steps = Array.isArray(record.steps) ? [...record.steps] : [];
	steps.push(createStep('failed', 'failed', {
		errorCode: code,
		message: body.message || body.lastError || '',
		recoverable,
		attemptCount,
	}));

	const canRetry = recoverable && attemptCount + 1 < maxAttempts && body.cancelRetry !== true;
	if (canRetry) {
		const nextAttempt = attemptCount + 1;
		const delayMs = Math.min(300_000, nextAttempt * 60_000);
		const updated = await pocketbaseClient.collection('ai_pin_generation_runs').update(record.id, {
			status: 'queued',
			stage: 'queued',
			progress: 0,
			steps,
			last_error: String(body.message || body.lastError || code).slice(0, 2000),
			error_code: code,
			attempt_count: nextAttempt,
			next_retry_at: new Date(Date.now() + delayMs).toISOString(),
		});
		logger.info('[pin-generation] scheduled retry', {
			runId: record.id,
			attempt: nextAttempt,
			code,
		});
		return { ...mapGenerationRun(updated), retryScheduled: true };
	}

	const updated = await pocketbaseClient.collection('ai_pin_generation_runs').update(record.id, {
		status: 'failed',
		stage: 'failed',
		progress: 100,
		steps,
		last_error: String(body.message || body.lastError || code).slice(0, 2000),
		error_code: code,
		completed_at: nowIso(),
		next_retry_at: null,
	});

	await recordGenerationHistoryEvent(req.pocketbaseUserId, {
		event_type: 'image',
		title: 'Pin generation failed',
		metadata: {
			module: 'pin_generation',
			runId: record.id,
			errorCode: code,
		},
	});

	return { ...mapGenerationRun(updated), retryScheduled: false };
}

export async function cancelGenerationRun(req, id) {
	const record = await getOwnedRun(req.pocketbaseUserId, id);
	if (isTerminalGenerationStage(record.status)) {
		return mapGenerationRun(record);
	}
	const steps = Array.isArray(record.steps) ? [...record.steps] : [];
	steps.push(createStep('cancelled', 'cancelled'));
	const updated = await pocketbaseClient.collection('ai_pin_generation_runs').update(record.id, {
		status: 'cancelled',
		stage: 'cancelled',
		progress: 100,
		steps,
		cancelled_at: nowIso(),
		completed_at: nowIso(),
		next_retry_at: null,
		last_error: 'cancelled',
		error_code: 'CANCELLED',
	});
	return mapGenerationRun(updated);
}

export async function retryGenerationRun(req, id) {
	const record = await getOwnedRun(req.pocketbaseUserId, id);
	const steps = Array.isArray(record.steps) ? [...record.steps] : [];
	steps.push(createStep('queued', 'retry', {
		previousStatus: record.status,
		attempt: (Number(record.attempt_count) || 0) + 1,
	}));
	const updated = await pocketbaseClient.collection('ai_pin_generation_runs').update(record.id, {
		status: 'queued',
		stage: 'queued',
		progress: 0,
		steps,
		attempt_count: (Number(record.attempt_count) || 0) + 1,
		last_error: '',
		error_code: '',
		next_retry_at: null,
		cancelled_at: null,
		completed_at: null,
		started_at: nowIso(),
	});
	return mapGenerationRun(updated);
}

/**
 * Link an existing ai_pin_image_jobs id onto the run (AI stage).
 */
export async function linkImageJobToRun(req, id, imageJobId) {
	return appendGenerationStep(req, id, {
		stage: 'generating_image',
		status: 'started',
		imageJobId,
		progress: stageProgress('generating_image'),
	});
}

/**
 * Called when linked image job completes (from queue worker).
 */
export async function onImageJobFinishedForRun({ runId, status, imageUrl = '', lastError = '' }) {
	if (!runId) return null;
	const record = await pocketbaseClient.collection('ai_pin_generation_runs').getOne(runId).catch(() => null);
	if (!record || isTerminalGenerationStage(record.status)) return null;

	const steps = Array.isArray(record.steps) ? [...record.steps] : [];
	if (status === 'completed' || status === 'fallback') {
		steps.push(createStep('generating_image', 'completed', { imageUrl, imageJobStatus: status }));
		const result = {
			...(record.result && typeof record.result === 'object' ? record.result : {}),
			sourceImageUrl: imageUrl,
			awaitingCompose: true,
		};
		return pocketbaseClient.collection('ai_pin_generation_runs').update(record.id, {
			stage: 'resolving_variables',
			status: 'resolving_variables',
			progress: stageProgress('resolving_variables'),
			steps,
			result,
			last_error: '',
			error_code: '',
		}).then(mapGenerationRun);
	}

	steps.push(createStep('generating_image', 'failed', { lastError, imageJobStatus: status }));
	const code = 'PROVIDER_TRANSIENT';
	const attemptCount = Number(record.attempt_count) || 0;
	const maxAttempts = Number(record.max_attempts) || 3;
	if (PIN_GENERATION_RECOVERABLE_CODES.includes(code) && attemptCount + 1 < maxAttempts) {
		return pocketbaseClient.collection('ai_pin_generation_runs').update(record.id, {
			status: 'queued',
			stage: 'queued',
			progress: 0,
			steps,
			last_error: String(lastError || 'image job failed').slice(0, 2000),
			error_code: code,
			attempt_count: attemptCount + 1,
			next_retry_at: new Date(Date.now() + (attemptCount + 1) * 60_000).toISOString(),
		}).then(mapGenerationRun);
	}

	return pocketbaseClient.collection('ai_pin_generation_runs').update(record.id, {
		status: 'failed',
		stage: 'failed',
		progress: 100,
		steps,
		last_error: String(lastError || 'image job failed').slice(0, 2000),
		error_code: 'PROVIDER_FAILED',
		completed_at: nowIso(),
	}).then(mapGenerationRun);
}

/**
 * Batch create runs (extension point).
 */
export async function createGenerationBatch(req, body = {}) {
	const items = Array.isArray(body.items) ? body.items : [];
	if (!items.length) throw httpError(422, 'items required', 'VALIDATION_ERROR');
	const correlationId = body.correlationId || body.batchId || `batch_${Date.now()}`;
	const runs = [];
	for (let i = 0; i < items.length; i += 1) {
		const run = await createGenerationRun(req, {
			...body,
			...items[i],
			correlationId,
			batchId: correlationId,
			extensions: {
				...(body.extensions || {}),
				...(items[i].extensions || {}),
				batchId: correlationId,
				batchIndex: i,
			},
			enqueue: body.enqueue,
		});
		runs.push(run);
	}
	return { batchId: correlationId, runs };
}

export { stageProgress, isRecoverableGenerationError };
