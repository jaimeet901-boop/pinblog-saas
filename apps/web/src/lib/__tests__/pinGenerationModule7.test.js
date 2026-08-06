import { describe, expect, it, vi } from 'vitest';
import { createEmptyLayerDocument } from '../pinLayerSchema.js';
import { createDefaultTemplateConfig } from '../pinTemplates.js';
import { createMockRenderSurface } from '../pinLayerCompositor.js';
import { mockExportRuntime } from '@/test-utils/mockApiFetch.js';
import { exportService } from '../../services/templates/exportService.js';
import {
	validateGenerationRequest,
	cloneTemplateForGeneration,
	buildGenerationVariableContext,
	runPinGenerationPipeline,
	classifyGenerationError,
	nextRetryDelayMs,
	pinGenerationExtensions,
	PinGenerationError,
} from '../pinGenerationPipeline.js';
import {
	PIN_GENERATION_STAGES,
	stageProgress,
} from '../pinGenerationConstants.js';

function sampleDoc() {
	const doc = createEmptyLayerDocument({ width: 1000, height: 1500 });
	doc.layers = [
		{ type: 'background', x: 0, y: 0, width: 1000, height: 1500, props: { color: '#111' } },
		{ type: 'image', x: 0, y: 0, width: 1000, height: 900, props: { src: '{{image}}' } },
		{ type: 'text', x: 40, y: 1000, width: 920, height: 120, props: { text: '{{title}}' } },
	];
	return doc;
}

describe('Pin Generation Module 7', () => {
	const exportRuntime = mockExportRuntime(createMockRenderSurface);

	it('exposes full progress stages', () => {
		expect(PIN_GENERATION_STAGES).toEqual(expect.arrayContaining([
			'queued',
			'preparing',
			'generating_image',
			'resolving_variables',
			'rendering',
			'exporting',
			'completed',
			'failed',
			'cancelled',
		]));
		expect(stageProgress('exporting')).toBe(90);
	});

	it('validates generation choices', () => {
		const bad = validateGenerationRequest({ imageMode: 'generate_ai' });
		expect(bad.ok).toBe(false);

		const ok = validateGenerationRequest({
			imageMode: 'provided_url',
			imageUrl: 'https://cdn/img.png',
			templateConfiguration: sampleDoc(),
			exportProfileId: 'instagram_square',
			format: 'png',
		});
		expect(ok.ok).toBe(true);
		expect(ok.normalized.exportProfileId).toBe('instagram_square');
	});

	it('clones templates and never returns the same reference', () => {
		const source = sampleDoc();
		const clone = cloneTemplateForGeneration(source);
		clone.layers[0].props.color = '#fff';
		expect(source.layers[0].props.color).toBe('#111');
	});

	it('builds variable context from content + image', () => {
		const ctx = buildGenerationVariableContext({
			content: { title: 'Cake' },
			imageUrl: 'https://cdn/ai.png',
			brandKit: { logoUrl: 'https://cdn/logo.png' },
		});
		expect(ctx.title).toBe('Cake');
		expect(ctx.image).toBe('https://cdn/ai.png');
		expect(ctx.logo).toBe('https://cdn/logo.png');
	});

	it('orchestrates modules via adapters without mutating template', async () => {
		const source = sampleDoc();
		const stages = [];
		const result = await runPinGenerationPipeline(
			{
				imageMode: 'provided_url',
				imageUrl: 'https://cdn/ai.png',
				templateConfiguration: source,
				exportProfileId: 'pinterest_standard',
				format: 'png',
				content: { title: 'Hello Pin' },
			},
			{
				onStage: async (stage) => { stages.push(stage); },
				async exportPin(args) {
					expect(args.variables.title).toBe('Hello Pin');
					expect(args.variables.image).toBe('https://cdn/ai.png');
					return exportService.export(
						{
							document: args.document,
							profileId: args.profileId,
							format: args.format,
							variables: args.variables,
						},
						exportRuntime,
					);
				},
				async uploadResult({ bytes }) {
					expect(bytes[0]).toBe(0x89);
					return { imageUrl: 'https://cdn/final.png' };
				},
			},
		);

		expect(result.ok).toBe(true);
		expect(result.imageUrl).toBe('https://cdn/final.png');
		expect(stages).toContain('preparing');
		expect(stages).toContain('resolving_variables');
		expect(stages).toContain('exporting');
		expect(stages).toContain('completed');
		expect(source.layers[2].props.text).toBe('{{title}}');
	});

	it('supports AI generate_ai adapter hook', async () => {
		const generateImage = vi.fn(async () => ({ imageUrl: 'https://cdn/provider.png' }));
		const result = await runPinGenerationPipeline(
			{
				imageMode: 'generate_ai',
				imageProvider: 'openai',
				templateConfiguration: sampleDoc(),
				format: 'png',
				content: { title: 'AI' },
			},
			{
				generateImage,
				async exportPin(args) {
					expect(args.variables.image).toBe('https://cdn/provider.png');
					return {
						bytes: new Uint8Array([0x89, 0x50]),
						mimeType: 'image/png',
						format: 'png',
						imageUrl: 'https://cdn/out.png',
					};
				},
			},
		);
		expect(generateImage).toHaveBeenCalledOnce();
		expect(result.imageUrl).toBe('https://cdn/out.png');
	});

	it('works with v1 procedural templates via export engine', async () => {
		const v1 = createDefaultTemplateConfig();
		const result = await runPinGenerationPipeline(
			{
				imageMode: 'use_featured',
				featuredImageUrl: 'https://cdn/featured.jpg',
				templateConfiguration: v1,
				format: 'png',
				content: { title: 'Legacy' },
			},
			{
				async exportPin(args) {
					return exportService.export(
						{
							document: args.document,
							profileId: 'pinterest_standard',
							format: 'png',
							variables: args.variables,
						},
						exportRuntime,
					);
				},
				async uploadResult() {
					return { imageUrl: 'https://cdn/v1-final.png' };
				},
			},
		);
		expect(result.ok).toBe(true);
		expect(result.imageUrl).toBe('https://cdn/v1-final.png');
	});

	it('classifies recoverable errors and retry delays', () => {
		expect(classifyGenerationError({ message: 'timeout' }).recoverable).toBe(true);
		expect(classifyGenerationError({ code: 'CANCELLED' }).recoverable).toBe(false);
		expect(nextRetryDelayMs(1)).toBe(60_000);
		expect(nextRetryDelayMs(10)).toBe(300_000);
		expect(new PinGenerationError('x', { code: 'PROVIDER_RATE_LIMIT' }).recoverable).toBe(true);
	});

	it('provides extension helpers for batch / A/B / locale / schedule / team', () => {
		const batch = pinGenerationExtensions.buildBatchRequests(
			[{ content: { title: 'A' } }, { content: { title: 'B' } }],
			{ exportProfileId: 'instagram_square' },
		);
		expect(batch).toHaveLength(2);
		expect(batch[0].extensions.batchId).toBe(batch[1].extensions.batchId);

		const ab = pinGenerationExtensions.withTemplateVariant({ a: 1 }, { variantId: 'v2', abGroup: 'B' });
		expect(ab.extensions.variantId).toBe('v2');

		const loc = pinGenerationExtensions.withLocale({}, 'fr');
		expect(loc.extensions.locale).toBe('fr');

		const sched = pinGenerationExtensions.withSchedule({}, '2030-01-01T00:00:00Z');
		expect(sched.extensions.scheduleAt).toContain('2030');

		const team = pinGenerationExtensions.withTeamWorkspace({}, { workspaceId: 'w1', teamId: 't1' });
		expect(team.extensions.teamId).toBe('t1');
	});

	it('cancels when abort signal fires', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(runPinGenerationPipeline(
			{
				imageMode: 'provided_url',
				imageUrl: 'https://x',
				templateConfiguration: sampleDoc(),
			},
			{
				signal: controller.signal,
				async exportPin() {
					return { bytes: new Uint8Array(), format: 'png' };
				},
			},
		)).rejects.toMatchObject({ code: 'CANCELLED' });
	});
});
