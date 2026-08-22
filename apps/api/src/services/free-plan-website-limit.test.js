/**
 * Free-plan website slot (1 active site). Paid plans stay ungated.
 * Run: node --test src/services/free-plan-website-limit.test.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FREE_PLAN_WEBSITE_FEATURE_KEY,
	freePlanSecondWebsiteLockedError,
	isFreePlanSlug,
	shouldBlockFreePlanSecondWebsite,
} from './free-plan-website-limit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const websitesSource = readFileSync(join(__dirname, '../routes/websites.js'), 'utf8');

function postCreateHandlerSource() {
	const start = websitesSource.indexOf("router.post('/', async (req, res) => {");
	assert.ok(start >= 0, 'missing POST / handler');
	const end = websitesSource.indexOf("router.post('/:websiteId/scan'", start);
	assert.ok(end > start, 'missing scan handler after POST /');
	return websitesSource.slice(start, end);
}

function reconnectHandlerSource() {
	const start = websitesSource.indexOf("router.post('/:websiteId/reconnect'");
	assert.ok(start >= 0, 'missing POST reconnect handler');
	const end = websitesSource.indexOf("router.post('/:websiteId/reset'", start);
	assert.ok(end > start, 'missing reset handler after reconnect');
	return websitesSource.slice(start, end);
}

describe('shouldBlockFreePlanSecondWebsite', () => {
	it('Free + 0 active sites => allowed', () => {
		assert.equal(shouldBlockFreePlanSecondWebsite({ planSlug: 'free', activeCount: 0 }), false);
	});

	it('Free + 1 active site => blocked', () => {
		assert.equal(shouldBlockFreePlanSecondWebsite({ planSlug: 'free', activeCount: 1 }), true);
		assert.equal(shouldBlockFreePlanSecondWebsite({ planSlug: 'Free', activeCount: 2 }), true);
	});

	it('Paid + 1 (or more) active sites => not blocked', () => {
		assert.equal(shouldBlockFreePlanSecondWebsite({ planSlug: 'starter', activeCount: 1 }), false);
		assert.equal(shouldBlockFreePlanSecondWebsite({ planSlug: 'pro', activeCount: 1 }), false);
		assert.equal(shouldBlockFreePlanSecondWebsite({ planSlug: 'starter', activeCount: 5 }), false);
		assert.equal(shouldBlockFreePlanSecondWebsite({ planSlug: 'business', activeCount: 40 }), false);
	});

	it('reconnect of the only disconnected site remains allowed (0 active)', () => {
		assert.equal(shouldBlockFreePlanSecondWebsite({
			planSlug: 'free',
			activeCount: 0,
			targetAlreadyActive: false,
		}), false);
	});

	it('Free cannot create a second active site through reconnect', () => {
		assert.equal(shouldBlockFreePlanSecondWebsite({
			planSlug: 'free',
			activeCount: 1,
			targetAlreadyActive: false,
		}), true);
	});

	it('reconnect of an already-active site is not treated as a new slot', () => {
		assert.equal(shouldBlockFreePlanSecondWebsite({
			planSlug: 'free',
			activeCount: 1,
			targetAlreadyActive: true,
		}), false);
	});

	it('non-free / missing slug is not this gate', () => {
		assert.equal(isFreePlanSlug('starter'), false);
		assert.equal(isFreePlanSlug(''), false);
		assert.equal(shouldBlockFreePlanSecondWebsite({ planSlug: '', activeCount: 3 }), false);
	});
});

describe('FEATURE_LOCKED payload', () => {
	it('uses featureKey websites without wordpress catalog assert', () => {
		const err = freePlanSecondWebsiteLockedError();
		assert.equal(err.status, 403);
		assert.equal(err.errorCode, 'FEATURE_LOCKED');
		assert.equal(err.featureKey, FREE_PLAN_WEBSITE_FEATURE_KEY);
		assert.equal(err.access.locked, true);
		assert.equal(err.access.enabled, false);
		assert.deepEqual(err.requiredKeys, ['websites']);
	});
});

describe('Gate placement in websites routes', () => {
	it('POST / asserts Free slot before createWebsiteRecord and reconnect-as-create', () => {
		const post = postCreateHandlerSource();
		const guardIdx = post.indexOf('assertFreePlanMayActivateWebsite');
		const reconnectIdx = post.indexOf('reconnectWebsite');
		const createIdx = post.indexOf('createWebsiteRecord');
		assert.ok(guardIdx >= 0, 'POST / must call assertFreePlanMayActivateWebsite');
		assert.ok(createIdx > guardIdx, 'guard must run before createWebsiteRecord');
		assert.ok(reconnectIdx > guardIdx, 'guard must run before reconnect-as-create');
		assert.doesNotMatch(post, /assertFeatureAccess\(req,\s*'wordpress'/);
	});

	it('POST reconnect asserts Free slot before reconnectWebsite', () => {
		const reconnect = reconnectHandlerSource();
		const guardIdx = reconnect.indexOf('assertFreePlanMayActivateWebsite');
		const callIdx = reconnect.indexOf('reconnectWebsite');
		assert.ok(guardIdx >= 0, 'reconnect must call assertFreePlanMayActivateWebsite');
		assert.ok(callIdx > guardIdx, 'guard must run before reconnectWebsite');
		assert.doesNotMatch(reconnect, /assertFeatureAccess\(req,\s*'wordpress'/);
	});

	it('POST reset uses the same Free slot guard before re-activating', () => {
		const start = websitesSource.indexOf("router.post('/:websiteId/reset'");
		assert.ok(start >= 0);
		const reset = websitesSource.slice(start, websitesSource.indexOf('router.delete', start));
		const guardIdx = reset.indexOf('assertFreePlanMayActivateWebsite');
		const callIdx = reset.indexOf('resetWebsite');
		assert.ok(guardIdx >= 0, 'reset must call assertFreePlanMayActivateWebsite');
		assert.ok(callIdx > guardIdx, 'guard must run before resetWebsite');
	});

	it('websites router never uses wordpress feature access for this limit', () => {
		assert.doesNotMatch(websitesSource, /assertFeatureAccess\(req,\s*'wordpress'/);
		assert.match(websitesSource, /assertFreePlanMayActivateWebsite/);
		assert.match(websitesSource, /shouldBlockFreePlanSecondWebsite/);
		assert.match(websitesSource, /listOwnedWebsites/);
	});
});
