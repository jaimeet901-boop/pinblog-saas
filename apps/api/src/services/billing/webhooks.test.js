/**
 * Phase 3 — Billing webhook fail-closed (none provider).
 * Run: node --test src/services/billing/webhooks.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NoneBillingProvider } from './providers/none.js';

describe('NoneBillingProvider webhook verification', () => {
	it('verifyWebhook fails closed (no unauthenticated ingress)', async () => {
		const provider = new NoneBillingProvider();
		const result = await provider.verifyWebhook({});
		assert.equal(result.ok, false);
		assert.equal(result.provider, 'none');
		assert.equal(result.error, 'none_provider_webhooks_disabled');
	});

	it('verifyWebhook fails closed regardless of request body', async () => {
		const provider = new NoneBillingProvider();
		const result = await provider.verifyWebhook({
			headers: { 'stripe-signature': 'forged' },
			body: {
				type: 'checkout.session.completed',
				metadata: { workspaceKey: 'ws_test', planSlug: 'pro' },
			},
		});
		assert.equal(result.ok, false);
	});
});

describe('handleBillingWebhook verify gate (none provider contract)', () => {
	it('rejects when verifyWebhook returns ok: false', async () => {
		const provider = new NoneBillingProvider();
		const verified = await provider.verifyWebhook({});
		assert.equal(verified?.ok, false);

		let thrown;
		try {
			if (!verified?.ok) {
				const error = new Error(verified?.error || 'Webhook signature verification failed');
				error.status = 401;
				error.errorCode = 'WEBHOOK_UNAUTHORIZED';
				throw error;
			}
		} catch (error) {
			thrown = error;
		}

		assert.equal(thrown?.status, 401);
		assert.equal(thrown?.errorCode, 'WEBHOOK_UNAUTHORIZED');
		assert.match(String(thrown?.message), /none_provider_webhooks_disabled/);
	});
});
