import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/apiServerClient', () => ({
	default: {
		fetch: vi.fn(),
	},
}));

vi.mock('@/lib/pocketbaseClient', () => {
	const create = vi.fn();
	const getOne = vi.fn();
	const update = vi.fn();
	return {
		default: {
			authStore: { record: { id: 'user_1' } },
			collection: vi.fn(() => ({ create, getOne, update })),
			__mocks: { create, getOne, update },
		},
	};
});

import apiServerClient from '@/lib/apiServerClient';
import pb from '@/lib/pocketbaseClient';
import {
	duplicatePin,
	mapSavedPin,
	saveDrafts,
} from '../draftService.js';
import { buildPinPreview, validatePreviewReady } from '../previewService.js';
import {
	formatImageSourceLabel,
	validatePinForPinterestPublish,
} from '@/lib/pinPublishDestination.js';

const SAMPLE_CONFIG = {
	schemaVersion: 2,
	layers: [{ id: 'title', type: 'text', text: 'Hello' }],
};

function previewPin(overrides = {}) {
	return {
		tempId: 'tmp_1',
		articleId: 'art_1',
		websiteId: 'web_1',
		title: 'Chocolate Cake Pin',
		description: 'Bake tonight',
		overlayText: 'Save Recipe',
		imagePrompt: 'prompt',
		imageUrl: 'https://cdn.example/pins/rendered.png',
		imageSource: 'featured_composed',
		imageOrigin: 'featured',
		imageGenerationStatus: 'completed',
		sourceUrl: 'https://blog.example/recipes/chocolate-cake',
		articleUrl: 'https://blog.example/recipes/chocolate-cake',
		templateId: 'tpl_1',
		templateName: 'Gallery Hero',
		templateVersion: '2.1.4@7c2f9ab',
		templateConfig: SAMPLE_CONFIG,
		templateThumbnail: 'https://cdn.example/thumbs/hero.png',
		templateSnapshotAt: '2026-07-26T08:00:00.000Z',
		suggestedKeywords: ['cake'],
		suggestedHashtags: ['#dessert'],
		...overrides,
	};
}

function savedRecord(overrides = {}) {
	return {
		id: 'pin_1',
		articleId: 'art_1',
		websiteId: 'web_1',
		title: 'Chocolate Cake Pin',
		description: 'Bake tonight',
		image_url: 'https://cdn.example/pins/rendered.png',
		image_source: 'featured_composed',
		image_origin: 'featured',
		source_url: 'https://blog.example/recipes/chocolate-cake',
		status: 'draft',
		template_id: 'tpl_1',
		template_name: 'Gallery Hero',
		template_configuration: SAMPLE_CONFIG,
		...overrides,
	};
}

describe('destination URL draft + publish persistence', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		pb.authStore.record = { id: 'user_1' };
		pb.__mocks.create.mockReset();
		pb.__mocks.getOne.mockReset();
		pb.__mocks.update.mockReset();
		apiServerClient.fetch.mockReset();
	});

	it('Save Draft stores source_url, image_origin, template, image via API', async () => {
		apiServerClient.fetch.mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({ items: [savedRecord()] }),
		});

		const [saved] = await saveDrafts({
			previewPins: [previewPin()],
			panel: { targetAudience: '', toneOfVoice: '', language: 'en' },
		});

		expect(apiServerClient.fetch).toHaveBeenCalledWith(
			'/ai-pins/drafts',
			expect.objectContaining({ method: 'POST' }),
		);
		const body = JSON.parse(apiServerClient.fetch.mock.calls[0][1].body);
		expect(body.items[0].source_url).toContain('chocolate-cake');
		expect(body.items[0].image_origin).toBe('featured');
		expect(body.items[0].image_url).toContain('rendered.png');
		expect(body.items[0].template_name).toBe('Gallery Hero');
		expect(saved.sourceUrl).toContain('chocolate-cake');
		expect(saved.imageOrigin).toBe('featured');
		expect(saved.templateName).toBe('Gallery Hero');
	});

	it('Reload Draft restores article URL, template, image source, image, title, description', () => {
		const reloaded = mapSavedPin(savedRecord({
			image_source: 'ai_generated',
			image_origin: 'ai',
		}));

		expect(reloaded.sourceUrl).toContain('chocolate-cake');
		expect(reloaded.destinationUrl).toContain('chocolate-cake');
		expect(reloaded.articleUrl).toContain('chocolate-cake');
		expect(reloaded.templateName).toBe('Gallery Hero');
		expect(reloaded.templateConfig.layers[0].id).toBe('title');
		expect(reloaded.imageSource).toBe('ai_generated');
		expect(reloaded.imageOrigin).toBe('ai');
		expect(reloaded.imageUrl).toContain('rendered.png');
		expect(reloaded.title).toBe('Chocolate Cake Pin');
		expect(reloaded.description).toBe('Bake tonight');
		expect(formatImageSourceLabel(reloaded)).toBe('AI Generated');
	});

	it('Publish preview exposes Image Source, Template Name, Destination URL', () => {
		const preview = buildPinPreview({
			pin: previewPin({ imageOrigin: 'body', imageSource: 'featured_composed' }),
			account: { id: 'acc_1', label: 'Chef' },
			board: { boardId: 'board_1', name: 'Recipes' },
		});

		expect(preview.imageSourceLabel).toBe('Body Image');
		expect(preview.templateName).toBe('Gallery Hero');
		expect(preview.destinationUrl).toContain('chocolate-cake');
		expect(validatePreviewReady(preview).ok).toBe(true);
	});

	it('Publish validation requires destination URL, image, and title', () => {
		expect(validatePinForPinterestPublish({
			title: '',
			imageUrl: '',
			sourceUrl: '',
		}).ok).toBe(false);

		expect(validatePinForPinterestPublish({
			title: 'Ok',
			imageUrl: 'https://cdn.example/a.png',
			sourceUrl: 'not-a-url',
		}).errors.join(' ')).toMatch(/valid/i);

		expect(validatePinForPinterestPublish({
			title: 'Ok',
			imageUrl: 'https://cdn.example/a.png',
			sourceUrl: 'https://blog.example/a',
		}).ok).toBe(true);
	});

	it('Save Draft refuses to persist a pin without source_url', async () => {
		await expect(saveDrafts({
			previewPins: [previewPin({ sourceUrl: '', articleUrl: '', destinationUrl: '' })],
			panel: {},
		})).rejects.toThrow(/source_url/i);
		expect(apiServerClient.fetch).not.toHaveBeenCalled();
	});

	it('Save Draft fails hard when API returns pin without source_url', async () => {
		apiServerClient.fetch.mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({
				items: [savedRecord({ source_url: '' })],
			}),
		});

		await expect(saveDrafts({
			previewPins: [previewPin()],
			panel: {},
		})).rejects.toThrow(/without source_url/i);
	});

	it('Duplicate Draft preserves destination URL + template', async () => {
		pb.__mocks.getOne.mockResolvedValue(savedRecord());
		pb.__mocks.create.mockResolvedValue(savedRecord({
			id: 'pin_2',
			title: 'Chocolate Cake Pin (Copy)',
		}));

		const copy = await duplicatePin({ id: 'pin_1' });
		const createArg = pb.__mocks.create.mock.calls[0][0];
		expect(createArg.source_url).toContain('chocolate-cake');
		expect(createArg.template_name).toBe('Gallery Hero');
		expect(copy.sourceUrl).toContain('chocolate-cake');
	});
});
