import { describe, it, expect, vi, beforeEach } from 'vitest';

const { renderFeaturedPinToBlob } = vi.hoisted(() => ({
	renderFeaturedPinToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}));

vi.mock('@/lib/pinCanvasRenderer', () => ({
	renderFeaturedPinToBlob,
}));

vi.mock('@/lib/imageSourceStrategy', () => ({
	listArticleImageCandidates: vi.fn(() => ['https://example.com/image.jpg']),
}));

vi.mock('@/services/ai-pins/imageLifecycle.js', () => ({
	uploadImageBlob: vi.fn(async () => ({ imageUrl: 'https://cdn.example.com/pin.png' })),
}));

vi.mock('@/services/ai-pins/imageLifecycleTrace.js', () => ({
	traceImageLifecycle: vi.fn(async () => {}),
}));

import { composeAndUploadFeaturedPins } from '@/services/ai-pins/featuredComposeService';

describe('composeAndUploadFeaturedPins export profiles', () => {
	beforeEach(() => {
		renderFeaturedPinToBlob.mockClear();
	});

	it('defaults to pinterest_standard when exportProfileId omitted', async () => {
		await composeAndUploadFeaturedPins([{
			tempId: 'temp-1',
			templateConfig: {},
			title: 'Test',
		}], {});

		expect(renderFeaturedPinToBlob).toHaveBeenCalledTimes(1);
		expect(renderFeaturedPinToBlob.mock.calls[0][0].exportProfileId).toBe('pinterest_standard');
	});

	it('passes facebook_post export profile to renderer', async () => {
		await composeAndUploadFeaturedPins([{
			tempId: 'temp-2',
			templateConfig: {},
			title: 'Facebook',
		}], { exportProfileId: 'facebook_post' });

		expect(renderFeaturedPinToBlob.mock.calls[0][0].exportProfileId).toBe('facebook_post');
	});
});
