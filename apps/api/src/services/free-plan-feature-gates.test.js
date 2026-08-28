/**
 * Free-plan paid-feature gate regression tests.
 * Run: node --test src/services/free-plan-feature-gates.test.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	assertFeatureAccess,
	featureLockedError,
} from './plan-access-guard.js';
import { evaluateFeatureAccessForPlan } from './plan-access.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(__dirname, '..');

function readSrc(relativePath) {
	return readFileSync(join(apiSrc, relativePath), 'utf8');
}

const FREE_PLAN = {
	slug: 'free',
	features: {
		aiWriter: { enabled: false },
		history: { enabled: true },
		aiImages: { enabled: false },
		pinterest: { enabled: false },
		facebook: { enabled: false },
		wordpress: { enabled: false },
		calendar: { enabled: false },
		analytics: { enabled: false },
		templates: { enabled: false },
	},
	topup_allowed: false,
};

const STARTER_PLAN = {
	slug: 'starter',
	features: {
		aiWriter: { enabled: true },
		history: { enabled: true },
		aiImages: { enabled: true },
		pinterest: { enabled: true },
		facebook: { enabled: true },
		wordpress: { enabled: true },
		calendar: { enabled: true },
		analytics: { enabled: false },
		templates: { enabled: true },
	},
	topup_allowed: true,
};

const PRO_PLAN = {
	slug: 'pro',
	features: {
		aiWriter: { enabled: true },
		history: { enabled: true },
		aiImages: { enabled: true },
		pinterest: { enabled: true },
		facebook: { enabled: true },
		wordpress: { enabled: true },
		calendar: { enabled: true },
		analytics: { enabled: true },
		templates: { enabled: true },
		'templates.premium': { enabled: true },
	},
	topup_allowed: true,
};

function freeReq() {
	return {
		pocketbaseUserId: 'user_free',
		workspaceUser: { role: 'member' },
		workspaceSubscription: { expand: { plan: FREE_PLAN }, plan: 'plan_free' },
	};
}

function freeContext() {
	return { plan: FREE_PLAN, isPlatformAdmin: false };
}

function starterContext() {
	return { plan: STARTER_PLAN, isPlatformAdmin: false };
}

function proContext() {
	return { plan: PRO_PLAN, isPlatformAdmin: false };
}

describe('Free plan FEATURE_LOCKED gates (A–H)', () => {
	const paidKeys = ['aiWriter', 'aiImages', 'pinterest', 'facebook', 'wordpress', 'calendar', 'analytics'];

	for (const key of paidKeys) {
		it(`A–G: Free + ${key} → FEATURE_LOCKED`, async () => {
			await assert.rejects(
				() => assertFeatureAccess(freeReq(), key, { context: freeContext() }),
				(err) => err?.errorCode === 'FEATURE_LOCKED' && err?.status === 403 && err?.featureKey === key,
			);
		});
	}

	it('G: Free history remains allowed', async () => {
		const access = await assertFeatureAccess(freeReq(), 'history', { context: freeContext() });
		assert.equal(access.enabled, true);
	});

	it('H: Free topup_allowed=false maps to FEATURE_LOCKED shape for credit packs', () => {
		assert.equal(FREE_PLAN.topup_allowed, false);
		const err = featureLockedError(
			{
				visible: true,
				enabled: false,
				locked: true,
				missingKeys: [],
				dependencyChain: [],
			},
			{
				featureKey: 'creditPacks',
				message: 'Credit packs require a paid plan. Open Subscription to upgrade.',
			},
		);
		assert.equal(err.status, 403);
		assert.equal(err.errorCode, 'FEATURE_LOCKED');
		assert.equal(err.featureKey, 'creditPacks');
		assert.equal(err.access.locked, true);
	});
});

describe('Paid plan access preserved (I)', () => {
	it('Starter retains aiImages/pinterest/facebook/wordpress/calendar', async () => {
		for (const key of ['aiImages', 'pinterest', 'facebook', 'wordpress', 'calendar', 'aiWriter']) {
			const access = await assertFeatureAccess(freeReq(), key, { context: starterContext() });
			assert.equal(access.enabled, true, key);
		}
	});

	it('Pro retains analytics', async () => {
		const access = await assertFeatureAccess(freeReq(), 'analytics', { context: proContext() });
		assert.equal(access.enabled, true);
	});

	it('Starter analytics stays locked (Pro feature)', async () => {
		await assert.rejects(
			() => assertFeatureAccess(freeReq(), 'analytics', { context: starterContext() }),
			(err) => err?.errorCode === 'FEATURE_LOCKED',
		);
	});
});

describe('Existing Writer + premium template protection (J–K)', () => {
	it('J: AI Writer still gated for plans without aiWriter', async () => {
		const lockedPlan = {
			slug: 'custom',
			features: { aiWriter: { enabled: false } },
		};
		const denied = evaluateFeatureAccessForPlan(lockedPlan, 'aiWriter', { isPlatformAdmin: false });
		assert.equal(denied.enabled, false);
		assert.equal(denied.locked, true);
	});

	it('J: Free seed locks aiWriter (paid only)', () => {
		const denied = evaluateFeatureAccessForPlan(FREE_PLAN, 'aiWriter', { isPlatformAdmin: false });
		assert.equal(denied.enabled, false);
		assert.equal(denied.locked, true);
	});

	it('J: Free seed still allows history', () => {
		const allowed = evaluateFeatureAccessForPlan(FREE_PLAN, 'history', { isPlatformAdmin: false });
		assert.equal(allowed.enabled, true);
	});

	it('K: premium template key remains gated on Free', () => {
		const denied = evaluateFeatureAccessForPlan(FREE_PLAN, 'templates.premium', { isPlatformAdmin: false });
		assert.equal(denied.enabled, false);
		const allowed = evaluateFeatureAccessForPlan(PRO_PLAN, 'templates.premium', { isPlatformAdmin: false });
		assert.equal(allowed.enabled, true);
	});
});

describe('Gate placement: assertFeatureAccess before credit/mutation (source order)', () => {
	it('AI Pins analyze/prompts assert before withPinTextFeatureCredits / withAnalyzeAndPromptCredits', () => {
		const source = readSrc('routes/ai-pins.js');
		const analyze = source.slice(source.indexOf("router.post('/analyze'"));
		assert.ok(analyze.indexOf("assertFeatureAccess(req, 'aiWriter'") < analyze.indexOf('withPinTextFeatureCredits'));
		const prompts = source.slice(source.indexOf("router.post('/prompts'"));
		assert.ok(prompts.indexOf("assertFeatureAccess(req, 'aiWriter'") < prompts.indexOf('withAnalyzeAndPromptCredits'));
	});

	it('AI image jobs assert before createImageJobRecord / regenerate work', () => {
		const source = readSrc('routes/ai-pin-images.js');
		const jobs = source.slice(source.indexOf("router.post('/jobs'"));
		assert.ok(jobs.indexOf("assertFeatureAccess(req, 'aiImages'") < jobs.indexOf('createImageJobRecord'));
		const regen = source.slice(source.indexOf("router.post('/jobs/:jobId/regenerate'"));
		assert.ok(regen.indexOf("assertFeatureAccess(req, 'aiImages'") < regen.indexOf('sanitizeCollectionPayload'));
	});

	it('Pinterest publish/oauth assert before provider publish', () => {
		const source = readSrc('routes/pinterest.js');
		const publish = source.slice(source.indexOf("router.post('/publish'"));
		assert.ok(publish.indexOf("assertFeatureAccess(req, 'pinterest'") < publish.indexOf('getPublishProvider().publish'));
		assert.match(source, /router\.post\('\/oauth\/start'[\s\S]*?assertFeatureAccess\(req, 'pinterest'/);
	});

	it('Facebook publish/oauth assert before prepare/persist', () => {
		const source = readSrc('routes/facebook.js');
		const publish = source.slice(source.indexOf("router.post('/publish'"));
		assert.ok(publish.indexOf("assertFeatureAccess(req, 'facebook'") < publish.indexOf('prepareFacebookPublishJob'));
		assert.match(source, /router\.post\('\/oauth\/start'[\s\S]*?assertFeatureAccess\(req, 'facebook'/);
	});

	it('WordPress publish assert before enqueueWordpressPublish', () => {
		const source = readSrc('routes/wordpress/index.js');
		const publish = source.slice(source.indexOf("router.post('/publish'"));
		assert.ok(publish.indexOf("assertFeatureAccess(req, 'wordpress'") < publish.indexOf('enqueueWordpressPublish'));
	});

	it('Calendar mutations assert calendar feature', () => {
		const source = readSrc('routes/workspace/index.js');
		assert.match(source, /router\.post\('\/calendar'[\s\S]*?assertFeatureAccess\(req, 'calendar'/);
		assert.match(source, /router\.delete\('\/calendar\/:id'[\s\S]*?assertFeatureAccess\(req, 'calendar'/);
	});

	it('Analytics routes assert analytics feature', () => {
		const source = readSrc('routes/workspace/analytics.js');
		assert.match(source, /assertFeatureAccess\(req, 'analytics'/);
		assert.ok(source.indexOf("assertCapability(req, 'workspace.analytics.read')") < source.indexOf("assertFeatureAccess(req, 'analytics'"));
	});

	it('purchaseCreditPack enforces topup_allowed before checkout', () => {
		const source = readSrc('services/billing/payg.js');
		const fn = source.slice(source.indexOf('export async function purchaseCreditPack'));
		assert.match(fn, /topup_allowed === false/);
		assert.match(fn, /featureLockedError/);
		assert.ok(fn.indexOf('topup_allowed === false') < fn.indexOf('createCreditPackCheckout'));
		assert.ok(fn.indexOf('topup_allowed === false') < fn.indexOf('claimIdempotencyKey'));
	});

	it('Integrated AI Writer gate remains before credit reservation', () => {
		const source = readSrc('routes/integrated-ai.js');
		const callAssert = source.indexOf('await assertFeatureAccess(req, WRITER_FEATURE_KEY');
		const callReserve = source.indexOf('await reserveIntegratedAiStreamCredits(');
		assert.ok(callAssert > 0 && callReserve > 0);
		assert.ok(callAssert < callReserve);
	});
});
