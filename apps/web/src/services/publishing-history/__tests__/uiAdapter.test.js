import { describe, expect, it } from 'vitest';
import {
	PINTEREST_HISTORY_DEFAULT_STATUSES,
	adaptPublishingHistoryResponse,
	buildPublishingHistoryFetchQuery,
	toPublishingHistoryUiRow,
} from '../uiAdapter.js';

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
