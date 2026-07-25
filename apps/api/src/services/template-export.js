/**
 * Template Export API — plans, validation, package import, queue enqueue hooks.
 * Pixel encoding stays client/worker-side (RenderTarget). This service never
 * imports React or the editor.
 */

import { enqueueJob } from './queue/index.js';
import { httpError } from '../middleware/require-admin.js';
import { assertCapability } from './workspace-rbac.js';
import {
	exportPinTemplate,
	getPinTemplate,
} from './template-gallery.js';
import { createPinTemplate } from './workspace-templates.js';
import { createTemplateUuid } from '../utils/pin-template-identity.js';

export const EXPORT_PROFILES = Object.freeze({
	pinterest_standard: { id: 'pinterest_standard', label: 'Pinterest Standard', width: 1000, height: 1500, defaultFormat: 'png' },
	pinterest_long: { id: 'pinterest_long', label: 'Pinterest Long', width: 1000, height: 2100, defaultFormat: 'png' },
	instagram_square: { id: 'instagram_square', label: 'Instagram Square', width: 1080, height: 1080, defaultFormat: 'png' },
	instagram_portrait: { id: 'instagram_portrait', label: 'Instagram Portrait', width: 1080, height: 1350, defaultFormat: 'png' },
	facebook_post: { id: 'facebook_post', label: 'Facebook Post', width: 1200, height: 630, defaultFormat: 'png' },
	facebook_story: { id: 'facebook_story', label: 'Facebook Story', width: 1080, height: 1920, defaultFormat: 'png' },
	custom: { id: 'custom', label: 'Custom', width: 1000, height: 1500, defaultFormat: 'png' },
});

const IMPLEMENTED_FORMATS = new Set(['png']);
const ARCHITECTURE_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'pdf', 'svg', 'mp4']);

export function listTemplateExportProfiles() {
	return Object.values(EXPORT_PROFILES);
}

export function listTemplateExportFormats() {
	return {
		implemented: [...IMPLEMENTED_FORMATS],
		architectureReady: [...ARCHITECTURE_FORMATS],
	};
}

/**
 * Validate and normalize an export plan (no pixels).
 */
export async function planTemplateExport(req, body = {}) {
	assertCapability(req, 'workspace.read');
	const issues = [];
	const profileId = String(body.profileId || body.profile || 'pinterest_standard');
	const profile = EXPORT_PROFILES[profileId];
	if (!profile) {
		issues.push({ field: 'profileId', reason: 'unknown_profile', value: profileId });
	}

	const format = String(body.format || profile?.defaultFormat || 'png').toLowerCase();
	if (!ARCHITECTURE_FORMATS.has(format)) {
		issues.push({ field: 'format', reason: 'unsupported_format', value: format });
	} else if (!IMPLEMENTED_FORMATS.has(format === 'jpeg' ? 'jpg' : format) && format !== 'png') {
		issues.push({ field: 'format', reason: 'format_not_implemented', value: format });
	}

	let document = body.document || body.configuration || null;
	let template = null;
	if (body.templateId) {
		template = await getPinTemplate(req, body.templateId);
		document = document || template.configuration;
	}
	if (!document) {
		issues.push({ field: 'document', reason: 'document_or_templateId_required' });
	}

	const width = Number(body.width ?? body.settings?.width ?? profile?.width);
	const height = Number(body.height ?? body.settings?.height ?? profile?.height);
	const dpi = Number(body.dpi ?? body.settings?.dpi ?? 72);
	const quality = Number(body.quality ?? body.settings?.quality ?? 0.92);
	const compression = Number(body.compression ?? body.settings?.compression ?? 6);

	if (!Number.isFinite(width) || width < 64 || width > 8000) {
		issues.push({ field: 'width', reason: 'out_of_range', value: width });
	}
	if (!Number.isFinite(height) || height < 64 || height > 12000) {
		issues.push({ field: 'height', reason: 'out_of_range', value: height });
	}
	if (!Number.isFinite(dpi) || dpi < 36 || dpi > 600) {
		issues.push({ field: 'dpi', reason: 'out_of_range', value: dpi });
	}
	if (!Number.isFinite(quality) || quality <= 0 || quality > 1) {
		issues.push({ field: 'quality', reason: 'out_of_range', value: quality });
	}
	if (!Number.isFinite(compression) || compression < 0 || compression > 9) {
		issues.push({ field: 'compression', reason: 'out_of_range', value: compression });
	}

	const ok = issues.filter((i) => i.severity !== 'warning').length === 0;
	return {
		ok,
		issues,
		mode: 'client_or_worker',
		queue: {
			jobType: 'export',
			alternateJobType: 'template_rendering',
			backgroundQueueReady: true,
			nativeWorker: false,
		},
		plan: ok
			? {
				profileId: profile.id,
				format: format === 'jpeg' ? 'jpg' : format,
				templateId: body.templateId || template?.id || null,
				templateUuid: template?.templateUuid || null,
				settings: {
					width,
					height,
					dpi,
					quality,
					background: body.background ?? body.settings?.background ?? '#ffffff',
					transparent: Boolean(body.transparent ?? body.settings?.transparent),
					compression,
				},
				variables: body.variables || body.context || {},
				watermark: body.watermark || null,
				hasDocument: Boolean(document),
				editorVersion: template?.editorVersion ?? document?.editorVersion ?? null,
				schemaVersion: template?.schemaVersion ?? document?.schemaVersion ?? null,
			}
			: null,
	};
}

/**
 * Enqueue a background export / template_rendering job (architecture ready).
 * Worker performs RenderTarget encode later; API stores the plan only.
 */
export async function enqueueTemplateExportJob(req, body = {}) {
	assertCapability(req, 'workspace.templates.manage');
	const planned = await planTemplateExport(req, body);
	if (!planned.ok) {
		const error = httpError(422, 'Invalid export plan', 'EXPORT_VALIDATION_ERROR');
		error.details = { issues: planned.issues };
		throw error;
	}

	const jobType = body.jobType === 'template_rendering' ? 'template_rendering' : 'export';
	const owner = req.pocketbaseUserId;
	const job = await enqueueJob({
		owner,
		workspaceKey: req.workspace?.id || req.workspaceId || '',
		type: jobType,
		priority: body.priority || 'normal',
		payload: {
			kind: 'template_pixel_export',
			plan: planned.plan,
			clientRenderFallback: true,
			watermarkPipeline: Boolean(body.watermark),
		},
		sourceCollection: body.templateId ? 'ai_pin_templates' : '',
		sourceId: body.templateId || '',
		correlationId: body.correlationId || '',
		meta: {
			module: 'template_export',
			profileId: planned.plan.profileId,
			format: planned.plan.format,
		},
	});

	return {
		ok: true,
		job: {
			id: job.id,
			type: job.type,
			status: job.status,
		},
		plan: planned.plan,
		note: 'Queued for background worker; pixel encode uses RenderTarget when worker is attached.',
	};
}

/**
 * Batch plan / optional enqueue.
 */
export async function planTemplateExportBatch(req, body = {}) {
	assertCapability(req, 'workspace.read');
	const items = Array.isArray(body.items) ? body.items : [];
	if (!items.length) throw httpError(422, 'items required', 'VALIDATION_ERROR');

	const results = [];
	for (let i = 0; i < items.length; i += 1) {
		const planned = await planTemplateExport(req, { ...body, ...items[i] });
		results.push({ index: i, ...planned });
	}

	if (body.enqueue) {
		assertCapability(req, 'workspace.templates.manage');
		const jobs = [];
		for (const row of results) {
			if (!row.ok) {
				jobs.push({ index: row.index, ok: false, issues: row.issues });
				continue;
			}
			const enqueued = await enqueueTemplateExportJob(req, {
				...body,
				...items[row.index],
				jobType: body.jobType,
			});
			jobs.push({ index: row.index, ok: true, job: enqueued.job });
		}
		return { batch: true, results, jobs };
	}

	return { batch: true, results };
}

/**
 * Import a pinblog-template-package (JSON) into the workspace.
 */
export async function importTemplatePackage(req, body = {}) {
	assertCapability(req, 'workspace.templates.manage');
	const pack = body.package || body;
	if (!pack.format) {
		throw httpError(422, 'package.format required (pinblog-template-package)', 'IMPORT_FORMAT_ERROR');
	}
	if (pack.format !== 'pinblog-template-package') {
		throw httpError(422, 'Unsupported package format', 'IMPORT_FORMAT_ERROR');
	}
	const template = pack.template || body.template;
	if (!template?.configuration && !template?.name) {
		throw httpError(422, 'package.template required', 'VALIDATION_ERROR');
	}

	let serialized = '';
	try {
		serialized = JSON.stringify(pack);
	} catch {
		throw httpError(422, 'Package is not serializable', 'VALIDATION_ERROR');
	}
	if (serialized.length > 1_500_000) {
		throw httpError(413, 'Package too large', 'PAYLOAD_TOO_LARGE');
	}

	const created = await createPinTemplate(req, {
		name: body.name || `${template.name || 'Imported template'} (import)`,
		category: template.category || 'general',
		configuration: template.configuration || {},
		thumbnail: template.thumbnail || '',
		visibility: body.visibility || 'private',
		status: body.status || 'draft',
		editor_version: template.editorVersion || 1,
		schema_version: template.schemaVersion || 1,
		marketplace_meta: template.marketplace || null,
		template_uuid: createTemplateUuid(),
	});

	return {
		ok: true,
		item: created,
		importedFrom: {
			templateUuid: template.templateUuid || null,
			packageVersion: pack.version || 1,
		},
	};
}

export async function getTemplatePackageExport(req, id) {
	return exportPinTemplate(req, id);
}
