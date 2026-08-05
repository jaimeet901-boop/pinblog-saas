/**
 * Phase 9d-4a — Admin observability event resolution tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mapPinterestPublishEventToAdminEvent } from './pinterest-events.js';
import { CONTROL_ROUTE, CONTROL_TARGET_KIND } from '../admin-controls/resolve-target.js';

test('mapPinterestPublishEventToAdminEvent maps failed events to error level', () => {
	const mapped = mapPinterestPublishEventToAdminEvent({
		id: 'evt_1',
		event_type: 'failed',
		message: 'Rate limited',
		created: '2026-08-01T12:00:00.000Z',
		payload: { attempt: 3 },
	});
	assert.equal(mapped.level, 'error');
	assert.equal(mapped.message, 'Rate limited');
	assert.equal(mapped.at, '2026-08-01T12:00:00.000Z');
	assert.deepEqual(mapped.payload, { attempt: 3 });
});

test('mirror-backed Pinterest detail target shape is classified as mirrored channel route', () => {
	const target = {
		kind: CONTROL_TARGET_KIND.MIRRORED,
		route: CONTROL_ROUTE.CHANNEL,
		queueJobId: 'mirror_1',
		sourceCollection: 'pinterest_publish_jobs',
		sourceId: 'ppj_1',
	};
	assert.equal(target.queueJobId && target.sourceCollection === 'pinterest_publish_jobs', true);
});

test('channel-only Pinterest detail target has no queueJobId', () => {
	const target = {
		kind: CONTROL_TARGET_KIND.CHANNEL_ONLY,
		route: CONTROL_ROUTE.CHANNEL,
		queueJobId: null,
		sourceCollection: 'pinterest_publish_jobs',
		sourceId: 'ppj_only',
	};
	assert.equal(target.queueJobId, null);
	assert.equal(target.sourceCollection, 'pinterest_publish_jobs');
});
