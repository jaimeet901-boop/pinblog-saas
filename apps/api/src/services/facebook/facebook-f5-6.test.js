import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FACEBOOK_CHANNEL_CAPABILITIES,
	getFacebookChannelPackDto,
} from './channel-pack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('facebook F5-6 studio & capability integration', () => {
	it('enables schedule and publishing history while keeping insights disabled', () => {
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.schedule, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishNow, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.queueImplemented, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishingHistory, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.insights, true);

		const dto = getFacebookChannelPackDto();
		assert.equal(dto.channelCapabilities.schedule, true);
		assert.equal(dto.publishImplemented, true);
		assert.equal(dto.queueImplemented, true);
	});

	it('wires web destination adapter to live Facebook schedule and job routes', () => {
		const adapter = readFileSync(
			path.join(root, 'apps/web/src/services/studio/destinationAdapters.js'),
			'utf8',
		);
		const scheduleService = readFileSync(
			path.join(root, 'apps/web/src/services/ai-facebook/scheduleService.js'),
			'utf8',
		);
		const publishingService = readFileSync(
			path.join(root, 'apps/web/src/services/ai-facebook/publishingService.js'),
			'utf8',
		);
		const jobMutations = readFileSync(
			path.join(root, 'apps/web/src/services/ai-facebook/jobMutationsService.js'),
			'utf8',
		);

		assert.doesNotMatch(adapter, /FACEBOOK_API_MISSING/);
		assert.match(adapter, /facebookSchedulePins/);
		assert.match(adapter, /cancelFacebookJob/);
		assert.match(scheduleService, /\/facebook\/schedule/);
		assert.match(publishingService, /\/facebook\/publish/);
		assert.match(publishingService, /\/facebook\/jobs/);
		assert.match(jobMutations, /\/facebook\/jobs\/\$\{/);
		assert.match(jobMutations, /\/cancel/);
		assert.match(jobMutations, /\/retry/);
		assert.match(jobMutations, /\/publish-now/);
	});

	it('exposes Facebook channel capabilities to Studio UI', () => {
		const caps = readFileSync(
			path.join(root, 'apps/web/src/lib/facebook/channelCapabilities.js'),
			'utf8',
		);
		const studio = readFileSync(
			path.join(root, 'apps/web/src/pages/app/ContentStudioPage.jsx'),
			'utf8',
		);
		const hub = readFileSync(
			path.join(root, 'apps/web/src/pages/app/FacebookPage.jsx'),
			'utf8',
		);

		assert.match(caps, /schedule:\s*true/);
		assert.match(caps, /publishingHistory:\s*true/);
		assert.match(studio, /destinationCaps\.schedule/);
		assert.match(studio, /destinationCaps\.publishNow/);
		assert.match(hub, /FACEBOOK_CHANNEL_CAPABILITIES/);
		assert.match(hub, /capabilities\.schedule/);
	});

	it('keeps frozen subsystems untouched for F5-6', () => {
		const queue = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/facebook-publish-queue.js'),
			'utf8',
		);
		const graph = readFileSync(
			path.join(root, 'apps/api/src/services/facebook/graph-publish.js'),
			'utf8',
		);
		const calendarAdapter = readFileSync(
			path.join(root, 'apps/api/src/services/calendar/mutations/adapters/facebook.js'),
			'utf8',
		);

		assert.doesNotMatch(queue, /destinationAdapters/);
		assert.doesNotMatch(graph, /destinationAdapters/);
		assert.doesNotMatch(calendarAdapter, /FACEBOOK_API_MISSING/);
	});
});
