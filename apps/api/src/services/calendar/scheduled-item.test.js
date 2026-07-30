import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	assertScheduledItemContract,
	defaultActionsForStatus,
	normalizeScheduledItem,
	normalizeScheduledItemStatus,
	normalizeWebsiteContext,
	PRODUCT_CALENDAR_STATUSES,
	SCHEDULED_ITEM_STATUSES,
} from './scheduled-item.js';

describe('scheduled-item normalization (C4)', () => {
	it('maps cross-channel status aliases to canonical statuses', () => {
		assert.equal(normalizeScheduledItemStatus('waiting_provider'), 'publishing');
		assert.equal(normalizeScheduledItemStatus('queued'), 'publishing');
		assert.equal(normalizeScheduledItemStatus('canceled'), 'cancelled');
		assert.equal(normalizeScheduledItemStatus('error'), 'failed');
		assert.equal(normalizeScheduledItemStatus('completed'), 'published');
		assert.equal(normalizeScheduledItemStatus('draft'), 'draft');
		assert.equal(normalizeScheduledItemStatus('SCHEDULED'), 'scheduled');
		assert.ok(SCHEDULED_ITEM_STATUSES.includes('draft'));
		assert.ok(!PRODUCT_CALENDAR_STATUSES.includes('draft'));
		assert.deepEqual(defaultActionsForStatus('draft'), []);
	});

	it('normalizes website context with backward-compatible websiteId', () => {
		assert.deepEqual(normalizeWebsiteContext({}), { websiteId: '', website: null });
		assert.deepEqual(normalizeWebsiteContext({ websiteId: 'w1', websiteName: 'Blog', websiteDomain: 'blog.test' }), {
			websiteId: 'w1',
			website: { id: 'w1', name: 'Blog', domain: 'blog.test' },
		});
		assert.deepEqual(normalizeWebsiteContext({ website: { id: 'w2', name: 'Site', domain: 'site.test' } }), {
			websiteId: 'w2',
			website: { id: 'w2', name: 'Site', domain: 'site.test' },
		});
	});

	it('embeds canonical status + website on Scheduled Items', () => {
		const item = normalizeScheduledItem({
			channel: 'pinterest',
			refId: 'job1',
			status: 'waiting_provider',
			scheduledAt: '2026-07-15T12:00:00.000Z',
			websiteId: 'wsite1',
			websiteName: 'Main',
			title: 'Pin A',
		});
		assert.equal(item.status, 'publishing');
		assert.equal(item.websiteId, 'wsite1');
		assert.deepEqual(item.website, { id: 'wsite1', name: 'Main', domain: null });
		assert.deepEqual(defaultActionsForStatus('waiting_provider'), []);
		assertScheduledItemContract(item);
	});
});
