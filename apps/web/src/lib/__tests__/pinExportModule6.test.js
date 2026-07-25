import { describe, expect, it, beforeEach } from 'vitest';
import { createEmptyLayerDocument } from '../pinLayerSchema.js';
import { createDefaultTemplateConfig } from '../pinTemplates.js';
import { createMockRenderSurface } from '../pinLayerCompositor.js';
import { listExportProfiles, getExportProfile } from '../pinExportProfiles.js';
import {
	listExportPresets,
	registerExportPreset,
	resetExportPresetsForTests,
	resolvePresetSettings,
} from '../pinExportPresets.js';
import {
	validateExportRequest,
	validateExportDocument,
	listSupportedExportFormats,
} from '../pinExportValidation.js';
import {
	applyExportCanvasSize,
	prepareExportDocument,
	runExport,
	runExportJob,
	runExportBatch,
	buildExportPlan,
	cancelExportJob,
} from '../pinExportEngine.js';
import {
	resetExportJobsForTests,
	createRemoteExportQueueAdapter,
	createExportJob,
} from '../pinExportJobs.js';
import {
	registerWatermarkHook,
	resetWatermarkHooksForTests,
	applyWatermarkPipeline,
} from '../pinExportWatermark.js';
import { getRenderTarget, UnsupportedRenderFormatError } from '../pinRenderTargets.js';

function sampleV2Doc() {
	const doc = createEmptyLayerDocument({ width: 1000, height: 1500 });
	doc.layers = [
		{
			type: 'background',
			x: 0,
			y: 0,
			width: 1000,
			height: 1500,
			props: { color: '#112233' },
		},
		{
			type: 'text',
			x: 40,
			y: 100,
			width: 900,
			height: 120,
			props: { text: '{{title}}', fontSize: 48 },
		},
	];
	return doc;
}

describe('Export Engine Module 6', () => {
	beforeEach(() => {
		resetExportPresetsForTests();
		resetExportJobsForTests();
		resetWatermarkHooksForTests();
	});

	it('lists social export profiles', () => {
		const profiles = listExportProfiles();
		expect(profiles.map((p) => p.id)).toEqual(expect.arrayContaining([
			'pinterest_standard',
			'pinterest_long',
			'instagram_square',
			'instagram_portrait',
			'facebook_post',
			'facebook_story',
			'custom',
		]));
		expect(getExportProfile('instagram_square').width).toBe(1080);
	});

	it('resolves presets and validates requests', () => {
		const resolved = resolvePresetSettings('pinterest_png_hq');
		expect(resolved.profile.id).toBe('pinterest_standard');
		expect(resolved.format).toBe('png');

		const ok = validateExportRequest({
			profileId: 'pinterest_standard',
			format: 'png',
			document: sampleV2Doc(),
		});
		expect(ok.ok).toBe(true);
		expect(ok.normalized.settings.width).toBe(1000);

		const bad = validateExportRequest({
			format: 'webp',
			document: sampleV2Doc(),
		});
		expect(bad.ok).toBe(false);
		expect(bad.issues.some((i) => i.reason === 'format_not_implemented')).toBe(true);

		const formats = listSupportedExportFormats();
		expect(formats.implemented).toContain('png');
		expect(formats.architectureReady).toEqual(expect.arrayContaining(['jpg', 'webp', 'pdf', 'svg', 'mp4']));
	});

	it('registers custom presets without overwriting builtins', () => {
		registerExportPreset({
			id: 'workspace_square',
			label: 'Workspace Square',
			profileId: 'instagram_square',
			format: 'png',
			settings: { quality: 0.8 },
		});
		expect(listExportPresets().some((p) => p.id === 'workspace_square')).toBe(true);
		expect(() => registerExportPreset({ id: 'pinterest_png_hq' })).toThrow(/builtin/);
	});

	it('prepares v1 documents in-memory for export', () => {
		const v1 = createDefaultTemplateConfig();
		expect(validateExportDocument(v1).kind).toBe('v1');
		const prepared = prepareExportDocument(v1);
		expect(prepared.layers.length).toBeGreaterThan(0);
		expect(prepared.editorVersion).toBe(2);
	});

	it('scales document to profile canvas size', () => {
		const scaled = applyExportCanvasSize(sampleV2Doc(), 1080, 1080);
		expect(scaled.canvas.width).toBe(1080);
		expect(scaled.canvas.height).toBe(1080);
		expect(scaled.layers[0].width).toBe(1080);
	});

	it('exports PNG via RenderTarget using mock surface', async () => {
		const result = await runExport(
			{
				profileId: 'pinterest_standard',
				format: 'png',
				document: sampleV2Doc(),
				variables: { title: 'Exported Pin' },
			},
			{ createSurface: createMockRenderSurface },
		);
		expect(result.format).toBe('png');
		expect(result.mimeType).toBe('image/png');
		expect(result.bytes[0]).toBe(0x89);
		expect(result.document.layers[1].props.text).toBe('Exported Pin');
		expect(result.settings.width).toBe(1000);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it('exports Instagram profile size from Pinterest-sized doc', async () => {
		const result = await runExport(
			{
				profileId: 'instagram_square',
				format: 'png',
				document: sampleV2Doc(),
			},
			{ createSurface: createMockRenderSurface },
		);
		expect(result.settings.width).toBe(1080);
		expect(result.settings.height).toBe(1080);
		expect(result.document.canvas.width).toBe(1080);
	});

	it('supports cancellable export jobs', async () => {
		const { job, result } = await runExportJob(
			{ document: sampleV2Doc(), format: 'png' },
			{ createSurface: createMockRenderSurface },
		);
		expect(job.status).toBe('completed');
		expect(result.bytes.length).toBeGreaterThan(0);

		const pending = createExportJob({ document: sampleV2Doc() });
		const cancelled = cancelExportJob(pending.id);
		expect(cancelled.ok).toBe(true);
		expect(cancelled.job.status).toBe('cancelled');
	});

	it('batch exports multiple documents', async () => {
		const batch = await runExportBatch(
			[
				{ document: sampleV2Doc(), profileId: 'pinterest_standard' },
				{ document: sampleV2Doc(), profileId: 'facebook_post' },
			],
			{ createSurface: createMockRenderSurface, concurrency: 2 },
		);
		expect(batch.completed).toBe(2);
		expect(batch.results[1].result.settings.width).toBe(1200);
	});

	it('runs watermark pipeline hooks before render', async () => {
		registerWatermarkHook('mark', ({ document }) => ({
			...document,
			meta: { ...(document.meta || {}), watermarked: true },
		}));
		const out = await applyWatermarkPipeline({
			document: sampleV2Doc(),
			settings: {},
			watermark: { text: '©' },
		});
		expect(out.meta.watermarked).toBe(true);
	});

	it('keeps RenderTarget stubs for future formats', async () => {
		await expect(getRenderTarget('svg').encode()).rejects.toBeInstanceOf(UnsupportedRenderFormatError);
		await expect(getRenderTarget('jpg').encode()).rejects.toBeInstanceOf(UnsupportedRenderFormatError);
	});

	it('builds export plans with queue architecture metadata', () => {
		const plan = buildExportPlan({
			document: sampleV2Doc(),
			profileId: 'facebook_story',
			format: 'png',
		});
		expect(plan.ok).toBe(true);
		expect(plan.queue.jobType).toBe('export');
		expect(plan.queue.backgroundQueueReady).toBe(true);
		expect(plan.profile.height).toBe(1920);
	});

	it('remote queue adapter enqueues without encoding', async () => {
		const calls = [];
		const adapter = createRemoteExportQueueAdapter({
			enqueueRemote: async (payload) => {
				calls.push(payload);
				return { id: 'remote_1' };
			},
		});
		const job = createExportJob({ document: sampleV2Doc() });
		const snap = await adapter.enqueue(job);
		expect(snap.remoteJobId).toBe('remote_1');
		expect(calls[0].type).toBe('export');
	});
});
