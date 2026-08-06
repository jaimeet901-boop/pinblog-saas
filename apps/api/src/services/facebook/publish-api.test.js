import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapFacebookPublishJobDto } from './publish.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('facebook F4-3 publish API DTO', () => {
	it('mapFacebookPublishJobDto exposes public job fields only', () => {
		const dto = mapFacebookPublishJobDto({
			id: 'job_1',
			status: 'scheduled',
			scheduled_at: '2026-08-06T12:00:00.000Z',
			timezone: 'UTC',
			account: 'acc_1',
			page_id: '123456789',
			page_name: 'Chef IA Page',
			ai_pin: 'pin_1',
			title: 'Summer Recipe',
			message: 'Hello Facebook',
			image_url: 'https://cdn.example.com/post.jpg',
			destination_url: 'https://example.com/recipe',
			attempt_count: 0,
			max_attempts: 3,
			claim_token: 'secret-claim',
			raw_api_error: { token: 'hidden' },
		});

		assert.equal(dto.id, 'job_1');
		assert.equal(dto.status, 'scheduled');
		assert.equal(dto.accountId, 'acc_1');
		assert.equal(dto.pageId, '123456789');
		assert.equal(dto.aiPinId, 'pin_1');
		assert.ok(!('claim_token' in dto));
		assert.ok(!('raw_api_error' in dto));
	});
});

describe('facebook F4-3 publish API route wiring', () => {
	it('registers publish and job read routes without worker or graph wiring', () => {
		const route = readFileSync(path.join(root, 'apps/api/src/routes/facebook.js'), 'utf8');

		assert.match(route, /router\.post\('\/publish'/);
		assert.match(route, /router\.post\('\/schedule'/);
		assert.match(route, /router\.get\('\/jobs'/);
		assert.match(route, /router\.get\('\/jobs\/:jobId'/);
		assert.match(route, /prepareFacebookPublishJob/);
		assert.match(route, /mapFacebookPublishJobDto/);
		assert.match(route, /facebook_publish_jobs/);
		assert.match(route, /persistFacebookPublishJobWithCreatedEvent/);
		assert.match(route, /throwForFacebookPublishValidation/);
		assert.match(route, /FACEBOOK_PUBLISH_JOB_NOT_FOUND/);

		const validation = readFileSync(path.join(root, 'apps/api/src/services/facebook/publish-validation.js'), 'utf8');
		assert.match(validation, /FACEBOOK_VALIDATION_FAILED/);

		const jobsListIndex = route.indexOf("router.get('/jobs'");
		const jobsGetIndex = route.indexOf("router.get('/jobs/:jobId'");
		assert.ok(jobsListIndex >= 0 && jobsGetIndex >= 0);
		assert.ok(jobsListIndex < jobsGetIndex, 'list route must register before :jobId');

		assert.doesNotMatch(route, /graph-publish|publishFacebookFeedPost/);
		assert.doesNotMatch(route, /facebook-publish-queue|startFacebookPublishQueue/);
		assert.doesNotMatch(route, /facebook_publish_history/);
		assert.doesNotMatch(route, /consumeFeatureCredits/);
	});

	it('preserves F3 destination routes and legacy pages route', () => {
		const route = readFileSync(path.join(root, 'apps/api/src/routes/facebook.js'), 'utf8');
		assert.match(route, /router\.get\('\/pages'/);
		assert.match(route, /router\.get\('\/destinations'/);
		assert.match(route, /router\.post\('\/destinations\/validate'/);
		assert.match(route, /router\.get\('\/destinations\/:destinationId'/);
		assert.match(route, /mapLegacyPageItem/);
	});
});
