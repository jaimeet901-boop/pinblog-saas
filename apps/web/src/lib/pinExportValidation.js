/**
 * Export request validation — independent of React / editor.
 */

import { isRenderTarget, RENDER_TARGETS } from './pinEngineConstants.js';
import { EXPORT_PROFILE_IDS, getExportProfile } from './pinExportProfiles.js';
import { getExportPreset } from './pinExportPresets.js';
import { isV2Document } from './pinLayerSchema.js';

export class ExportValidationError extends Error {
	constructor(message, issues = []) {
		super(message);
		this.name = 'ExportValidationError';
		this.code = 'EXPORT_VALIDATION_ERROR';
		this.issues = issues;
	}
}

const IMPLEMENTED_FORMATS = new Set(['png']);
const ARCHITECTURE_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'pdf', 'svg', 'mp4']);

export function listSupportedExportFormats() {
	return {
		implemented: [...IMPLEMENTED_FORMATS],
		architectureReady: [...ARCHITECTURE_FORMATS],
		renderTargets: [...RENDER_TARGETS, 'svg'].filter((v, i, arr) => arr.indexOf(v) === i),
	};
}

/**
 * @param {object} request
 * @returns {{ ok: boolean, issues: object[], normalized: object|null }}
 */
export function validateExportRequest(request = {}) {
	const issues = [];
	const profileId = request.profileId || request.profile || 'pinterest_standard';
	if (!EXPORT_PROFILE_IDS.includes(profileId) && profileId !== 'custom') {
		issues.push({ field: 'profileId', reason: 'unknown_profile', value: profileId });
	}

	if (request.presetId && !getExportPreset(request.presetId)) {
		issues.push({ field: 'presetId', reason: 'unknown_preset', value: request.presetId });
	}

	const format = String(request.format || getExportProfile(profileId).defaultFormat || 'png').toLowerCase();
	if (!ARCHITECTURE_FORMATS.has(format) && !isRenderTarget(format)) {
		issues.push({ field: 'format', reason: 'unsupported_format', value: format });
	} else if (!IMPLEMENTED_FORMATS.has(format)) {
		issues.push({
			field: 'format',
			reason: 'format_not_implemented',
			value: format,
			severity: 'error',
		});
	}

	const width = Number(request.width ?? request.settings?.width);
	const height = Number(request.height ?? request.settings?.height);
	if (request.profileId === 'custom' || request.profile === 'custom') {
		if (!Number.isFinite(width) || width < 64 || width > 8000) {
			issues.push({ field: 'width', reason: 'out_of_range', value: width });
		}
		if (!Number.isFinite(height) || height < 64 || height > 12000) {
			issues.push({ field: 'height', reason: 'out_of_range', value: height });
		}
	}

	const dpi = Number(request.dpi ?? request.settings?.dpi ?? 72);
	if (!Number.isFinite(dpi) || dpi < 36 || dpi > 600) {
		issues.push({ field: 'dpi', reason: 'out_of_range', value: dpi });
	}

	const quality = Number(request.quality ?? request.settings?.quality ?? 0.92);
	if (!Number.isFinite(quality) || quality <= 0 || quality > 1) {
		issues.push({ field: 'quality', reason: 'out_of_range', value: quality });
	}

	const compression = Number(request.compression ?? request.settings?.compression ?? 6);
	if (!Number.isFinite(compression) || compression < 0 || compression > 9) {
		issues.push({ field: 'compression', reason: 'out_of_range', value: compression });
	}

	const hasDoc = request.document != null || request.configuration != null;
	const hasId = Boolean(request.templateId);
	if (!hasDoc && !hasId) {
		issues.push({ field: 'document', reason: 'document_or_templateId_required' });
	}

	if (hasDoc) {
		const doc = request.document || request.configuration;
		if (!doc || typeof doc !== 'object') {
			issues.push({ field: 'document', reason: 'invalid_document' });
		}
	}

	const transparent = Boolean(request.transparent ?? request.settings?.transparent);
	if (transparent && !['png', 'webp', 'svg'].includes(format)) {
		issues.push({
			field: 'transparent',
			reason: 'transparency_unsupported_for_format',
			value: format,
			severity: 'warning',
		});
	}

	const errors = issues.filter((i) => i.severity !== 'warning');
	const profile = getExportProfile(profileId);
	const normalized = {
		profileId: profile.id,
		presetId: request.presetId || null,
		format: format === 'jpeg' ? 'jpg' : format,
		templateId: request.templateId || null,
		document: request.document || request.configuration || null,
		variables: request.variables || request.context || {},
		brandKit: request.brandKit || null,
		watermark: request.watermark || null,
		settings: {
			width: Number.isFinite(width) ? width : profile.width,
			height: Number.isFinite(height) ? height : profile.height,
			dpi,
			quality,
			background: request.background ?? request.settings?.background ?? '#ffffff',
			transparent,
			compression,
		},
	};

	return {
		ok: errors.length === 0,
		issues,
		normalized: errors.length === 0 ? normalized : null,
	};
}

export function assertExportRequest(request) {
	const result = validateExportRequest(request);
	if (!result.ok) {
		throw new ExportValidationError('Invalid export request', result.issues);
	}
	return result.normalized;
}

/**
 * Validate a document is exportable (v1 or v2).
 */
export function validateExportDocument(document) {
	const issues = [];
	if (!document || typeof document !== 'object') {
		return { ok: false, issues: [{ reason: 'missing_document' }], kind: null };
	}
	if (isV2Document(document) || Array.isArray(document.layers)) {
		if (!document.layers?.length) {
			issues.push({ reason: 'empty_layers', severity: 'warning' });
		}
		return { ok: true, issues, kind: 'v2' };
	}
	// v1 procedural
	if (document.canvas || document.typography || document.layout) {
		return { ok: true, issues, kind: 'v1' };
	}
	issues.push({ reason: 'unrecognized_document' });
	return { ok: false, issues, kind: null };
}
