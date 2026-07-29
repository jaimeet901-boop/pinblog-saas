/**
 * Phase 2 unit tests — Publishing History list aggregation helpers.
 * Run: node --test src/services/publishing-history/list.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	PUBLISHING_HISTORY_API_VERSION,
	MAX_SOURCE_FETCH_CAP,
	MIN_SOURCE_FETCH_CAP,
	assemblePublishingHistoryResponse,
	buildPublishingHistoryCounts,
	computeSourceFetchCap,
	matchesPublishingHistoryFilters,
	nativeStatusExtraFilter,
	paginatePublishingHistoryItems,
	parsePublishingHistoryQuery,
	sortPublishingHistoryItems,
} from './list.js';
import { normalizePinterestPublishJob, normalizeWordpressPublishJob } from './index.js';

function sampleItems() {
	const pin = normalizePinterestPublishJob({
		id: 'p1',
		status: 'published',
		board_name: 'Food',
		pinterest_pin_url: 'https://pin.example/1',
		published_at: '2026-07-10T12:00:00.000Z',
		updated: '2026-07-10T12:00:00.000Z',
		created: '2026-07-09T12:00:00.000Z',
		websiteId: 'web1',
	}, { pin: { title: 'Pin A', image_url: 'https://cdn/a.png' }, sourceModule: 'ai_pins' });

	const wp = normalizeWordpressPublishJob({
		id: 'w1',
		site: 'site1',
		title: 'WP Post',
		status: 'failed',
		last_error: 'timeout',
		updated: '2026-07-11T12:00:00.000Z',
		created: '2026-07-11T11:00:00.000Z',
	}, { sourceModule: 'writer' });

	const scheduled = normalizePinterestPublishJob({
		id: 'p2',
		status: 'scheduled',
		scheduled_at: '2026-08-01T00:00:00.000Z',
		updated: '2026-07-08T12:00:00.000Z',
		created: '2026-07-08T12:00:00.000Z',
	}, { pin: { title: 'Later Pin' } });

	return [pin, wp, scheduled];
}

describe('computeSourceFetchCap', () => {
	it('uses max(300, page * perPage * 3) with upper bound 1000', () => {
		assert.equal(computeSourceFetchCap(1, 50), MIN_SOURCE_FETCH_CAP);
		assert.equal(computeSourceFetchCap(3, 50), 450);
		assert.equal(computeSourceFetchCap(20, 100), MAX_SOURCE_FETCH_CAP);
		assert.ok(MIN_SOURCE_FETCH_CAP === 300);
		assert.ok(MAX_SOURCE_FETCH_CAP === 1000);
	});
});

describe('parsePublishingHistoryQuery', () => {
	it('applies defaults and accepts enums', () => {
		const parsed = parsePublishingHistoryQuery({});
		assert.equal(parsed.page, 1);
		assert.equal(parsed.perPage, 50);
		assert.deepEqual(parsed.channels, ['pinterest', 'wordpress']);
		assert.equal(parsed.sort, '-updatedAt');
	});

	it('rejects invalid channel', () => {
		assert.throws(
			() => parsePublishingHistoryQuery({ channel: 'myspace' }),
			(err) => err.status === 400,
		);
	});

	it('soft-falls invalid sort to -updatedAt', () => {
		const parsed = parsePublishingHistoryQuery({ sort: 'nope' });
		assert.equal(parsed.sort, '-updatedAt');
	});
});

describe('filter / sort / paginate / assemble', () => {
	it('filters by channel, status, and search', () => {
		const items = sampleItems();
		assert.equal(items.filter((i) => matchesPublishingHistoryFilters(i, { channel: 'wordpress' })).length, 1);
		assert.equal(items.filter((i) => matchesPublishingHistoryFilters(i, { status: 'failed' })).length, 1);
		assert.equal(items.filter((i) => matchesPublishingHistoryFilters(i, { search: 'timeout' })).length, 1);
		assert.equal(items.filter((i) => matchesPublishingHistoryFilters(i, { search: 'Pin A' })).length, 1);
	});

	it('sorts by -updatedAt with stable id tie-break', () => {
		const sorted = sortPublishingHistoryItems(sampleItems(), '-updatedAt');
		assert.equal(sorted[0].jobId, 'w1');
		assert.equal(sorted[1].jobId, 'p1');
		assert.equal(sorted[2].jobId, 'p2');
	});

	it('paginates and builds versioned response with meta + warnings', () => {
		const sorted = sortPublishingHistoryItems(sampleItems(), '-updatedAt');
		const response = assemblePublishingHistoryResponse({
			items: sorted,
			page: 1,
			perPage: 2,
			sort: '-updatedAt',
			filters: { channel: null, status: null, search: null },
			warnings: [{ channel: 'wordpress', message: 'Source unavailable' }],
			truncated: true,
		});

		assert.equal(response.version, PUBLISHING_HISTORY_API_VERSION);
		assert.equal(response.items.length, 2);
		assert.equal(response.meta.totalItems, 3);
		assert.equal(response.meta.totalPages, 2);
		assert.equal(response.meta.truncated, true);
		assert.equal(response.meta.counts.byChannel.pinterest, 2);
		assert.equal(response.meta.counts.byStatus.failed, 1);
		assert.deepEqual(response.warnings, [{ channel: 'wordpress', message: 'Source unavailable' }]);
		assert.ok(!('page' in response) || response.page === undefined);
	});

	it('paginatePublishingHistoryItems returns empty-safe totals', () => {
		const empty = paginatePublishingHistoryItems([], 1, 50);
		assert.equal(empty.totalItems, 0);
		assert.equal(empty.totalPages, 0);
		assert.equal(empty.items.length, 0);
	});
});

describe('nativeStatusExtraFilter', () => {
	it('maps publishing to waiting_provider OR for Pinterest', () => {
		assert.match(nativeStatusExtraFilter('pinterest', 'publishing'), /waiting_provider/);
	});

	it('skips Pinterest for queued and WordPress for retrying', () => {
		assert.equal(nativeStatusExtraFilter('pinterest', 'queued'), null);
		assert.equal(nativeStatusExtraFilter('wordpress', 'retrying'), null);
	});
});

describe('buildPublishingHistoryCounts', () => {
	it('initializes all status keys', () => {
		const counts = buildPublishingHistoryCounts([]);
		assert.equal(counts.byStatus.published, 0);
		assert.equal(counts.byStatus.failed, 0);
	});
});
