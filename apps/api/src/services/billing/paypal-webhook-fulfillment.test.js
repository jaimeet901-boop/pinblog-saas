/**
 * Phase 3.6 — PayPal verified webhook fulfillment tests.
 * Run: node --test src/services/billing/paypal-webhook-fulfillment.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PayPalApiError, encodePayPalCustomId } from './providers/paypal.js';
import {
	classifyPayPalWebhookEvent,
	extractPayPalWebhookContext,
} from './providers/paypal-webhook-helpers.js';
import { handlePayPalBillingWebhook } from './paypal-webhook-fulfillment.js';
import { sanitizeWebhookPayloadForStorage } from './webhook-event-status.js';

const customId = encodePayPalCustomId('ws-demo', 'pro');

function buildPayPalHeaders() {
	return {
		'paypal-transmission-id': 'tx-test',
		'paypal-transmission-time': '2026-01-01T00:00:00Z',
		'paypal-transmission-sig': 'sig',
		'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
		'paypal-auth-algo': 'SHA256withRSA',
	};
}

function buildActivationBody(eventId = 'WH-ACTIVATE-1') {
	return {
		id: eventId,
		event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
		resource: {
			id: 'I-SUB-DEMO',
			custom_id: customId,
		},
	};
}

describe('PayPal webhook event taxonomy', () => {
	it('routes ACTIVATED to subscription_activation', () => {
		assert.equal(classifyPayPalWebhookEvent('BILLING.SUBSCRIPTION.ACTIVATED').routing, 'subscription_activation');
	});

	it('routes SALE.COMPLETED to subscription_renewal', () => {
		assert.equal(classifyPayPalWebhookEvent('PAYMENT.SALE.COMPLETED').routing, 'subscription_renewal');
	});

	it('ignores SUBSCRIPTION.CREATED without entitlement (Test 19)', () => {
		const result = classifyPayPalWebhookEvent('BILLING.SUBSCRIPTION.CREATED');
		assert.equal(result.routing, 'ignored');
	});

	it('routes payment failure events', () => {
		assert.equal(classifyPayPalWebhookEvent('BILLING.SUBSCRIPTION.PAYMENT.FAILED').routing, 'payment_failed');
	});

	it('routes cancellation events (Test 17 taxonomy)', () => {
		assert.equal(classifyPayPalWebhookEvent('BILLING.SUBSCRIPTION.CANCELLED').routing, 'cancel');
	});
});

describe('extractPayPalWebhookContext', () => {
	it('extracts workspace and subscription identity from resource', () => {
		const context = extractPayPalWebhookContext(buildActivationBody());
		assert.equal(context.workspaceKey, 'ws-demo');
		assert.equal(context.planSlug, 'pro');
		assert.equal(context.subscriptionId, 'I-SUB-DEMO');
	});
});

describe('handlePayPalBillingWebhook fail-closed handler', () => {
	it('rejects invalid signature without entitlement mutation (Test 2)', async () => {
		const provider = {
			verifyWebhook: async () => ({ ok: false, error: 'paypal_webhook_signature_invalid' }),
			parseWebhook: async () => ({}),
		};

		await assert.rejects(
			() => handlePayPalBillingWebhook(
				{ headers: buildPayPalHeaders(), body: buildActivationBody() },
				{ deps: { provider, billingConfig: { providers: { paypal: {} } } } },
			),
			(err) => err.status === 401 && err.errorCode === 'WEBHOOK_UNAUTHORIZED',
		);
	});

	it('marks API 404 as failed without grant (Test 3)', async () => {
		const updates = [];
		const provider = {
			verifyWebhook: async () => ({ ok: true }),
			parseWebhook: async () => ({
				idempotencyKey: 'WH-404',
				eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
				payload: buildActivationBody('WH-404'),
			}),
			retrieveSubscription: async () => {
				throw new PayPalApiError('Not found', { status: 404, code: 'paypal_not_found' });
			},
		};

		const result = await handlePayPalBillingWebhook(
			{ headers: buildPayPalHeaders(), body: buildActivationBody('WH-404') },
			{
				deps: {
					provider,
					billingConfig: { providers: { paypal: { planIds: { pro: 'P-PLAN-PRO' } } } },
					findWebhookEvent: async () => null,
					createWebhookEvent: async (row) => ({ id: 'evt-1', ...row }),
					updateWebhookEvent: async (_id, patch) => { updates.push(patch); return patch; },
					loadPlanRecord: async () => ({ id: 'plan_pro', slug: 'pro', billing_type: 'paid' }),
					workspaceExists: async () => true,
					loadSubscriptionByWorkspace: async () => null,
				},
			},
		);

		assert.equal(result.result.blocked, true);
		assert.equal(result.result.activated, false);
		assert.equal(updates.some((patch) => patch.status === 'failed'), true);
	});

	it('marks API 401/403 as failed without grant (Test 4)', async () => {
		const updates = [];
		const provider = {
			verifyWebhook: async () => ({ ok: true }),
			parseWebhook: async () => ({
				idempotencyKey: 'WH-401',
				eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
				payload: buildActivationBody('WH-401'),
			}),
			retrieveSubscription: async () => {
				throw new PayPalApiError('Unauthorized', { status: 401, code: 'paypal_auth_failed' });
			},
		};

		const result = await handlePayPalBillingWebhook(
			{ headers: buildPayPalHeaders(), body: buildActivationBody('WH-401') },
			{
				deps: {
					provider,
					billingConfig: { providers: { paypal: { planIds: { pro: 'P-PLAN-PRO' } } } },
					findWebhookEvent: async () => null,
					createWebhookEvent: async (row) => ({ id: 'evt-2', ...row }),
					updateWebhookEvent: async (_id, patch) => { updates.push(patch); return patch; },
				},
			},
		);

		assert.equal(result.result.reason, 'paypal_auth_failed');
		assert.equal(updates.at(-1)?.status, 'failed');
	});

	it('marks API 5xx as failed and retryable (Test 5)', async () => {
		const provider = {
			verifyWebhook: async () => ({ ok: true }),
			parseWebhook: async () => ({
				idempotencyKey: 'WH-500',
				eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
				payload: buildActivationBody('WH-500'),
			}),
			retrieveSubscription: async () => {
				throw new PayPalApiError('Server error', { status: 503, code: 'paypal_server_error', isServerError: true });
			},
		};

		const result = await handlePayPalBillingWebhook(
			{ headers: buildPayPalHeaders(), body: buildActivationBody('WH-500') },
			{
				deps: {
					provider,
					billingConfig: { providers: { paypal: {} } },
					findWebhookEvent: async () => null,
					createWebhookEvent: async (row) => ({ id: 'evt-3', ...row }),
					updateWebhookEvent: async () => null,
				},
			},
		);

		assert.equal(result.result.retryable, true);
		assert.equal(result.result.blocked, true);
	});

	it('marks API timeout as failed and retryable (Test 6)', async () => {
		const provider = {
			verifyWebhook: async () => ({ ok: true }),
			parseWebhook: async () => ({
				idempotencyKey: 'WH-TIMEOUT',
				eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
				payload: buildActivationBody('WH-TIMEOUT'),
			}),
			retrieveSubscription: async () => {
				throw new PayPalApiError('PayPal API request timed out', {
					status: 504,
					code: 'paypal_api_timeout',
					isTimeout: true,
				});
			},
		};

		const result = await handlePayPalBillingWebhook(
			{ headers: buildPayPalHeaders(), body: buildActivationBody('WH-TIMEOUT') },
			{
				deps: {
					provider,
					billingConfig: { providers: { paypal: {} } },
					findWebhookEvent: async () => null,
					createWebhookEvent: async (row) => ({ id: 'evt-4', ...row }),
					updateWebhookEvent: async () => null,
				},
			},
		);

		assert.equal(result.result.retryable, true);
		assert.equal(result.result.reason, 'paypal_api_timeout');
	});

	it('fulfills after valid signature and API verification (Test 1, 15)', async () => {
		let activated = false;
		const updates = [];
		const provider = {
			verifyWebhook: async () => ({ ok: true }),
			parseWebhook: async () => ({
				idempotencyKey: 'WH-OK',
				eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
				payload: buildActivationBody('WH-OK'),
			}),
			retrieveSubscription: async () => ({
				subscriptionId: 'I-SUB-DEMO',
				status: 'ACTIVE',
				customId,
				planId: 'P-PLAN-PRO',
			}),
		};

		const result = await handlePayPalBillingWebhook(
			{ headers: buildPayPalHeaders(), body: buildActivationBody('WH-OK') },
			{
				deps: {
					provider,
					billingConfig: { providers: { paypal: { planIds: { pro: 'P-PLAN-PRO' } } } },
					findWebhookEvent: async () => null,
					createWebhookEvent: async (row) => ({ id: 'evt-5', ...row }),
					updateWebhookEvent: async (_id, patch) => { updates.push(patch); return patch; },
					loadPlanRecord: async () => ({ id: 'plan_pro', slug: 'pro', billing_type: 'paid', credits: 500 }),
					workspaceExists: async () => true,
					loadSubscriptionByWorkspace: async () => null,
					activatePayPalSubscription: async () => {
						activated = true;
						return { activated: true, fulfilled: true, toPlan: 'pro' };
					},
					logBillingAction: async () => {},
				},
			},
		);

		assert.equal(activated, true);
		assert.equal(result.result.verified, true);
		assert.equal(updates.some((patch) => patch.status === 'processed'), true);
	});

	it('returns duplicate for terminal webhook replay (Test 13)', async () => {
		const provider = {
			verifyWebhook: async () => ({ ok: true }),
			parseWebhook: async () => ({
				idempotencyKey: 'WH-DUP',
				eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
				payload: buildActivationBody('WH-DUP'),
			}),
		};

		const result = await handlePayPalBillingWebhook(
			{ headers: buildPayPalHeaders(), body: buildActivationBody('WH-DUP') },
			{
				deps: {
					provider,
					billingConfig: { providers: { paypal: {} } },
					findWebhookEvent: async () => ({ id: 'existing', status: 'processed' }),
					createWebhookEvent: async (row) => ({ id: 'evt-dup', ...row }),
					updateWebhookEvent: async () => null,
				},
			},
		);

		assert.equal(result.duplicate, true);
	});

	it('ignores unsupported events without grant (Test 19)', async () => {
		const updates = [];
		const provider = {
			verifyWebhook: async () => ({ ok: true }),
			parseWebhook: async () => ({
				idempotencyKey: 'WH-UNKNOWN',
				eventType: 'CUSTOMER.DISPUTE.CREATED',
				payload: { event_type: 'CUSTOMER.DISPUTE.CREATED', resource: {} },
			}),
		};

		const result = await handlePayPalBillingWebhook(
			{ headers: buildPayPalHeaders(), body: { id: 'WH-UNKNOWN', event_type: 'CUSTOMER.DISPUTE.CREATED' } },
			{
				deps: {
					provider,
					billingConfig: { providers: { paypal: {} } },
					findWebhookEvent: async () => null,
					createWebhookEvent: async (row) => ({ id: 'evt-6', ...row }),
					updateWebhookEvent: async (_id, patch) => { updates.push(patch); return patch; },
				},
			},
		);

		assert.equal(result.result.ignored, true);
		assert.equal(result.result.activated, false);
		assert.equal(updates.some((patch) => patch.status === 'ignored'), true);
	});

	it('processes payment failure without activation (Test 18)', async () => {
		let failureHandled = false;
		const provider = {
			verifyWebhook: async () => ({ ok: true }),
			parseWebhook: async () => ({
				idempotencyKey: 'WH-FAIL',
				eventType: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
				payload: {
					id: 'WH-FAIL',
					event_type: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
					resource: { id: 'I-SUB-DEMO', custom_id: customId },
				},
			}),
		};

		const result = await handlePayPalBillingWebhook(
			{ headers: buildPayPalHeaders(), body: { id: 'WH-FAIL', event_type: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' } },
			{
				deps: {
					provider,
					billingConfig: { providers: { paypal: {} } },
					findWebhookEvent: async () => null,
					createWebhookEvent: async (row) => ({ id: 'evt-7', ...row }),
					updateWebhookEvent: async () => null,
					handlePayPalPaymentFailure: async () => {
						failureHandled = true;
						return { handled: true, activated: false, kind: 'payment_failed' };
					},
				},
			},
		);

		assert.equal(failureHandled, true);
		assert.equal(result.result.activated, false);
	});

	it('sanitizes webhook payload before persistence (Test 22)', () => {
		const sanitized = sanitizeWebhookPayloadForStorage({
			event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
			resource: { id: 'I-SUB', custom_id: customId },
			authorization: 'Bearer secret-token',
			nested: { api_key: 'abc123' },
		});
		assert.equal(sanitized.authorization, '[REDACTED]');
		assert.equal(sanitized.nested.api_key, '[REDACTED]');
		assert.equal(sanitized.resource.id, 'I-SUB');
	});
});
