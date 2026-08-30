import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/ai-pins/featuredComposeService.js', () => ({
	composeAndUploadFeaturedPins: vi.fn(async (pins) => pins.map((pin) => ({
		tempId: pin.tempId,
		ok: true,
		imageUrl: `https://cdn.example/composed-${pin.tempId}.png`,
		hosted: true,
	}))),
}));

import { composeAndUploadFeaturedPins } from '@/services/ai-pins/featuredComposeService.js';
import {
	composeTerminalPreviewPins,
	runPreviewImagePipeline,
} from '../previewImagePipeline.js';

describe('previewImagePipeline compose-on-completion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('composes each terminal pin independently and tracks composed tempIds', async () => {
		const aiPins = [
			{ tempId: 'p1', featuredImage: 'https://cdn.example/a.jpg', sourceImageUrl: 'https://cdn.example/a.jpg' },
			{ tempId: 'p2', featuredImage: 'https://cdn.example/a.jpg', sourceImageUrl: 'https://cdn.example/a.jpg' },
		];
		const composedTempIds = new Set();
		const jobs = [
			{ id: 'j1', clientToken: 'p1', status: 'completed', imageUrl: 'https://cdn.example/ai-1.png' },
		];

		const first = await composeTerminalPreviewPins({
			aiPins,
			jobs,
			queuedJobs: jobs,
			composedTempIds,
		});
		expect(first).toHaveLength(1);
		expect(first[0].tempId).toBe('p1');
		expect(first[0].patch.imageUrl).toBe('https://cdn.example/composed-p1.png');
		expect(composedTempIds.has('p1')).toBe(true);
		expect(composeAndUploadFeaturedPins).toHaveBeenCalledTimes(1);

		const jobs2 = [
			...jobs,
			{ id: 'j2', clientToken: 'p2', status: 'completed', imageUrl: 'https://cdn.example/ai-2.png' },
		];
		const second = await composeTerminalPreviewPins({
			aiPins,
			jobs: jobs2,
			queuedJobs: jobs2,
			composedTempIds,
		});
		expect(second).toHaveLength(1);
		expect(second[0].tempId).toBe('p2');
		expect(composeAndUploadFeaturedPins).toHaveBeenCalledTimes(2);
	});

	it('does not compose the same tempId twice', async () => {
		const aiPins = [{ tempId: 'p1', featuredImage: 'https://cdn.example/a.jpg', sourceImageUrl: 'https://cdn.example/a.jpg' }];
		const jobs = [{ id: 'j1', clientToken: 'p1', status: 'completed', imageUrl: 'https://cdn.example/ai-1.png' }];
		const composedTempIds = new Set();

		await composeTerminalPreviewPins({ aiPins, jobs, queuedJobs: jobs, composedTempIds });
		const again = await composeTerminalPreviewPins({ aiPins, jobs, queuedJobs: jobs, composedTempIds });
		expect(again).toHaveLength(0);
		expect(composeAndUploadFeaturedPins).toHaveBeenCalledTimes(1);
	});

	it('runPreviewImagePipeline composes pin 1 before pin 3 job completes', async () => {
		const composeOrder = [];
		composeAndUploadFeaturedPins.mockImplementation(async (pins) => {
			composeOrder.push(pins[0]?.tempId);
			return pins.map((pin) => ({
				tempId: pin.tempId,
				ok: true,
				imageUrl: `https://cdn.example/composed-${pin.tempId}.png`,
				hosted: true,
			}));
		});

		let pollCount = 0;
		const fetchFn = vi.fn(async (url) => {
			if (String(url).includes('/jobs?ids=')) {
				pollCount += 1;
				if (pollCount === 1) {
					return {
						ok: true,
						json: async () => ({
							items: [
								{ id: 'j1', clientToken: 'p1', status: 'completed', imageUrl: 'https://cdn.example/ai-1.png' },
								{ id: 'j3', clientToken: 'p3', status: 'processing', imageUrl: '' },
							],
						}),
					};
				}
				return {
					ok: true,
					json: async () => ({
						items: [
							{ id: 'j1', clientToken: 'p1', status: 'completed', imageUrl: 'https://cdn.example/ai-1.png' },
							{ id: 'j3', clientToken: 'p3', status: 'completed', imageUrl: 'https://cdn.example/ai-3.png' },
						],
					}),
				};
			}
			if (String(url).includes('/jobs') && !String(url).includes('?ids=')) {
				return {
					ok: true,
					json: async () => ({
						items: [
							{ id: 'j1', clientToken: 'p1', status: 'queued' },
							{ id: 'j3', clientToken: 'p3', status: 'queued' },
						],
					}),
				};
			}
			return { ok: true, json: async () => ({ items: [] }) };
		});

		const incremental = [];
		const result = await runPreviewImagePipeline({
			fetchFn,
			pins: [
				{
					tempId: 'p1',
					articleId: 'a1',
					title: 'One',
					imageMode: 'generate_ai',
					imagePlan: { imageMode: 'generate_ai' },
					featuredImage: 'https://cdn.example/a.jpg',
					sourceImageUrl: 'https://cdn.example/a.jpg',
				},
				{
					tempId: 'p3',
					articleId: 'a1',
					title: 'Three',
					imageMode: 'generate_ai',
					imagePlan: { imageMode: 'generate_ai' },
					featuredImage: 'https://cdn.example/a.jpg',
					sourceImageUrl: 'https://cdn.example/a.jpg',
				},
			],
			onPinPatch: (item) => incremental.push(item.tempId),
		});

		expect(composeOrder[0]).toBe('p1');
		expect(incremental[0]).toBe('p1');
		expect(incremental).toContain('p3');
		expect(result.pinPatches.map((item) => item.tempId)).toEqual(expect.arrayContaining(['p1', 'p3']));
	});

	it('respects cancellation for incremental compose patches', async () => {
		const patches = await composeTerminalPreviewPins({
			aiPins: [{ tempId: 'p1', featuredImage: 'https://cdn.example/a.jpg', sourceImageUrl: 'https://cdn.example/a.jpg' }],
			jobs: [{ id: 'j1', clientToken: 'p1', status: 'completed', imageUrl: 'https://cdn.example/ai-1.png' }],
			queuedJobs: [{ id: 'j1', clientToken: 'p1', status: 'completed', imageUrl: 'https://cdn.example/ai-1.png' }],
			isCancelled: () => true,
		});
		expect(patches).toEqual([]);
		expect(composeAndUploadFeaturedPins).not.toHaveBeenCalled();
	});

	it('featured pins compose without AI queue and emit incremental patches', async () => {
		const incremental = [];
		const fetchFn = vi.fn();
		const result = await runPreviewImagePipeline({
			fetchFn,
			pins: [{
				tempId: 'f1',
				articleId: 'a1',
				title: 'Featured',
				imageMode: 'use_featured',
				imagePlan: { imageMode: 'use_featured' },
				featuredImage: 'https://cdn.example/a.jpg',
				sourceImageUrl: 'https://cdn.example/a.jpg',
			}],
			onPinPatch: (item) => incremental.push(item.tempId),
		});
		expect(fetchFn).not.toHaveBeenCalled();
		expect(incremental).toEqual(['f1']);
		expect(result.pinPatches[0].patch.imageUrl).toContain('composed-f1');
	});

	it('one failed job does not block compose for completed jobs', async () => {
		const aiPins = [
			{ tempId: 'ok', featuredImage: 'https://cdn.example/a.jpg', sourceImageUrl: 'https://cdn.example/a.jpg' },
			{ tempId: 'bad', featuredImage: 'https://cdn.example/a.jpg', sourceImageUrl: 'https://cdn.example/a.jpg' },
		];
		const jobs = [
			{ id: 'j-ok', clientToken: 'ok', status: 'completed', imageUrl: 'https://cdn.example/ai-ok.png' },
			{ id: 'j-bad', clientToken: 'bad', status: 'failed', lastError: 'provider down' },
		];
		const patches = await composeTerminalPreviewPins({
			aiPins,
			jobs,
			queuedJobs: jobs,
		});
		expect(patches.map((item) => item.tempId).sort()).toEqual(['bad', 'ok']);
		expect(patches.find((item) => item.tempId === 'ok')?.patch.imageUrl).toContain('composed-ok');
		const bad = patches.find((item) => item.tempId === 'bad');
		expect(bad?.patch.imageUrl).toBe('');
		expect(bad?.patch.imageGenerationStatus).toBe('failed');
		expect(bad?.patch.imageGenerationError).toMatch(/failed|provider/i);
	});

	it('count=1 AI pin still composes on completion', async () => {
		const fetchFn = vi.fn(async (url) => {
			if (String(url).includes('/jobs?ids=')) {
				return {
					ok: true,
					json: async () => ({
						items: [{ id: 'j1', clientToken: 'solo', status: 'completed', imageUrl: 'https://cdn.example/ai.png' }],
					}),
				};
			}
			return {
				ok: true,
				json: async () => ({ items: [{ id: 'j1', clientToken: 'solo', status: 'queued' }] }),
			};
		});
		const result = await runPreviewImagePipeline({
			fetchFn,
			pins: [{
				tempId: 'solo',
				articleId: 'a1',
				title: 'Solo',
				imageMode: 'generate_ai',
				imagePlan: { imageMode: 'generate_ai' },
				featuredImage: 'https://cdn.example/a.jpg',
				sourceImageUrl: 'https://cdn.example/a.jpg',
			}],
		});
		expect(result.pinPatches).toHaveLength(1);
		expect(result.pinPatches[0].tempId).toBe('solo');
	});
});
