/**
 * Client-facing Export Service — facade over Export Engine.
 * React components must call this module only (no export logic in UI).
 */

import {
	runExport,
	runExportJob,
	runExportBatch,
	buildExportPlan,
	createLocalExportQueue,
	prepareExportDocument,
	applyExportCanvasSize,
	cancelExportJob,
	cancelExportBatch,
	getExportJob,
	EXPORT_JOB_STATUS,
} from '@/lib/pinExportEngine';
import { listExportProfiles, getExportProfile } from '@/lib/pinExportProfiles';
import {
	listExportPresets,
	getExportPreset,
	registerExportPreset,
	resolvePresetSettings,
} from '@/lib/pinExportPresets';
import {
	validateExportRequest,
	validateExportDocument,
	listSupportedExportFormats,
} from '@/lib/pinExportValidation';
import { createBrowserCanvasSurface } from '@/lib/pinLayerCompositor';
import apiServerClient from '@/lib/apiServerClient';

async function workspaceJson(path, options = {}) {
	const response = await apiServerClient.fetch(`/workspace/v1${path}`, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			...(options.headers || {}),
		},
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload.message || payload.error || `Request failed: ${path}`);
	}
	return payload;
}

function defaultRuntime(overrides = {}) {
	const hasDom = typeof document !== 'undefined';
	return {
		createSurface: overrides.createSurface
			|| (hasDom ? createBrowserCanvasSurface : undefined),
		loadImageFn: overrides.loadImageFn,
		...overrides,
	};
}

export const exportService = {
	listProfiles: listExportProfiles,
	getProfile: getExportProfile,
	listPresets: listExportPresets,
	getPreset: getExportPreset,
	registerPreset: registerExportPreset,
	resolvePreset: resolvePresetSettings,
	listFormats: listSupportedExportFormats,
	validate: validateExportRequest,
	validateDocument: validateExportDocument,
	buildPlan: buildExportPlan,
	prepareDocument: prepareExportDocument,
	applyCanvasSize: applyExportCanvasSize,

	async export(request, runtime = {}) {
		return runExport(request, defaultRuntime(runtime));
	},

	async exportJob(request, runtime = {}) {
		return runExportJob(request, defaultRuntime(runtime));
	},

	async exportBatch(items, runtime = {}) {
		return runExportBatch(items, defaultRuntime(runtime));
	},

	cancelJob: cancelExportJob,
	cancelBatch: cancelExportBatch,
	getJob: getExportJob,
	jobStatus: EXPORT_JOB_STATUS,

	createQueue(runtime = {}) {
		return createLocalExportQueue(defaultRuntime(runtime));
	},

	/** Server: validate / plan only (no pixels). */
	async planRemote(body) {
		return workspaceJson('/templates/export/plan', {
			method: 'POST',
			body: JSON.stringify(body || {}),
		});
	},

	async enqueueRemote(body) {
		return workspaceJson('/templates/export/enqueue', {
			method: 'POST',
			body: JSON.stringify(body || {}),
		});
	},

	async planBatchRemote(body) {
		return workspaceJson('/templates/export/batch', {
			method: 'POST',
			body: JSON.stringify(body || {}),
		});
	},

	async importPackage(body) {
		return workspaceJson('/templates/import', {
			method: 'POST',
			body: JSON.stringify(body || {}),
		});
	},

	async listRemoteProfiles() {
		return workspaceJson('/templates/export/profiles', { method: 'GET' });
	},
};

export default exportService;
