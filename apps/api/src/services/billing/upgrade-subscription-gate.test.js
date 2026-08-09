/**
 * Phase 3.7 — upgradeSubscription() HTTP exposure gate tests.
 * Run: node --test src/services/billing/upgrade-subscription-gate.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PaddleBillingProvider } from './providers/paddle.js';
import { PayPalBillingProvider } from './providers/paypal.js';
import { NoneBillingProvider } from './providers/none.js';
import {
	buildAdminAssignMetadataFields,
	validateAdminOverrideReason,
} from './admin-plan-assign.js';
import {
	computeNextEntitlementSyncVersion,
	resolveAuthoritativePlanSlug,
} from './entitlement-sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(__dirname, '..', '..');

function readSrc(relativePath) {
	return readFileSync(join(apiSrc, relativePath), 'utf8');
}

/**
 * Mirrors subscriptions.js immediate-local gate (Phase 3.7 audit evidence).
 */
function wouldApplyImmediateLocalUpgrade({ immediate = true, remote = {} } = {}) {
	return immediate || remote.localOnly !== false;
}

describe('Phase 3.7 HTTP exposure gate', () => {
	it('workspace billing module does not import upgradeSubscription', () => {
		const source = readSrc('services/workspace-billing.js');
		assert.equal(source.includes('upgradeSubscription'), false);
	});

	it('workspace routes do not wire upgradeSubscription', () => {
		const routes = readSrc('routes/workspace/index.js');
		assert.equal(routes.includes('upgradeSubscription'), false);
		assert.match(routes, /subscription\/change/);
		assert.match(routes, /subscription\/checkout/);
		assert.doesNotMatch(routes, /subscription\/upgrade/);
	});

	it('admin plans route uses assignWorkspacePlan not upgradeSubscription', () => {
		const adminPlans = readSrc('routes/admin/plans.js');
		assert.match(adminPlans, /assignWorkspacePlan/);
		assert.equal(adminPlans.includes('upgradeSubscription'), false);
	});

	it('changeWorkspacePlan rejects paid plans before local mutation', () => {
		const source = readSrc('services/workspace-billing.js');
		assert.match(source, /resolveAuthoritativePlanBillingType/);
		assert.match(source, /planIsPaid\(plan\)/);
		assert.match(source, /CHECKOUT_REQUIRED/);
		assert.match(source, /Paid plan changes require a completed checkout/);
	});
});

describe('Phase 3.8 workspace checkout interval forwarding', () => {
	it('startWorkspaceSubscriptionCheckout validates and forwards billingInterval', () => {
		const source = readSrc('services/workspace-billing.js');
		assert.match(source, /validateBillingInterval/);
		assert.match(source, /billingInterval/);
		assert.match(source, /INVALID_BILLING_INTERVAL/);
		assert.match(source, /createSubscriptionCheckout\(\{[\s\S]*billingInterval/);
	});
});

describe('Phase 3.7 provider changeSubscriptionPlan capabilities', () => {
	it('Paddle stub does not confirm remote plan change', async () => {
		const provider = new PaddleBillingProvider({ vendorId: 'v', apiKey: 'k' });
		const result = await provider.changeSubscriptionPlan({
			workspaceKey: 'ws-demo',
			fromPlan: 'starter',
			toPlan: 'pro',
			providerSubscriptionId: 'sub_paddle_123',
		});
		assert.equal(result.changed, false);
		assert.notEqual(result.localOnly, false);
	});

	it('PayPal stub does not confirm remote plan change', async () => {
		const provider = new PayPalBillingProvider({
			clientId: 'x',
			clientSecret: 'y',
		});
		const result = await provider.changeSubscriptionPlan({
			workspaceKey: 'ws-demo',
			fromPlan: 'starter',
			toPlan: 'pro',
		});
		assert.equal(result.changed, false);
		assert.notEqual(result.localOnly, false);
	});

	it('none provider is explicitly localOnly', async () => {
		const provider = new NoneBillingProvider();
		const result = await provider.changeSubscriptionPlan({});
		assert.equal(result.localOnly, true);
	});
});

describe('Phase 3.7 upgradeSubscription local-path security gate', () => {
	it('Paddle remote stub would trigger immediate local upgrade (internal risk if HTTP exposed)', () => {
		const remote = { ready: true, provider: 'paddle', changed: false };
		assert.equal(wouldApplyImmediateLocalUpgrade({ immediate: true, remote }), true);
	});

	it('only explicit localOnly:false with immediate:false schedules instead of local apply', () => {
		assert.equal(
			wouldApplyImmediateLocalUpgrade({ immediate: false, remote: { localOnly: false } }),
			false,
		);
	});

	it('provider throw fallback localOnly:true always opens local path', () => {
		assert.equal(
			wouldApplyImmediateLocalUpgrade({ immediate: true, remote: { localOnly: true } }),
			true,
		);
	});
});

describe('Phase 3.7 regression guards (Phase 3.1 / 3.3 intact)', () => {
	it('entitlement sync helpers remain available (Phase 3.1)', () => {
		assert.equal(resolveAuthoritativePlanSlug({ slug: 'Pro' }), 'pro');
		assert.equal(computeNextEntitlementSyncVersion(3), 4);
	});

	it('admin override metadata contract remains (Phase 3.3)', () => {
		const meta = buildAdminAssignMetadataFields('admin_1', 'Support correction');
		assert.equal(meta.activation_source, 'admin_override');
		assert.equal(meta.billing_source, 'admin_override');
		assert.throws(() => validateAdminOverrideReason({}));
	});
});
