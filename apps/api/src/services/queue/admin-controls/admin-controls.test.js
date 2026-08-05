/**
 * Phase 9d-3 — Admin Queue channel control flag, resolver, and routing tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isAdminQueueChannelControlsEnabled,
	getAdminQueueChannelControlsStatus,
} from './flag.js';
import {
	classifyControlTarget,
	resolveControlCoordinates,
	CONTROL_ROUTE,
	CONTROL_TARGET_KIND,
} from './resolve-target.js';

const ORIGINAL = process.env.ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED;

function restoreEnv() {
	if (ORIGINAL === undefined) {
		delete process.env.ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED;
	} else {
		process.env.ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED = ORIGINAL;
	}
}

test('ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED flag parsing', () => {
	try {
		delete process.env.ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED;
		assert.equal(isAdminQueueChannelControlsEnabled(), false);

		process.env.ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED = 'false';
		assert.equal(isAdminQueueChannelControlsEnabled(), false);
		process.env.ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED = '0';
		assert.equal(isAdminQueueChannelControlsEnabled(), false);

		process.env.ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED = 'true';
		assert.equal(isAdminQueueChannelControlsEnabled(), true);
		process.env.ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED = '1';
		assert.equal(isAdminQueueChannelControlsEnabled(), true);

		process.env.ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED = 'maybe';
		assert.equal(isAdminQueueChannelControlsEnabled(), false);

		process.env.ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED = 'true';
		const status = getAdminQueueChannelControlsStatus();
		assert.equal(status.enabled, true);
		assert.equal(status.disabledByEnv, false);
	} finally {
		restoreEnv();
	}
});

test('resolveControlCoordinates handles synthetic and native ids', () => {
	const synthetic = resolveControlCoordinates('pinterest_publish_jobs:ppj_1');
	assert.equal(synthetic.isSynthetic, true);
	assert.equal(synthetic.sourceCollection, 'pinterest_publish_jobs');
	assert.equal(synthetic.sourceId, 'ppj_1');

	const native = resolveControlCoordinates('queue_native_1');
	assert.equal(native.isSynthetic, false);
	assert.equal(native.requestedId, 'queue_native_1');
});

test('classifyControlTarget native job', () => {
	const target = classifyControlTarget({
		requestedId: 'native_1',
		queueJob: {
			id: 'native_1',
			source_collection: '',
			type: 'webhook_delivery',
		},
	});
	assert.equal(target.kind, CONTROL_TARGET_KIND.NATIVE);
	assert.equal(target.route, CONTROL_ROUTE.NATIVE);
	assert.equal(target.queueJobId, 'native_1');
});

test('classifyControlTarget mirrored channel job', () => {
	const target = classifyControlTarget({
		requestedId: 'publish_jobs:wp_1',
		sourceCollection: 'publish_jobs',
		sourceId: 'wp_1',
		queueJob: { id: 'mirror_1', source_collection: 'publish_jobs', source_id: 'wp_1' },
		channelJob: { id: 'wp_1', status: 'failed', owner: 'user_1' },
	});
	assert.equal(target.kind, CONTROL_TARGET_KIND.MIRRORED);
	assert.equal(target.route, CONTROL_ROUTE.CHANNEL);
	assert.equal(target.queueJobId, 'mirror_1');
	assert.equal(target.syntheticId, 'publish_jobs:wp_1');
});

test('classifyControlTarget channel-only job', () => {
	const target = classifyControlTarget({
		requestedId: 'pinterest_publish_jobs:ppj_9',
		sourceCollection: 'pinterest_publish_jobs',
		sourceId: 'ppj_9',
		channelJob: { id: 'ppj_9', status: 'scheduled', owner: 'user_1' },
	});
	assert.equal(target.kind, CONTROL_TARGET_KIND.CHANNEL_ONLY);
	assert.equal(target.route, CONTROL_ROUTE.CHANNEL);
	assert.equal(target.queueJobId, null);
});

test('classifyControlTarget orphan mirror without channel returns null', () => {
	const target = classifyControlTarget({
		requestedId: 'mirror_orphan',
		queueJob: {
			id: 'mirror_orphan',
			source_collection: 'publish_jobs',
			source_id: 'missing',
		},
		channelJob: null,
		sourceCollection: 'publish_jobs',
		sourceId: 'missing',
	});
	assert.equal(target, null);
});
