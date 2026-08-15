/**
 * Pin Generation Service — client facade.
 * React must call this only; orchestration lives in pinGenerationPipeline + API runs.
 *
 * Backward compatible: existing queueService / featuredComposeService / /jobs remain unchanged.
 */

import apiServerClient from '@/lib/apiServerClient';
import { exportService } from '@/services/templates/exportService';
import { createBrowserCanvasSurface } from '@/lib/pinLayerCompositor';
import { resolveVariablesInDocument } from '@/lib/pinVariableRegistry';
import {
	runPinGenerationPipeline,
	validateGenerationRequest,
	cloneTemplateForGeneration,
	classifyGenerationError,
	pinGenerationExtensions,
	PinGenerationError,
} from '@/lib/pinGenerationPipeline';
import {
	PIN_GENERATION_STAGES,
	stageProgress,
} from '@/lib/pinGenerationConstants.js';
import { uploadImageBlob } from './imageLifecycle.js';

async function apiJson(path, options = {}) {
	const response = await apiServerClient.fetch(path, {
		...options,
		headers: {
			...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
			...(options.headers || {}),
		},
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new PinGenerationError(payload.message || `Request failed: ${path}`, {
			code: payload.errorCode || 'NETWORK_ERROR',
			recoverable: true,
		});
	}
	return payload;
}

async function uploadExportedBytes({ bytes, mimeType = 'image/png', articleId = '', title = '' }) {
	const blob = bytes instanceof Blob
		? bytes
		: new Blob([bytes], { type: mimeType });
	try {
		return await uploadImageBlob(blob, {
			articleId,
			title,
			fileName: `pin-gen-${Date.now()}.png`,
		});
	} catch (error) {
		throw new PinGenerationError(error?.message || 'Upload failed', {
			code: 'UPLOAD_TRANSIENT',
			recoverable: true,
		});
	}
}

async function pollImageJob(jobId, { signal, intervalMs = 2500, maxAttempts = 48 } = {}) {
	for (let i = 0; i < maxAttempts; i += 1) {
		if (signal?.aborted) {
			throw new PinGenerationError('Cancelled', { code: 'CANCELLED' });
		}
		const response = await apiServerClient.fetch(`/ai-pin-images/jobs?ids=${encodeURIComponent(jobId)}`, {
			method: 'GET',
		});
		const payload = await response.json().catch(() => ({}));
		const job = Array.isArray(payload.jobs)
			? payload.jobs.find((j) => j.id === jobId)
			: (payload.items || []).find((j) => j.id === jobId);
		if (job) {
			const status = String(job.status || '');
			if (status === 'completed' || status === 'fallback') {
				return job;
			}
			if (status === 'failed') {
				throw new PinGenerationError(job.lastError || 'Image job failed', {
					code: 'PROVIDER_TRANSIENT',
					recoverable: true,
				});
			}
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new PinGenerationError('Image job timed out', {
		code: 'PROVIDER_TIMEOUT',
		recoverable: true,
	});
}

/**
 * Create a generation run on the server (metadata only; templates not mutated).
 */
export async function createPinGenerationRun(body) {
	const payload = await apiJson('/ai-pin-images/generation/runs', {
		method: 'POST',
		body: JSON.stringify(body || {}),
	});
	return payload.run;
}

export async function getPinGenerationRun(id) {
	const payload = await apiJson(`/ai-pin-images/generation/runs/${id}?includeSnapshot=1`, { method: 'GET' });
	return payload.run;
}

export async function cancelPinGenerationRun(id) {
	const payload = await apiJson(`/ai-pin-images/generation/runs/${id}/cancel`, { method: 'POST', body: '{}' });
	return payload.run;
}

export async function retryPinGenerationRun(id) {
	const payload = await apiJson(`/ai-pin-images/generation/runs/${id}/retry`, { method: 'POST', body: '{}' });
	return payload.run;
}

async function reportStage(runId, stage, detail = {}) {
	if (!runId) return null;
	return apiJson(`/ai-pin-images/generation/runs/${runId}/advance`, {
		method: 'POST',
		body: JSON.stringify({
			stage,
			status: detail.status || 'started',
			progress: detail.progress ?? stageProgress(stage),
			detail,
			imageJobId: detail.imageJobId,
		}),
	}).then((p) => p.run).catch(() => null);
}

/**
 * Full integrated generation:
 * Content → Variables → AI Image (existing jobs) → Template clone → Export → Upload.
 *
 * @param {object} request
 * @param {object} [options]
 */
export async function generatePin(request = {}, options = {}) {
	const validation = validateGenerationRequest(request);
	if (!validation.ok) {
		throw new PinGenerationError('Invalid generation request', {
			code: 'VALIDATION_ERROR',
			cause: validation.issues,
		});
	}

	const signal = options.signal || request.signal || null;
	const abortController = signal ? null : new AbortController();
	const activeSignal = signal || abortController.signal;

	// 1. Create run (server metadata)
	const run = await createPinGenerationRun({
		...request,
		templateId: request.templateId,
		templateConfiguration: request.templateConfiguration,
		exportProfileId: request.exportProfileId || request.profileId,
		format: request.format || request.outputFormat || 'png',
		imageMode: request.imageMode || 'generate_ai',
		content: request.content,
		variables: request.variables,
		brandKit: request.brandKit,
		featuredImageUrl: request.featuredImageUrl,
		imageUrl: request.imageUrl,
		articleId: request.articleId,
		aiPinId: request.aiPinId || request.pinId,
		clientToken: request.clientToken,
		extensions: request.extensions,
		enqueue: request.enqueue !== false,
	});

	const runId = run.id;
	const templateSnapshot = run.templateSnapshot
		|| cloneTemplateForGeneration(request.templateConfiguration || request.templateSnapshot);

	try {
		const result = await runPinGenerationPipeline(
			{
				...request,
				imageMode: request.imageMode || run.imageMode || 'generate_ai',
				templateSnapshot,
				templateId: run.templateId || request.templateId,
				exportProfileId: run.exportProfileId,
				format: run.outputFormat,
				signal: activeSignal,
			},
			{
				signal: activeSignal,
				async onStage(stage, meta) {
					await reportStage(runId, stage, meta);
					if (typeof options.onProgress === 'function') {
						options.onProgress({ runId, stage, ...meta });
					}
				},
				async loadTemplate() {
					return cloneTemplateForGeneration(templateSnapshot);
				},
				async generateImage({ content, prompt }) {
					// Reuse existing Admin-routed AI image jobs API.
					if (!request.articleId) {
						throw new PinGenerationError('articleId required for generate_ai', {
							code: 'VALIDATION_ERROR',
							recoverable: false,
						});
					}
					const createRes = await apiJson('/ai-pin-images/jobs', {
						method: 'POST',
						body: JSON.stringify({
							items: [{
								articleId: request.articleId,
								pinId: request.aiPinId || request.pinId,
								clientToken: request.clientToken || `gen_${runId}`,
								imageMode: 'generate_ai',
								title: content.title || request.content?.title,
								description: content.description || request.content?.description,
								overlayText: content.overlayText || request.content?.overlayText,
								category: content.category || request.content?.category,
								imagePrompt: prompt || content.imagePrompt || request.prompt,
								generationRunId: runId,
							}],
						}),
					});
					const job = (createRes.jobs || createRes.items || [])[0];
					if (!job?.id) {
						throw new PinGenerationError('Failed to enqueue image job', {
							code: 'QUEUE_BUSY',
							recoverable: true,
						});
					}
					await reportStage(runId, 'generating_image', {
						status: 'started',
						imageJobId: job.id,
					});
					await apiJson(`/ai-pin-images/generation/runs/${runId}/link-image-job`, {
						method: 'POST',
						body: JSON.stringify({ imageJobId: job.id }),
					}).catch(() => null);

					const finished = await pollImageJob(job.id, { signal: activeSignal });
					return { imageUrl: finished.imageUrl };
				},
				async resolveVariables(document, context) {
					const cloned = cloneTemplateForGeneration(document);
					if (cloned.layers) {
						return resolveVariablesInDocument(cloned, context, { replaceUnknown: 'empty' });
					}
					return { document: cloned, context };
				},
				async exportPin({ document, profileId, format, variables, brandKit }) {
					return exportService.export(
						{
							document,
							profileId,
							format,
							variables,
							brandKit,
						},
						{
							createSurface: options.createSurface
								|| (typeof globalThis.document !== 'undefined' ? createBrowserCanvasSurface : undefined),
							loadImageFn: options.loadImageFn,
							signal: activeSignal,
						},
					);
				},
				async uploadResult({ bytes, mimeType }) {
					return uploadExportedBytes({
						bytes,
						mimeType,
						articleId: request.articleId,
						title: request.content?.title,
					});
				},
			},
		);

		const completed = await apiJson(`/ai-pin-images/generation/runs/${runId}/complete`, {
			method: 'POST',
			body: JSON.stringify({
				imageUrl: result.imageUrl,
				format: result.format,
				mimeType: result.mimeType,
				byteLength: result.bytes?.byteLength ?? result.bytes?.length,
				profileId: result.profileId,
				durationMs: result.durationMs,
			}),
		});

		return {
			ok: true,
			run: completed.run,
			imageUrl: result.imageUrl,
			bytes: result.bytes,
			format: result.format,
			steps: result.steps,
			durationMs: result.durationMs,
		};
	} catch (error) {
		const classified = classifyGenerationError(error);
		await apiJson(`/ai-pin-images/generation/runs/${runId}/fail`, {
			method: 'POST',
			body: JSON.stringify({
				errorCode: classified.code,
				message: error?.message || String(error),
				recoverable: classified.recoverable,
			}),
		}).catch(() => null);

		if (classified.code === 'CANCELLED') {
			await cancelPinGenerationRun(runId).catch(() => null);
		}
		throw error;
	}
}

/**
 * Legacy-compatible featured compose via Export Engine (optional path).
 * Does not replace composeAndUploadFeaturedPins — additive.
 */
export async function generateFeaturedPinViaPipeline(pin, {
	brandKit = null,
	exportProfileId = 'pinterest_standard',
	format = 'png',
	onProgress,
	signal,
} = {}) {
	return generatePin(
		{
			imageMode: 'use_featured',
			featuredImageUrl: pin.featuredImage || pin.featuredImageUrl,
			templateConfiguration: pin.templateConfig || pin.templateConfiguration,
			templateId: pin.templateId,
			exportProfileId,
			format,
			articleId: pin.articleId,
			content: {
				title: pin.title,
				subtitle: pin.subtitle,
				description: pin.description,
				overlayText: pin.overlayText,
				category: pin.category,
				website: pin.website,
				author: pin.author,
			},
			brandKit,
			extensions: { legacyBridge: 'featured_compose' },
		},
		{ onProgress, signal },
	);
}

export async function generatePinBatch(items, shared = {}, options = {}) {
	const requests = pinGenerationExtensions.buildBatchRequests(items, shared);
	const payload = await apiJson('/ai-pin-images/generation/batch', {
		method: 'POST',
		body: JSON.stringify({
			items: requests,
			...shared,
			enqueue: shared.enqueue !== false,
		}),
	});

	// Default: metadata + queue only (no double-create). Opt-in local compose.
	if (!options.executeLocally) {
		return payload;
	}

	const results = [];
	for (let i = 0; i < (payload.runs || []).length; i += 1) {
		const run = payload.runs[i];
		const item = items[run.extensions?.batchIndex ?? i] || {};
		try {
			const outcome = await executeExistingRun(run.id, {
				...shared,
				...item,
				templateSnapshot: run.templateSnapshot,
			}, options);
			results.push({ ok: true, runId: run.id, ...outcome });
		} catch (error) {
			results.push({ ok: false, runId: run.id, error: error?.message || String(error) });
		}
	}
	return { ...payload, results };
}

/**
 * Continue compose/export for an existing run (after AI image or for batch items).
 */
export async function executeExistingRun(runId, request = {}, options = {}) {
	const run = await getPinGenerationRun(runId);
	if (!run) throw new PinGenerationError('Run not found', { code: 'NOT_FOUND' });
	const snap = run.templateSnapshot || request.templateSnapshot || request.templateConfiguration;
	const reqSnap = run.requestSnapshot || {};
	const signal = options.signal;
	const imageMode = request.imageMode
		|| (run.result?.sourceImageUrl ? 'provided_url' : null)
		|| run.imageMode
		|| reqSnap.choices?.imageMode
		|| 'use_featured';

	const result = await runPinGenerationPipeline(
		{
			imageMode,
			featuredImageUrl: request.featuredImageUrl || reqSnap.featuredImageUrl || '',
			imageUrl: request.imageUrl || run.result?.sourceImageUrl || reqSnap.imageUrl || '',
			templateSnapshot: snap,
			exportProfileId: run.exportProfileId,
			format: run.outputFormat,
			content: request.content || reqSnap.content || {},
			variables: request.variables || reqSnap.variables || {},
			brandKit: request.brandKit || reqSnap.brandKit || null,
			signal,
		},
		{
			signal,
			async onStage(stage, meta) {
				await reportStage(runId, stage, meta);
				options.onProgress?.({ runId, stage, ...meta });
			},
			async generateImage() {
				const url = run.result?.sourceImageUrl || request.imageUrl || request.featuredImageUrl;
				if (!url) {
					throw new PinGenerationError('No source image on run', {
						code: 'PROVIDER_EMPTY',
						recoverable: true,
					});
				}
				return { imageUrl: url };
			},
			async resolveVariables(document, context) {
				const cloned = cloneTemplateForGeneration(document);
				if (cloned.layers) {
					return resolveVariablesInDocument(cloned, context, { replaceUnknown: 'empty' });
				}
				return { document: cloned, context };
			},
			async exportPin({ document, profileId, format, variables, brandKit }) {
				return exportService.export(
					{ document, profileId, format, variables, brandKit },
					{
						createSurface: options.createSurface
							|| (typeof globalThis.document !== 'undefined' ? createBrowserCanvasSurface : undefined),
						loadImageFn: options.loadImageFn,
						signal,
					},
				);
			},
			async uploadResult({ bytes, mimeType }) {
				return uploadExportedBytes({
					bytes,
					mimeType,
					articleId: run.articleId || request.articleId,
					title: request.content?.title,
				});
			},
		},
	);

	const completed = await apiJson(`/ai-pin-images/generation/runs/${runId}/complete`, {
		method: 'POST',
		body: JSON.stringify({
			imageUrl: result.imageUrl,
			format: result.format,
			mimeType: result.mimeType,
			byteLength: result.bytes?.byteLength ?? result.bytes?.length,
			profileId: result.profileId,
			durationMs: result.durationMs,
		}),
	});

	return {
		ok: true,
		run: completed.run,
		imageUrl: result.imageUrl,
		bytes: result.bytes,
		format: result.format,
		steps: result.steps,
		durationMs: result.durationMs,
	};
}

export const pinGenerationService = {
	stages: PIN_GENERATION_STAGES,
	validate: validateGenerationRequest,
	createRun: createPinGenerationRun,
	getRun: getPinGenerationRun,
	cancelRun: cancelPinGenerationRun,
	retryRun: retryPinGenerationRun,
	generate: generatePin,
	generateFeaturedViaPipeline: generateFeaturedPinViaPipeline,
	generateBatch: generatePinBatch,
	executeRun: executeExistingRun,
	extensions: pinGenerationExtensions,
};

export default pinGenerationService;
