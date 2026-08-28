/**
 * Free plan public visibility — catalog / self-serve selection only.
 * Run: node --test src/services/public-free-plan-visibility.test.js
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateFeatureAccess } from './plan-access.js';
import { PLAN_SEED_CATALOG } from './plan-catalog.js';
import {
	assertFreePlanSelectable,
	filterPublicPlanCatalog,
	isPublicFreePlanVisible,
} from './public-free-plan-visibility.js';

const here = dirname(fileURLToPath(import.meta.url));
const billingSource = readFileSync(join(here, 'workspace-billing.js'), 'utf8');
const assignSource = readFileSync(join(here, 'billing/assign-workspace-plan.js'), 'utf8');
const cancelSource = readFileSync(join(here, 'billing/subscription-cancel.js'), 'utf8');
const catalogSource = readFileSync(join(here, 'plan-catalog.js'), 'utf8');
const planAccessSource = readFileSync(join(here, 'plan-access.js'), 'utf8');
const settingsPageSource = readFileSync(
	join(here, '../../../web/src/pages/admin/AdminSettingsPage.jsx'),
	'utf8',
);
const authContextSource = readFileSync(
	join(here, '../../../web/src/context/AuthContext.jsx'),
	'utf8',
);
const settingsServiceSource = readFileSync(join(here, 'platform-settings.js'), 'utf8');

const FREE = { id: 'plan_free', slug: 'free', name: 'Free', active: true, monthlyPrice: 0, credits: 50 };
const STARTER = { id: 'plan_starter', slug: 'starter', name: 'Starter', active: true, monthlyPrice: 19, credits: 500 };
const PRO = { id: 'plan_pro', slug: 'pro', name: 'Pro', active: true, monthlyPrice: 49, credits: 2000 };
const CATALOG = [FREE, STARTER, PRO];

const HIDDEN = { general: { publicFreePlanVisible: false } };
const VISIBLE = { general: { publicFreePlanVisible: true } };

describe('A. default — missing setting => visible', () => {
	it('treats undefined settings as visible', () => {
		assert.equal(isPublicFreePlanVisible(undefined), true);
		assert.equal(isPublicFreePlanVisible(null), true);
		assert.equal(isPublicFreePlanVisible({}), true);
		assert.equal(isPublicFreePlanVisible({ general: {} }), true);
	});

	it('DEFAULT_PLATFORM_SETTINGS.general.publicFreePlanVisible is true', () => {
		assert.match(settingsServiceSource, /publicFreePlanVisible: true/);
		assert.equal(isPublicFreePlanVisible({ general: { publicFreePlanVisible: true } }), true);
	});
});

describe('B. visible — Free remains in catalog', () => {
	it('keeps Free when publicFreePlanVisible is true', () => {
		const next = filterPublicPlanCatalog(CATALOG, VISIBLE);
		assert.equal(next.some((item) => item.slug === 'free'), true);
		assert.equal(next.length, 3);
	});
});

describe('C. hidden — Free is omitted from catalog', () => {
	it('removes only slug free and does not mutate the original array', () => {
		const original = [...CATALOG];
		const next = filterPublicPlanCatalog(CATALOG, HIDDEN);
		assert.deepEqual(original, CATALOG);
		assert.equal(CATALOG.some((item) => item.slug === 'free'), true);
		assert.equal(next.some((item) => item.slug === 'free'), false);
		assert.deepEqual(next.map((item) => item.slug), ['starter', 'pro']);
		assert.equal(next[0], STARTER);
	});

	it('does not omit other slugs', () => {
		const next = filterPublicPlanCatalog(
			[{ slug: 'free-trial' }, { slug: 'starter' }],
			HIDDEN,
		);
		assert.deepEqual(next.map((item) => item.slug), ['free-trial', 'starter']);
	});
});

describe('D. existing Free user — current plan remains Free when hidden', () => {
	it('filterPublicPlanCatalog does not alter a separate current plan object', () => {
		const currentPlan = { ...FREE };
		filterPublicPlanCatalog(CATALOG, HIDDEN);
		assert.equal(currentPlan.slug, 'free');
		assert.equal(currentPlan.active, true);
		assert.equal(currentPlan.credits, 50);
	});

	it('GET /workspace/v1/subscription still returns unfiltered `plan` while catalog is filtered', () => {
		assert.match(billingSource, /\n\t\tplan,\n\t\tplans: filterPublicPlanCatalog/);
		assert.match(billingSource, /planSlug: plan\?\.slug \|\| req\.workspace\.plan_slug \|\| 'free'/);
	});
});

describe('E. hidden + paid user requests Free — PLAN_NOT_FOUND', () => {
	it('throws 404 PLAN_NOT_FOUND when current plan is not free', () => {
		assert.throws(
			() => assertFreePlanSelectable({ plan: FREE, currentSlug: 'pro', settings: HIDDEN }),
			(err) => err.status === 404 && err.errorCode === 'PLAN_NOT_FOUND',
		);
		assert.throws(
			() => assertFreePlanSelectable({ plan: FREE, currentSlug: 'starter', settings: HIDDEN }),
			(err) => err.status === 404 && err.errorCode === 'PLAN_NOT_FOUND',
		);
	});
});

describe('F. already Free requests Free — PLAN_UNCHANGED path stays open', () => {
	it('does not throw when current slug is already free while hidden', () => {
		assert.doesNotThrow(() => assertFreePlanSelectable({
			plan: FREE,
			currentSlug: 'free',
			settings: HIDDEN,
		}));
	});

	it('checkout still throws PLAN_UNCHANGED after resolve when already on the target plan', () => {
		assert.match(billingSource, /Already on this plan/);
		assert.match(billingSource, /PLAN_UNCHANGED/);
		const resolveIdx = billingSource.indexOf('const plan = await resolvePlanFromPayload(payload, req);');
		const unchangedIdx = billingSource.indexOf("throw httpError(409, 'Already on this plan', 'PLAN_UNCHANGED')");
		assert.ok(resolveIdx >= 0 && unchangedIdx > resolveIdx);
	});
});

describe('G. feature access — visibility flag does not affect evaluation', () => {
	it('evaluateFeatureAccess still grants enabled features while Free is hidden', () => {
		const result = evaluateFeatureAccess({
			featureKey: 'history',
			features: { history: { enabled: true }, aiWriter: { enabled: false } },
		});
		assert.equal(result.enabled, true);
		assert.equal(result.locked, false);
	});

	it('evaluateFeatureAccess locks aiWriter when Free-style features disable it', () => {
		const result = evaluateFeatureAccess({
			featureKey: 'aiWriter',
			features: { history: { enabled: true }, aiWriter: { enabled: false } },
		});
		assert.equal(result.enabled, false);
		assert.equal(result.locked, true);
	});

	it('plan-access does not import the visibility helper', () => {
		assert.doesNotMatch(planAccessSource, /public-free-plan-visibility/);
		assert.doesNotMatch(planAccessSource, /publicFreePlanVisible/);
	});
});

describe('H. admin assignment — still allowed while hidden', () => {
	it('assignWorkspacePlan does not import or call the visibility helper', () => {
		assert.doesNotMatch(assignSource, /public-free-plan-visibility/);
		assert.doesNotMatch(assignSource, /assertFreePlanSelectable/);
		assert.doesNotMatch(assignSource, /publicFreePlanVisible/);
	});
});

describe('I. cancel-to-Free — still works while hidden', () => {
	it('subscription cancel still loads plan slug free without the visibility helper', () => {
		assert.match(cancelSource, /loadPlanFn\('free'\)/);
		assert.doesNotMatch(cancelSource, /public-free-plan-visibility/);
		assert.doesNotMatch(cancelSource, /assertFreePlanSelectable/);
		assert.doesNotMatch(cancelSource, /publicFreePlanVisible/);
	});
});

describe('J. Free plan record — active/status/pricing/credits unchanged', () => {
	it('seed Free plan stays slug free, active, priced at 0, 50 credits', () => {
		const free = PLAN_SEED_CATALOG.find((item) => item.slug === 'free');
		assert.ok(free);
		assert.equal(free.active, true);
		assert.equal(free.status, 'active');
		assert.equal(free.monthly_price, 0);
		assert.equal(free.credits, 50);
		assert.notEqual(free.features?.aiWriter, true);
		assert.equal(free.features?.history, true);
	});

	it('visibility helper never writes plans.active or plans.status', () => {
		const helper = readFileSync(join(here, 'public-free-plan-visibility.js'), 'utf8');
		assert.doesNotMatch(helper, /setPlanEnabled/);
		assert.doesNotMatch(helper, /plans\.update/);
		assert.doesNotMatch(helper, /status: 'hidden'/);
		assert.match(catalogSource, /slug: 'free'/);
	});
});

describe('K. client cannot bypass — planSlug=free cannot activate Free when hidden', () => {
	it('self-serve resolve uses server settings, not client payload flags', () => {
		assert.match(billingSource, /assertFreePlanSelectable/);
		assert.match(billingSource, /getPlatformSettings\(\)/);
		assert.match(billingSource, /settings: platform\?\.settings \|\| \{\}/);
		assert.doesNotMatch(billingSource, /payload\.publicFreePlanVisible/);
		assert.doesNotMatch(billingSource, /payload\.settings/);
		assert.match(billingSource, /resolvePlanFromPayload\(payload, req\)/);
	});

	it('planId of Free is treated the same as slug free', () => {
		assert.throws(
			() => assertFreePlanSelectable({
				plan: { id: 'pb_free_id', slug: 'free' },
				currentSlug: 'business',
				settings: HIDDEN,
			}),
			(err) => err.status === 404 && err.errorCode === 'PLAN_NOT_FOUND',
		);
	});

	it('paid target plans remain selectable while Free is hidden', () => {
		assert.doesNotThrow(() => assertFreePlanSelectable({
			plan: PRO,
			currentSlug: 'starter',
			settings: HIDDEN,
		}));
	});
});

describe('admin console control', () => {
	it('Global Settings exposes Visible/Hidden and saves via PUT /admin/v1/settings', () => {
		assert.match(settingsPageSource, /Free Plan Public Visibility/);
		assert.match(settingsPageSource, /publicFreePlanVisible/);
		assert.match(settingsPageSource, /value !== 'hidden'/);
		assert.match(settingsPageSource, /\/admin\/v1\/settings/);
		assert.doesNotMatch(settingsPageSource, /\/admin\/v1\/plans\/.*enable/);
		assert.doesNotMatch(settingsPageSource, /\/admin\/v1\/plans\/.*disable/);
	});

	it('does not close registration or change signup default free', () => {
		assert.match(settingsServiceSource, /allowRegistration: true/);
		assert.match(settingsServiceSource, /defaultWorkspacePlan: 'free'/);
		assert.match(authContextSource, /plan: 'free'/);
		assert.doesNotMatch(settingsServiceSource, /setPlanEnabled/);
	});
});
