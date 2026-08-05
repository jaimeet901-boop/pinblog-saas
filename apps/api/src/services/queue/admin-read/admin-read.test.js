/**
 * Phase 9d-2 — Admin Queue dual-read merge and flag tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isAdminQueueDualReadEnabled,
	getAdminQueueDualReadStatus,
} from './flag.js';
import {
	makeSyntheticId,
	parseSyntheticId,
	normalizeChannelJob,
} from './normalize.js';
import {
	mergeAdminQueueRecords,
	paginateItems,
	filterJobsBySearch,
} from './merge.js';

const ORIGINAL = process.env.ADMIN_QUEUE_DUAL_READ_ENABLED;

function restoreEnv() {
	if (ORIGINAL === undefined) {
		delete process.env.ADMIN_QUEUE_DUAL_READ_ENABLED;
	} else {
		process.env.ADMIN_QUEUE_DUAL_READ_ENABLED = ORIGINAL;
	}
}

function setFlag(value) {
	if (value === undefined) {
		delete process.env.ADMIN_QUEUE_DUAL_READ_ENABLED;
	} else {
		process.env.ADMIN_QUEUE_DUAL_READ_ENABLED = value;
	}
}

test('ADMIN_QUEUE_DUAL_READ_ENABLED flag parsing', () => {
	try {
		delete process.env.ADMIN_QUEUE_DUAL_READ_ENABLED;
		assert.equal(isAdminQueueDualReadEnabled(), false);

		setFlag('false');
		assert.equal(isAdminQueueDualReadEnabled(), false);
		setFlag('0');
		assert.equal(isAdminQueueDualReadEnabled(), false);

		setFlag('true');
		assert.equal(isAdminQueueDualReadEnabled(), true);
		setFlag('1');
		assert.equal(isAdminQueueDualReadEnabled(), true);

		setFlag('maybe');
		assert.equal(isAdminQueueDualReadEnabled(), false);

		setFlag('true');
		const status = getAdminQueueDualReadStatus();
		assert.equal(status.enabled, true);
		assert.equal(status.disabledByEnv, false);
	} finally {
		restoreEnv();
	}
});

test('synthetic id helpers', () => {
	const synthetic = makeSyntheticId('pinterest_publish_jobs', 'job_abc');
	assert.equal(synthetic, 'pinterest_publish_jobs:job_abc');
	assert.deepEqual(parseSyntheticId(synthetic), {
		sourceCollection: 'pinterest_publish_jobs',
		sourceId: 'job_abc',
	});
	assert.equal(parseSyntheticId('not-a-synthetic-id'), null);
	assert.equal(parseSyntheticId('queue_jobs:abc'), null);
});

test('normalizeChannelJob maps pinterest row to queue shape', () => {
	const channelRow = {
		id: 'ppj_1',
		owner: 'user_1',
		workspace_key: 'ws_a',
		status: 'publishing',
		board_name: 'Recipes',
		attempt_count: 0,
		max_attempts: 3,
		created: '2026-08-01T10:00:00.000Z',
		updated: '2026-08-01T10:05:00.000Z',
	};
	const normalized = normalizeChannelJob('pinterest_publish_jobs', channelRow, {
		queueJobId: 'mirror_99',
	});
	assert.equal(normalized.id, 'pinterest_publish_jobs:ppj_1');
	assert.equal(normalized.type, 'pinterest_publishing');
	assert.equal(normalized.status, 'running');
	assert.equal(normalized._queueJobId, 'mirror_99');
	assert.equal(normalized._readSource, 'channel');
});

test('mergeAdminQueueRecords dedupes channel over mirror and omits orphan mirrors', () => {
	const channelRow = {
		id: 'ppj_1',
		owner: 'user_1',
		workspace_key: 'ws_a',
		status: 'publishing',
		board_name: 'Recipes',
		attempt_count: 0,
		max_attempts: 3,
		created: '2026-08-01T10:00:00.000Z',
		updated: '2026-08-01T10:05:00.000Z',
	};
	const nativeOnly = {
		id: 'native_1',
		type: 'webhook_delivery',
		status: 'queued',
		source_collection: '',
		source_id: '',
		created: '2026-08-02T10:00:00.000Z',
		updated: '2026-08-02T10:00:00.000Z',
	};
	const mirrorRow = {
		id: 'mirror_99',
		type: 'pinterest_publishing',
		status: 'running',
		source_collection: 'pinterest_publish_jobs',
		source_id: 'ppj_1',
		created: '2026-08-01T09:00:00.000Z',
		updated: '2026-08-01T09:00:00.000Z',
	};
	const orphanMirror = {
		id: 'mirror_orphan',
		type: 'wordpress_publishing',
		status: 'failed',
		source_collection: 'publish_jobs',
		source_id: 'missing',
		created: '2026-07-01T09:00:00.000Z',
		updated: '2026-07-01T09:00:00.000Z',
	};

	const merged = mergeAdminQueueRecords({
		nativeItems: [nativeOnly, mirrorRow, orphanMirror],
		channelItems: [{ ...channelRow, _sourceCollection: 'pinterest_publish_jobs' }],
	});
	assert.equal(merged.length, 2);
	assert.equal(merged[0].id, 'native_1');
	assert.equal(merged[1].id, 'pinterest_publish_jobs:ppj_1');

	const deduped = mergeAdminQueueRecords({
		nativeItems: [mirrorRow],
		channelItems: [{ ...channelRow, _sourceCollection: 'pinterest_publish_jobs' }],
	});
	assert.equal(deduped.length, 1);
	assert.equal(deduped[0]._readSource, 'channel');
	assert.equal(deduped[0]._queueJobId, 'mirror_99');
});

test('merge post-filters and pagination helpers', () => {
	const channelRow = {
		id: 'ppj_1',
		status: 'publishing',
		board_name: 'Recipes',
		attempt_count: 0,
		max_attempts: 3,
		created: '2026-08-01T10:00:00.000Z',
		updated: '2026-08-01T10:05:00.000Z',
	};
	const nativeOnly = {
		id: 'native_1',
		type: 'webhook_delivery',
		status: 'queued',
		source_collection: '',
		source_id: '',
		created: '2026-08-02T10:00:00.000Z',
		updated: '2026-08-02T10:00:00.000Z',
	};

	const filtered = mergeAdminQueueRecords({
		nativeItems: [nativeOnly],
		channelItems: [{ ...channelRow, _sourceCollection: 'pinterest_publish_jobs' }],
		filters: { status: 'running' },
	});
	assert.equal(filtered.length, 1);
	assert.equal(filtered[0].id, 'pinterest_publish_jobs:ppj_1');

	const searched = filterJobsBySearch([
		{ id: 'native_1', type: 'webhook_delivery', workspace_key: 'alpha' },
		{ id: 'pinterest_publish_jobs:ppj_1', type: 'pinterest_publishing', workspace_key: 'beta' },
	], 'pinterest');
	assert.equal(searched.length, 1);

	const paged = paginateItems([
		{ id: 'a', created: '2026-08-03T00:00:00.000Z' },
		{ id: 'b', created: '2026-08-02T00:00:00.000Z' },
		{ id: 'c', created: '2026-08-01T00:00:00.000Z' },
	], { page: 2, perPage: 1 });
	assert.equal(paged.items.length, 1);
	assert.equal(paged.page, 2);
	assert.equal(paged.totalItems, 3);
});
