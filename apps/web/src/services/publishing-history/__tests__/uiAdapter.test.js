import { describe, expect, it } from 'vitest';
import {
	PINTEREST_HISTORY_DEFAULT_STATUSES,
	PUBLISHING_HISTORY_DEFAULT_STATUSES,
	adaptPublishingHistoryResponse,
	buildPublishingHistoryFetchQuery,
	toFacebookPublishingHistoryUiRow,
	toPublishingHistoryUiRow,
} from '../uiAdapter.js';
import {
	externalPostUrl,
	getPublishingHistoryViewConfig,
} from '../viewConfig.js';
import { AI_FACEBOOK_PAGES_PRODUCT, AI_PINS_PRODUCT } from '@/lib/studio/products';

function sampleNormalizedItem(overrides = {}) {
	return {
		id: 'pinterest:job_abc',
		channel: 'pinterest',
		jobId: 'job_abc',
		status: 'published',
		nativeStatus: 'published',
		title: 'Summer salad',
		description: 'Fresh greens',
		imageUrl: 'https://cdn.example/pin.jpg',
		contentId: 'pin_1',
		websiteId: 'ws_1',
		destinationUrl: 'https://blog.example/salad',
		destination: {
			kind: 'board',
			accountId: 'acct_1',
			accountLabel: 'Chef Kitchen',
			targetId: 'board_9',
			targetLabel: 'Recipes',
			externalId: 'pin_ext_1',
			externalUrl: 'https://pinterest.com/pin/1',
		},
		scheduledAt: null,
		timezone: 'UTC',
		publishedAt: '2026-07-01T12:00:00.000Z',
		createdAt: '2026-06-30T10:00:00.000Z',
		updatedAt: '2026-07-01T12:05:00.000Z',
		attemptCount: 1,
		maxAttempts: 3,
		nextRetryAt: null,
		lastError: '',
		channelPayload: {
			boardId: 'board_9',
			boardName: 'Recipes',
			accountUsername: 'chefkitchen',
			pinterestPinId: 'pin_ext_1',
			pinterestPinUrl: 'https://pinterest.com/pin/1',
			articleId: 'art_1',
			performance: {
				impressions: 10,
				saves: 2,
				outboundClicks: 1,
				closeups: 3,
				readyForAnalyticsSync: false,
			},
			pin: {
				id: 'pin_1',
				title: 'Summer salad',
				description: 'Fresh greens',
				overlayText: 'Eat well',
				imageUrl: 'https://cdn.example/pin.jpg',
				status: 'ready',
			},
		},
		...overrides,
	};
}

describe('toPublishingHistoryUiRow', () => {
	it('maps normalized item into legacy mapJob-compatible row', () => {
		const row = toPublishingHistoryUiRow(sampleNormalizedItem());
		expect(row.id).toBe('job_abc');
		expect(row.aiPinId).toBe('pin_1');
		expect(row.accountId).toBe('acct_1');
		expect(row.accountLabel).toBe('Chef Kitchen');
		expect(row.accountUsername).toBe('chefkitchen');
		expect(row.websiteId).toBe('ws_1');
		expect(row.articleId).toBe('art_1');
		expect(row.boardId).toBe('board_9');
		expect(row.boardName).toBe('Recipes');
		expect(row.status).toBe('published');
		expect(row.pinterestPinId).toBe('pin_ext_1');
		expect(row.pinterestPinUrl).toBe('https://pinterest.com/pin/1');
		expect(row.pin).toEqual({
			id: 'pin_1',
			title: 'Summer salad',
			description: 'Fresh greens',
			overlayText: 'Eat well',
			imageUrl: 'https://cdn.example/pin.jpg',
			status: 'ready',
		});
		expect(row.destinationUrl).toBeUndefined();
		expect(row.performance.impressions).toBe(10);
	});

	it('never exposes destination/channelPayload on the UI row', () => {
		const row = toPublishingHistoryUiRow(sampleNormalizedItem());
		expect(row.destination).toBeUndefined();
		expect(row.channelPayload).toBeUndefined();
		expect(row.actions).toBeUndefined();
		expect(row.meta).toBeUndefined();
	});

	it('uses jobId for actions even when composite id is present', () => {
		const row = toPublishingHistoryUiRow(sampleNormalizedItem({
			id: 'pinterest:raw_job_99',
			jobId: 'raw_job_99',
		}));
		expect(row.id).toBe('raw_job_99');
	});

	it('returns null for empty input', () => {
		expect(toPublishingHistoryUiRow(null)).toBeNull();
		expect(toPublishingHistoryUiRow({})).toBeNull();
	});
});

describe('adaptPublishingHistoryResponse', () => {
	it('unwraps meta envelope and applies default status parity filter', () => {
		const adapted = adaptPublishingHistoryResponse({
			version: 1,
			items: [
				sampleNormalizedItem({ jobId: 'a', id: 'pinterest:a', status: 'published' }),
				sampleNormalizedItem({ jobId: 'b', id: 'pinterest:b', status: 'retrying' }),
				sampleNormalizedItem({ jobId: 'c', id: 'pinterest:c', status: 'failed' }),
				sampleNormalizedItem({
					jobId: 'w',
					id: 'pinterest:w',
					status: 'publishing',
					nativeStatus: 'waiting_provider',
				}),
			],
			meta: { page: 1, perPage: 100, totalItems: 4, totalPages: 1 },
			warnings: [],
		}, { applyDefaultStatusFilter: true });

		expect(adapted.items.map((i) => i.id)).toEqual(['a', 'c']);
		expect(adapted.items.every((i) => PINTEREST_HISTORY_DEFAULT_STATUSES.includes(i.status))).toBe(true);
		expect(adapted.page).toBe(1);
		expect(adapted.meta).toBeUndefined();
	});

	it('skips default filter when a status chip is active', () => {
		const adapted = adaptPublishingHistoryResponse({
			items: [
				sampleNormalizedItem({ jobId: 'r1', id: 'pinterest:r1', status: 'retrying' }),
			],
			meta: { page: 1, perPage: 50, totalItems: 1, totalPages: 1 },
		}, { applyDefaultStatusFilter: false });

		expect(adapted.items).toHaveLength(1);
		expect(adapted.items[0].status).toBe('retrying');
	});
});

describe('buildPublishingHistoryFetchQuery', () => {
	it('targets unified history with pinterest channel', () => {
		const q = buildPublishingHistoryFetchQuery({ statusFilter: 'failed' });
		expect(q.get('channel')).toBe('pinterest');
		expect(q.get('status')).toBe('failed');
		expect(q.get('perPage')).toBe('100');
		expect(q.get('sort')).toBe('-updatedAt');
	});

	it('omits status when filter is empty (client applies default set)', () => {
		const q = buildPublishingHistoryFetchQuery({ statusFilter: '' });
		expect(q.get('status')).toBeNull();
		expect(q.get('channel')).toBe('pinterest');
	});
});

function sampleFacebookNormalizedItem(overrides = {}) {
	return {
		id: 'facebook:job_fb_1',
		channel: 'facebook',
		jobId: 'job_fb_1',
		status: 'published',
		nativeStatus: 'published',
		title: 'Summer promo',
		description: 'Check out our latest offer',
		imageUrl: 'https://cdn.example/post.jpg',
		contentId: 'pin_fb_1',
		websiteId: 'ws_1',
		destination: {
			kind: 'page',
			accountId: 'acct_fb_1',
			accountLabel: 'Chef Kitchen FB',
			targetId: 'page_123',
			targetLabel: 'Chef Kitchen Page',
			externalId: '123456789_987654321',
			externalUrl: 'https://facebook.com/123456789/posts/987654321',
		},
		publishedAt: '2026-07-01T12:00:00.000Z',
		createdAt: '2026-06-30T10:00:00.000Z',
		updatedAt: '2026-07-01T12:05:00.000Z',
		attemptCount: 1,
		maxAttempts: 3,
		channelPayload: {
			pageId: 'page_123',
			pageName: 'Chef Kitchen Page',
			facebookPostId: '123456789_987654321',
			facebookPostUrl: 'https://facebook.com/123456789/posts/987654321',
			message: 'Summer promo',
			performance: {
				impressions: 100,
				engagedUsers: 12,
				clicks: 3,
				reactions: 5,
			},
			post: {
				id: 'pin_fb_1',
				title: 'Summer promo',
				description: 'Check out our latest offer',
				imageUrl: 'https://cdn.example/post.jpg',
				status: 'ready',
			},
		},
		...overrides,
	};
}

describe('toFacebookPublishingHistoryUiRow', () => {
	it('maps normalized facebook item into shared UI row shape', () => {
		const row = toFacebookPublishingHistoryUiRow(sampleFacebookNormalizedItem());
		expect(row.id).toBe('job_fb_1');
		expect(row.pageId).toBe('page_123');
		expect(row.pageName).toBe('Chef Kitchen Page');
		expect(row.boardId).toBe('page_123');
		expect(row.boardName).toBe('Chef Kitchen Page');
		expect(row.facebookPostId).toBe('123456789_987654321');
		expect(row.facebookPostUrl).toBe('https://facebook.com/123456789/posts/987654321');
		expect(row.externalPostUrl).toBe('https://facebook.com/123456789/posts/987654321');
		expect(row.performance.impressions).toBe(100);
	});

	it('routes facebook channel through toPublishingHistoryUiRow', () => {
		const row = toPublishingHistoryUiRow(sampleFacebookNormalizedItem(), { channel: 'facebook' });
		expect(row.facebookPostUrl).toBe('https://facebook.com/123456789/posts/987654321');
	});
});

describe('adaptPublishingHistoryResponse facebook', () => {
	it('adapts facebook channel items with default status filter', () => {
		const adapted = adaptPublishingHistoryResponse({
			items: [
				sampleFacebookNormalizedItem(),
				sampleFacebookNormalizedItem({ jobId: 'job_retry', id: 'facebook:job_retry', status: 'retrying' }),
			],
			meta: { page: 1, perPage: 100, totalItems: 2, totalPages: 1 },
		}, { channel: 'facebook', applyDefaultStatusFilter: true });

		expect(adapted.items).toHaveLength(1);
		expect(adapted.items[0].id).toBe('job_fb_1');
	});
});

describe('buildPublishingHistoryFetchQuery facebook', () => {
	it('targets unified history with facebook channel', () => {
		const q = buildPublishingHistoryFetchQuery({ channel: 'facebook', statusFilter: 'failed' });
		expect(q.get('channel')).toBe('facebook');
		expect(q.get('status')).toBe('failed');
	});
});

describe('getPublishingHistoryViewConfig', () => {
	it('builds pinterest defaults from AI Pins product', () => {
		const view = getPublishingHistoryViewConfig(AI_PINS_PRODUCT);
		expect(view.channel).toBe('pinterest');
		expect(view.jobBase).toBe('/pinterest/jobs');
		expect(view.hubRoute).toBe('/app/pinterest');
	});

	it('builds facebook view config from AI Facebook Pages product', () => {
		const view = getPublishingHistoryViewConfig(AI_FACEBOOK_PAGES_PRODUCT);
		expect(view.channel).toBe('facebook');
		expect(view.jobBase).toBe('/facebook/jobs');
		expect(view.hubRoute).toBe('/app/facebook');
		expect(view.studioRoute).toBe('/app/ai-facebook-pages');
	});
});

describe('externalPostUrl', () => {
	it('prefers externalPostUrl then channel-specific fallbacks', () => {
		expect(externalPostUrl({ externalPostUrl: 'https://example.com/a' })).toBe('https://example.com/a');
		expect(externalPostUrl({ facebookPostUrl: 'https://facebook.com/post/1' })).toBe('https://facebook.com/post/1');
		expect(externalPostUrl({ pinterestPinUrl: 'https://pinterest.com/pin/1' })).toBe('https://pinterest.com/pin/1');
	});
});

describe('PUBLISHING_HISTORY_DEFAULT_STATUSES alias', () => {
	it('keeps pinterest alias aligned with shared default statuses', () => {
		expect(PINTEREST_HISTORY_DEFAULT_STATUSES).toEqual(PUBLISHING_HISTORY_DEFAULT_STATUSES);
	});
});
