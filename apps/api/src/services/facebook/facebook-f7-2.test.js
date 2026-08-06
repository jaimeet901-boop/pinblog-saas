import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FACEBOOK_CHANNEL_CAPABILITIES,
} from './channel-pack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('facebook F7-2 publishing history normalizer', () => {
	it('verifies channel capabilities alongside publishing history normalizer wiring', () => {
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishingHistory, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.insights, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.analytics, true);

		const caps = readFileSync(
			path.join(root, 'apps/web/src/lib/facebook/channelCapabilities.js'),
			'utf8',
		);
		assert.match(caps, /publishingHistory:\s*true/);
		assert.match(caps, /insights:\s*true/);
		assert.match(caps, /analytics:\s*true/);
	});

	it('wires facebook channel into unified publishing history list pipeline', () => {
		const list = readFileSync(
			path.join(root, 'apps/api/src/services/publishing-history/list.js'),
			'utf8',
		);
		const listPure = readFileSync(
			path.join(root, 'apps/api/src/services/publishing-history/list-pure.js'),
			'utf8',
		);
		const index = readFileSync(
			path.join(root, 'apps/api/src/services/publishing-history/index.js'),
			'utf8',
		);

		assert.match(list, /normalizeFacebookPublishJob/);
		assert.match(list, /channel === 'facebook'/);
		assert.match(list, /PUBLISHING_JOB_COLLECTIONS\.facebook/);
		assert.match(listPure, /channel === 'facebook'/);
		assert.match(index, /normalizeFacebookPublishJob/);
	});

	it('keeps frozen subsystems untouched for F7-2', () => {
		const queue = readFileSync(
			path.join(root, 'apps/api/src/services/queue/engine.js'),
			'utf8',
		);
		const graph = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/graph-publish.js'),
			'utf8',
		);
		const channelPack = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/channel-pack.js'),
			'utf8',
		);

		assert.doesNotMatch(queue, /normalizeFacebookPublishJob/);
		assert.doesNotMatch(graph, /normalize-facebook/);
		assert.match(channelPack, /publishingHistory:\s*true/);
		assert.match(channelPack, /insights:\s*true/);
	});

	it('preserves default unified history channels without implicit facebook aggregation', () => {
		const listPure = readFileSync(
			path.join(root, 'apps/api/src/services/publishing-history/list-pure.js'),
			'utf8',
		);

		assert.match(listPure, /\['pinterest', 'wordpress'\]/);
	});
});
