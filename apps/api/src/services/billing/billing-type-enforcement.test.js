/**
 * Phase 4.1 — billing_type enforcement gate tests.
 * Run: node --test src/services/billing/billing-type-enforcement.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(__dirname, '..', '..');

function readSrc(relativePath) {
	return readFileSync(join(apiSrc, relativePath), 'utf8');
}

describe('Phase 4.1 workspace billing source gates', () => {
	it('uses resolveAuthoritativePlanBillingType for paid/free classification', () => {
		const source = readSrc('services/workspace-billing.js');
		assert.match(source, /resolveAuthoritativePlanBillingType/);
		assert.match(source, /resolvePlanBillingTypeOrThrow/);
	});

	it('does not classify paid/free from monthly_price or yearly_price heuristics', () => {
		const source = readSrc('services/workspace-billing.js');
		assert.doesNotMatch(source, /monthly_price.*\|\|.*yearly_price/);
		assert.doesNotMatch(source, /Number\(plan\?\.monthly_price\).*>\s*0/);
	});

	it('changeWorkspacePlan rejects paid billing_type with CHECKOUT_REQUIRED', () => {
		const source = readSrc('services/workspace-billing.js');
		assert.match(source, /planIsPaid\(plan\)/);
		assert.match(source, /CHECKOUT_REQUIRED/);
		assert.match(source, /Paid plan changes require a completed checkout/);
	});

	it('startWorkspaceSubscriptionCheckout fail-closes on invalid billing_type', () => {
		const source = readSrc('services/workspace-billing.js');
		assert.match(source, /MISSING_PLAN_BILLING_TYPE/);
		assert.match(source, /INVALID_PLAN_BILLING_TYPE/);
	});

	it('does not expose upgradeSubscription over HTTP', () => {
		const billing = readSrc('services/workspace-billing.js');
		const routes = readSrc('routes/workspace/index.js');
		assert.equal(billing.includes('upgradeSubscription'), false);
		assert.equal(routes.includes('upgradeSubscription'), false);
		assert.doesNotMatch(routes, /subscription\/upgrade/);
	});
});

describe('Phase 4.1 certified provider paths unchanged', () => {
	it('Paddle transaction verification still uses billing_type with resolveBillingTypeFromPlan fallback', () => {
		const source = readSrc('services/billing/paddle-transaction-verification.js');
		assert.match(source, /planRecord\.billing_type \|\| resolveBillingTypeFromPlan/);
		assert.doesNotMatch(source, /resolveAuthoritativePlanBillingType/);
	});

	it('PayPal transaction verification still uses billing_type with resolveBillingTypeFromPlan fallback', () => {
		const source = readSrc('services/billing/paypal-transaction-verification.js');
		assert.match(source, /planRecord\.billing_type \|\| resolveBillingTypeFromPlan/);
		assert.doesNotMatch(source, /resolveAuthoritativePlanBillingType/);
	});

	it('Paddle HMAC verification module untouched by Phase 4.1', () => {
		const paddleProvider = readSrc('services/billing/providers/paddle.js');
		assert.match(paddleProvider, /verifyPaddleWebhookSignature/);
		assert.doesNotMatch(paddleProvider, /resolveAuthoritativePlanBillingType/);
	});
});
