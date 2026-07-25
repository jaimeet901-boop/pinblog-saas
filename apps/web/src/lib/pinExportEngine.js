/**
 * Export Engine — pixel export pipeline, independent of editor & React.
 *
 * Pipeline:
 *   validate → resolve profile/preset → normalize document (v1→v2 in-memory)
 *   → resize to profile → watermark hook → renderDocument (RenderTarget)
 *   → bytes + metadata
 *
 * Always renders from a normalized v2 document via the compositor.
 */

import { DOCUMENT_SCHEMA_VERSION_LAYERS } from './pinEngineConstants.js';
import { migrateDocument, migrateV1ProceduralToV2 } from './pinLayerMigrate.js';
import { isV2Document, normalizeEditorDocument } from './pinLayerSchema.js';
import { renderDocument, createMockRenderSurface } from './pinLayerCompositor.js';
import { getExportProfile } from './pinExportProfiles.js';
import { resolvePresetSettings } from './pinExportPresets.js';
import {
	assertExportRequest,
	validateExportDocument,
	validateExportRequest,
	ExportValidationError,
} from './pinExportValidation.js';
import { applyWatermarkPipeline } from './pinExportWatermark.js';
import {
	createExportJob,
	createInMemoryExportQueue,
	throwIfAborted,
	snapshotJob,
	EXPORT_JOB_STATUS,
	cancelExportJob,
	cancelExportBatch,
	getExportJob,
} from './pinExportJobs.js';

export { ExportValidationError };

/**
 * Scale a normalized document to target canvas size (profile dimensions).
 */
export function applyExportCanvasSize(document, width, height) {
	const doc = normalizeEditorDocument(document);
	const srcW = doc.canvas.width;
	const srcH = doc.canvas.height;
	const tw = Math.round(Number(width) || srcW);
	const th = Math.round(Number(height) || srcH);
	if (srcW === tw && srcH === th) return doc;

	const sx = tw / srcW;
	const sy = th / srcH;
	const scaleFont = (sx + sy) / 2;

	return normalizeEditorDocument({
		...doc,
		canvas: { ...doc.canvas, width: tw, height: th },
		layers: (doc.layers || []).map((layer) => {
			const next = {
				...layer,
				x: Math.round((layer.x || 0) * sx),
				y: Math.round((layer.y || 0) * sy),
				width: Math.round((layer.width || 0) * sx),
				height: Math.round((layer.height || 0) * sy),
				props: { ...(layer.props || {}) },
			};
			if (layer.type === 'text' && next.props.fontSize != null) {
				next.props.fontSize = Math.max(8, Math.round(Number(next.props.fontSize) * scaleFont));
			}
			return next;
		}),
	});
}

/**
 * Prepare any v1/v2 template config into a normalized export document.
 * Never persists migration — in-memory only (v1 compatibility).
 */
export function prepareExportDocument(raw, options = {}) {
	const check = validateExportDocument(raw);
	if (!check.ok) {
		throw new ExportValidationError('Document not exportable', check.issues);
	}

	let document = raw;
	if (check.kind === 'v1') {
		document = migrateV1ProceduralToV2(raw, {
			category: options.category || raw?.category || 'general',
		});
	} else if (!isV2Document(document) && Array.isArray(document?.layers)) {
		document = { ...document, editorVersion: 2, schemaVersion: DOCUMENT_SCHEMA_VERSION_LAYERS };
	}

	const migrated = migrateDocument(document, {
		targetSchemaVersion: DOCUMENT_SCHEMA_VERSION_LAYERS,
		category: options.category,
	});
	return normalizeEditorDocument(migrated.document);
}

function applyBackgroundSettings(document, settings) {
	const doc = normalizeEditorDocument(document);
	if (!settings?.transparent) return doc;

	const layers = (doc.layers || []).map((layer) => {
		if (layer.type !== 'background') return layer;
		return {
			...layer,
			props: {
				...(layer.props || {}),
				color: 'rgba(0,0,0,0)',
			},
		};
	});
	return { ...doc, layers };
}

function wrapCreateSurface(createSurface, settings) {
	return (width, height) => {
		const surface = createSurface
			? createSurface(width, height)
			: createMockRenderSurface(width, height);

		if (typeof surface.clear === 'function') {
			surface.clear();
		}
		if (!settings.transparent && settings.background && settings.background !== 'transparent') {
			if (typeof surface.fillRect === 'function') {
				surface.fillRect(0, 0, width, height, settings.background);
			}
		}
		return surface;
	};
}

/**
 * Core export — returns bytes. Does not touch React or editor store.
 *
 * @param {object} request
 * @param {object} [runtime]
 */
export async function runExport(request = {}, runtime = {}) {
	const started = Date.now();
	const signal = runtime.signal || request.signal || null;

	const resolved = resolvePresetSettings(request.presetId, {
		profileId: request.profileId || request.profile,
		format: request.format,
		width: request.width ?? request.settings?.width,
		height: request.height ?? request.settings?.height,
		dpi: request.dpi ?? request.settings?.dpi,
		quality: request.quality ?? request.settings?.quality,
		background: request.background ?? request.settings?.background,
		transparent: request.transparent ?? request.settings?.transparent,
		compression: request.compression ?? request.settings?.compression,
		settings: request.settings,
	});

	const toValidate = {
		...request,
		profileId: resolved.profile.id,
		format: resolved.format,
		width: resolved.settings.width,
		height: resolved.settings.height,
		dpi: resolved.settings.dpi,
		quality: resolved.settings.quality,
		background: resolved.settings.background,
		transparent: resolved.settings.transparent,
		compression: resolved.settings.compression,
		document: request.document || request.configuration,
	};

	const plan = assertExportRequest(toValidate);
	throwIfAborted(signal);

	let document = prepareExportDocument(plan.document, {
		category: request.category,
	});
	throwIfAborted(signal);

	document = applyExportCanvasSize(
		document,
		plan.settings.width,
		plan.settings.height,
	);
	document = applyBackgroundSettings(document, plan.settings);
	throwIfAborted(signal);

	document = await applyWatermarkPipeline({
		document,
		settings: plan.settings,
		watermark: plan.watermark || request.watermark || null,
		context: {
			variables: plan.variables,
			profileId: plan.profileId,
			format: plan.format,
		},
	});
	throwIfAborted(signal);

	if (runtime.onProgress) runtime.onProgress(40);

	const rendered = await renderDocument(document, {
		format: plan.format,
		variables: plan.variables,
		brandKit: plan.brandKit || request.brandKit || null,
		quality: plan.settings.quality,
		compression: plan.settings.compression,
		createSurface: wrapCreateSurface(runtime.createSurface, plan.settings),
		loadImageFn: runtime.loadImageFn,
		replaceUnknown: runtime.replaceUnknown || 'empty',
	});
	throwIfAborted(signal);

	if (runtime.onProgress) runtime.onProgress(100);

	return {
		bytes: rendered.bytes,
		mimeType: rendered.mimeType,
		format: rendered.format,
		profileId: plan.profileId,
		presetId: plan.presetId,
		settings: plan.settings,
		document: rendered.document,
		durationMs: Date.now() - started,
		schemaKind: validateExportDocument(plan.document).kind,
	};
}

/**
 * Run export as a cancellable job.
 */
export async function runExportJob(request = {}, runtime = {}) {
	const job = createExportJob(request);
	job.status = EXPORT_JOB_STATUS.running;
	job.startedAt = Date.now();
	try {
		const result = await runExport(request, {
			...runtime,
			signal: job.abortController.signal,
			onProgress: (p) => {
				job.progress = p;
				if (runtime.onProgress) runtime.onProgress(p);
			},
		});
		if (job.abortController.signal.aborted) {
			job.status = EXPORT_JOB_STATUS.cancelled;
			job.error = 'cancelled';
		} else {
			job.status = EXPORT_JOB_STATUS.completed;
			job.result = result;
			job.progress = 100;
		}
	} catch (err) {
		if (err?.code === 'EXPORT_CANCELLED' || job.abortController.signal.aborted) {
			job.status = EXPORT_JOB_STATUS.cancelled;
			job.error = 'cancelled';
		} else {
			job.status = EXPORT_JOB_STATUS.failed;
			job.error = err?.message || String(err);
		}
		job.completedAt = Date.now();
		return { job: snapshotJob(job), result: null, error: job.error };
	}
	job.completedAt = Date.now();
	return { job: snapshotJob(job), result: job.result, error: job.error };
}

/**
 * Batch export — each item is an independent cancellable job under one batchId.
 */
export async function runExportBatch(items = [], runtime = {}) {
	const batchId = runtime.batchId || `batch_${Date.now()}`;
	const concurrency = Math.max(1, Number(runtime.concurrency) || 2);
	const results = new Array(items.length);
	let cursor = 0;

	async function worker() {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			const item = items[index] || {};
			if (runtime.signal?.aborted) {
				results[index] = {
					index,
					job: null,
					result: null,
					error: 'cancelled',
				};
				continue;
			}
			const outcome = await runExportJob(
				{ ...item, batchId, index },
				{
					...runtime,
					createSurface: runtime.createSurface,
					loadImageFn: runtime.loadImageFn,
				},
			);
			results[index] = { index, ...outcome };
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker());
	await Promise.all(workers);

	return {
		batchId,
		results,
		cancelled: Boolean(runtime.signal?.aborted),
		completed: results.filter((r) => r?.job?.status === EXPORT_JOB_STATUS.completed).length,
		failed: results.filter((r) => r?.job?.status === EXPORT_JOB_STATUS.failed).length,
	};
}

/**
 * Build a local queue bound to this engine (for background-style local processing).
 */
export function createLocalExportQueue(runtime = {}) {
	return createInMemoryExportQueue({
		async runJob(job) {
			const result = await runExport(job.request, {
				...runtime,
				signal: job.abortController.signal,
				onProgress: (p) => {
					job.progress = p;
				},
			});
			job.result = result;
			return result;
		},
	});
}

export function buildExportPlan(request = {}) {
	const resolved = resolvePresetSettings(request.presetId, {
		profileId: request.profileId || request.profile,
		format: request.format,
		width: request.width ?? request.settings?.width,
		height: request.height ?? request.settings?.height,
		dpi: request.dpi ?? request.settings?.dpi,
		quality: request.quality ?? request.settings?.quality,
		background: request.background ?? request.settings?.background,
		transparent: request.transparent ?? request.settings?.transparent,
		compression: request.compression ?? request.settings?.compression,
		settings: request.settings,
	});
	const validation = validateExportRequest({
		...request,
		profileId: resolved.profile.id,
		format: resolved.format,
		...resolved.settings,
		document: request.document || request.configuration,
		templateId: request.templateId,
	});
	return {
		...validation,
		profile: getExportProfile(resolved.profile.id),
		preset: resolved.preset,
		queue: {
			jobType: 'export',
			alternateJobType: 'template_rendering',
			clientRenderSupported: true,
			backgroundQueueReady: true,
		},
	};
}

export {
	cancelExportJob,
	cancelExportBatch,
	getExportJob,
	snapshotJob,
	EXPORT_JOB_STATUS,
};
