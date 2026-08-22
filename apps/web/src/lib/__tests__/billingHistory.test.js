/**
 * PR-19 — Customer billing history UI tests.
 * Run: node --test src/lib/__tests__/billingHistory.test.js
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	BILLING_HISTORY_PATH,
	formatBillingHistoryAmount,
} from '../billingHistory.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(
	path.resolve(here, '../../pages/app/SubscriptionPage.jsx'),
	'utf8',
);

describe('PR-19 billing history helper', () => {
	it('uses the workspace billing history endpoint', () => {
		assert.equal(BILLING_HISTORY_PATH, '/workspace/v1/billing/history');
	});

	it('formats amount snapshots and leaves missing amounts blank', () => {
		assert.equal(formatBillingHistoryAmount({ amount: null }), '—');
		assert.match(formatBillingHistoryAmount({ amount: 9, currency: 'USD' }), /9/);
	});
});

describe('PR-19 SubscriptionPage wiring', () => {
	it('no longer hardcodes an empty billingHistory array', () => {
		assert.equal(/const billingHistory = \[\]/.test(pageSource), false);
		assert.match(pageSource, /BILLING_HISTORY_PATH/);
		assert.match(pageSource, /No billing activity yet/);
		assert.equal(/once Stripe invoices are connected/.test(pageSource), false);
	});

	it('keeps Download Invoice and Manage Billing honestly disabled', () => {
		assert.match(pageSource, /notifyBillingPlaceholder\('Manage Billing'\)/);
		assert.match(pageSource, /notifyBillingPlaceholder\('Download Invoice'\)/);
		assert.match(pageSource, /disabled onClick=\{\(\) => notifyBillingPlaceholder\('Download Invoice'\)\}/);
	});

	it('preserves PR-08 cancel and PR-09 credit pack UI', () => {
		assert.match(pageSource, /SUBSCRIPTION_CANCEL_PATH/);
		assert.match(pageSource, /canShowSubscriptionCancel\(subscription\)/);
		assert.match(pageSource, /CREDIT_PACK_PURCHASE_PATH/);
		assert.match(pageSource, /canBuyCreditPack\(billing\)/);
		assert.match(pageSource, /bill-credit-packs/);
	});
});
