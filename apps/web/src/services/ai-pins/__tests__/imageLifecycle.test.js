import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildPocketbaseClientMock,
	mockJsonResponse,
} from '@/test-utils/mockApiFetch.js';

vi.mock('@/lib/apiServerClient', () => ({
	default: {
		fetch: vi.fn(),
	},
}));

vi.mock('@/lib/pocketbaseClient', async () => {
	const { buildPocketbaseClientMock } = await import('@/test-utils/mockApiFetch.js');
	const { vi: vitestVi } = await import('vitest');
	return buildPocketbaseClientMock(vitestVi, { includeGetFullList: true });
});

import apiServerClient from '@/lib/apiServerClient';
import pb from '@/lib/pocketbaseClient';
import {
	canSaveAllPinDrafts,
	canSavePinDraft,
	ensureHostedImageForPin,
	ensurePinsReadyForSave,
	isBlobImageUrl,
	isPersistableImageUrl,
	uploadBlobImageUrl,
} from '../imageLifecycle.js';
import { mapSavedPin, saveDrafts } from '../draftService.js';

function mockUploadOk(url = 'https://cdn.example/pins/hosted.png') {
	apiServerClient.fetch.mockResolvedValue(mockJsonResponse({
		ok: true,
		status: 201,
		body: { imageUrl: url, imageSource: 'featured_composed' },
	}));
}

describe('AI Pin image lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		pb.authStore.record = { id: 'user_1' };
		global.fetch = vi.fn();
	});

	it('treats only http(s) as persistable — not blob or empty', () => {
		expect(isPersistableImageUrl('https://cdn.example/a.png')).toBe(true);
		expect(isPersistableImageUrl('http://cdn.example/a.png')).toBe(true);
		expect(isPersistableImageUrl('blob:http://localhost/abc')).toBe(false);
		expect(isPersistableImageUrl('')).toBe(false);
		expect(isBlobImageUrl('blob:http://localhost/abc')).toBe(true);
	});

	it('blocks save while generation is pending', () => {
		expect(canSavePinDraft({
			imageUrl: '',
			imageGenerationStatus: 'processing',
		})).toBe(false);
		expect(canSaveAllPinDrafts([
			{ imageUrl: 'https://cdn.example/a.png', imageGenerationStatus: 'completed' },
			{ imageUrl: '', imageGenerationStatus: 'queued' },
		])).toBe(false);
	});

	it('allows save when image is hosted or local blob (upload happens on save)', () => {
		expect(canSavePinDraft({
			imageUrl: 'https://cdn.example/a.png',
			imageGenerationStatus: 'completed',
		})).toBe(true);
		expect(canSavePinDraft({
			imageUrl: 'blob:http://localhost/preview',
			imageGenerationStatus: 'completed',
		})).toBe(true);
	});

	it('AI generation path: hosted job URL is ready for save', async () => {
		const pin = {
			tempId: 't1',
			title: 'AI Pin',
			articleId: 'art1',
			websiteId: 'ws1',
			imageUrl: 'https://cdn.example/ai-job.png',
			imageSource: 'ai_generated',
			imageGenerationStatus: 'completed',
		};
		const ready = await ensureHostedImageForPin(pin);
		expect(ready.imageUrl).toBe('https://cdn.example/ai-job.png');
		expect(apiServerClient.fetch).not.toHaveBeenCalled();
	});

	it('Featured compose path: uploads blob before save', async () => {
		const blobUrl = 'blob:http://localhost/featured-preview';
		global.fetch.mockResolvedValue({
			ok: true,
			blob: async () => new Blob(['png-bytes'], { type: 'image/png' }),
		});
		mockUploadOk('https://cdn.example/featured-hosted.png');

		const hosted = await uploadBlobImageUrl(blobUrl, {
			articleId: 'art1',
			title: 'Featured',
			tempId: 't2',
		});
		expect(hosted).toBe('https://cdn.example/featured-hosted.png');
		expect(apiServerClient.fetch).toHaveBeenCalledWith(
			'/ai-pin-images/composed',
			expect.objectContaining({ method: 'POST' }),
		);
	});

	it('blocks Save Draft when upload fails', async () => {
		global.fetch.mockResolvedValue({
			ok: true,
			blob: async () => new Blob(['png'], { type: 'image/png' }),
		});
		apiServerClient.fetch.mockResolvedValue(mockJsonResponse({
			ok: false,
			status: 500,
			body: { message: 'storage unavailable' },
		}));

		await expect(ensurePinsReadyForSave([{
			tempId: 't3',
			title: 'Broken upload',
			articleId: 'art1',
			websiteId: 'ws1',
			imageUrl: 'blob:http://localhost/x',
			imageGenerationStatus: 'completed',
		}])).rejects.toThrow(/storage unavailable|upload|hosted/i);
	});

	it('surfaces clear error on HTTP 413 Payload Too Large', async () => {
		global.fetch.mockResolvedValue({
			ok: true,
			blob: async () => new Blob(['png'], { type: 'image/png' }),
		});
		apiServerClient.fetch.mockResolvedValue(mockJsonResponse({
			ok: false,
			status: 413,
			body: {},
		}));

		await expect(ensurePinsReadyForSave([{
			tempId: 't413',
			title: 'Huge pin',
			articleId: 'art1',
			websiteId: 'ws1',
			imageUrl: 'blob:http://localhost/huge',
			imageGenerationStatus: 'completed',
		}])).rejects.toThrow(/413|Payload Too Large|upload limit/i);
	});

	it('Save Draft refuses empty image_url and writes hosted URL only', async () => {
		await expect(saveDrafts({
			previewPins: [{
				tempId: 't4',
				title: 'No image',
				articleId: 'art1',
				websiteId: 'ws1',
				imageUrl: '',
				imageGenerationStatus: 'failed',
			}],
			panel: {},
		})).rejects.toThrow(/no image|blocked|failed/i);
		expect(apiServerClient.fetch).not.toHaveBeenCalled();
	});

	it('Save Draft → API create uses image_url, reload maps imageUrl', async () => {
		apiServerClient.fetch.mockResolvedValue(mockJsonResponse({
			ok: true,
			status: 201,
			body: {
				items: [{
					id: 'pin_1',
					articleId: 'art1',
					websiteId: 'ws1',
					title: 'Saved Pin',
					description: 'desc',
					image_url: 'https://cdn.example/saved.png',
					image_source: 'ai_generated',
					image_generation_status: 'completed',
					source_url: 'https://blog.example/saved-pin',
					status: 'draft',
					suggested_keywords: [],
					suggested_hashtags: [],
				}],
			},
		}));

		const created = await saveDrafts({
			previewPins: [{
				tempId: 't5',
				title: 'Saved Pin',
				articleId: 'art1',
				websiteId: 'ws1',
				imageUrl: 'https://cdn.example/saved.png',
				imageSource: 'ai_generated',
				imageGenerationStatus: 'completed',
				sourceUrl: 'https://blog.example/saved-pin',
				articleUrl: 'https://blog.example/saved-pin',
			}],
			panel: { targetAudience: '', toneOfVoice: '', language: 'English' },
		});

		expect(apiServerClient.fetch).toHaveBeenCalledWith(
			'/ai-pins/drafts',
			expect.objectContaining({ method: 'POST' }),
		);
		const payload = JSON.parse(apiServerClient.fetch.mock.calls[0][1].body).items[0];
		expect(payload.image_url).toBe('https://cdn.example/saved.png');
		expect(payload.image_url).not.toMatch(/^blob:/);

		const reloaded = mapSavedPin({
			id: 'pin_1',
			articleId: 'art1',
			websiteId: 'ws1',
			title: 'Saved Pin',
			description: 'desc',
			image_url: 'https://cdn.example/saved.png',
			status: 'draft',
			suggested_keywords: [],
			suggested_hashtags: [],
		});
		expect(reloaded.imageUrl).toBe('https://cdn.example/saved.png');
		expect(created[0].imageUrl).toBe(reloaded.imageUrl);
	});

	it('Publish readiness uses the same persisted imageUrl field', () => {
		const libraryPin = mapSavedPin({
			id: 'pin_2',
			title: 'Publish me',
			image_url: 'https://cdn.example/publish.png',
			status: 'draft',
			suggested_keywords: [],
			suggested_hashtags: [],
		});
		expect(isPersistableImageUrl(libraryPin.imageUrl)).toBe(true);
		const missing = mapSavedPin({
			id: 'pin_3',
			title: 'No image',
			image_url: '',
			status: 'draft',
			suggested_keywords: [],
			suggested_hashtags: [],
		});
		expect(isPersistableImageUrl(missing.imageUrl)).toBe(false);
		// Studio and Library share imageUrl — never a second persisted field.
		expect(missing.imageUrl).toBe('');
		expect(Object.prototype.hasOwnProperty.call(missing, 'featuredImage')).toBe(false);
	});
});
