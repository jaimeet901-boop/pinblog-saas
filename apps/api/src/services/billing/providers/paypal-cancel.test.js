/**
 * Phase 4.3-C — PayPal remote cancellation tests.
 * Run: node --test src/services/billing/providers/paypal-cancel.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	PayPalBillingProvider,
	PayPalApiError,
	suspendPayPalSubscription,
	cancelPayPalSubscriptionImmediate,
	verifyPayPalPeriodEndCancellationResponse,
	verifyPayPalImmediateCancellationResponse,
} from './paypal.js';

const providerConfig = {
	clientId: 'client_test',
	clientSecret: 'secret_test',
	mode: 'sandbox',
};

function mockFetchStatus(status, body = {}, { rejectWith } = {}) {
	return async (url, options = {}) => {
		if (rejectWith) throw rejectWith;
		if (String(url).endsWith('/v1/oauth2/token')) {
			return {
				ok: true,
				status: 200,
				json: async () => ({ access_token: 'token_abc' }),
			};
		}
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
		};
	};
}

function createPayPalCancelFetchImpl({
	subscriptionId = 'I-PAYPAL-1',
	initialStatus = 'ACTIVE',
	afterActionStatus = 'SUSPENDED',
	action = 'suspend',
	actionStatus = 204,
} = {}) {
	let getCount = 0;
	const captured = { suspend: null, cancel: null, gets: [] };
	const fetchImpl = async (url, options = {}) => {
		const u = String(url);
		if (u.endsWith('/v1/oauth2/token')) {
			return {
				ok: true,
				status: 200,
				json: async () => ({ access_token: 'token_abc' }),
			};
		}
		const subPath = `/v1/billing/subscriptions/${subscriptionId}`;
		if (u.includes(subPath)) {
			if (u.endsWith('/suspend')) {
				captured.suspend = { url: u, options };
				return {
					ok: actionStatus >= 200 && actionStatus < 300,
					status: actionStatus,
					json: async () => ({}),
				};
			}
			if (u.endsWith('/cancel')) {
				captured.cancel = { url: u, options };
				return {
					ok: actionStatus >= 200 && actionStatus < 300,
					status: actionStatus,
					json: async () => ({}),
				};
			}
			if (options.method === 'GET' || !options.method) {
				getCount += 1;
				const status = getCount === 1 ? initialStatus : afterActionStatus;
				captured.gets.push({ count: getCount, status });
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: subscriptionId, status }),
				};
			}
		}
		throw new Error(`Unexpected fetch: ${url}`);
	};
	return { fetchImpl, captured: () => captured };
}

describe('suspendPayPalSubscription / cancelPayPalSubscriptionImmediate (API)', () => {
	it('POST /suspend with reason for period-end cancellation', async () => {
		const { fetchImpl, captured } = createPayPalCancelFetchImpl({ action: 'suspend' });
		await suspendPayPalSubscription('I-PAYPAL-1', {
			apiBase: 'https://api-m.sandbox.paypal.com',
			accessToken: 'token_abc',
			reason: 'Customer requested cancellation',
			fetchImpl,
		});
		const req = captured().suspend;
		assert.match(req.url, /\/subscriptions\/I-PAYPAL-1\/suspend$/);
		assert.equal(req.options.method, 'POST');
		assert.equal(JSON.parse(req.options.body).reason, 'Customer requested cancellation');
	});

	it('POST /cancel with reason for immediate cancellation', async () => {
		const { fetchImpl, captured } = createPayPalCancelFetchImpl({ action: 'cancel' });
		await cancelPayPalSubscriptionImmediate('I-PAYPAL-1', {
			apiBase: 'https://api-m.sandbox.paypal.com',
			accessToken: 'token_abc',
			reason: 'Immediate cancel',
			fetchImpl,
		});
		const req = captured().cancel;
		assert.match(req.url, /\/subscriptions\/I-PAYPAL-1\/cancel$/);
		assert.equal(JSON.parse(req.options.body).reason, 'Immediate cancel');
	});

	it('requires subscription id', async () => {
		await assert.rejects(
			() => suspendPayPalSubscription('', {
				apiBase: 'https://api-m.sandbox.paypal.com',
				accessToken: 'token_abc',
			}),
			(err) => err instanceof PayPalApiError && err.code === 'paypal_subscription_id_missing',
		);
	});

	for (const status of [400, 401, 403, 404, 409, 422, 429, 500]) {
		it(`fails on PayPal HTTP ${status} for suspend`, async () => {
			await assert.rejects(
				() => suspendPayPalSubscription('I-PAYPAL-1', {
					apiBase: 'https://api-m.sandbox.paypal.com',
					accessToken: 'token_abc',
					fetchImpl: mockFetchStatus(status, { message: 'fail' }),
				}),
				(err) => err instanceof PayPalApiError && err.status === status,
			);
		});
	}

	it('fails on network error', async () => {
		await assert.rejects(
			() => suspendPayPalSubscription('I-PAYPAL-1', {
				apiBase: 'https://api-m.sandbox.paypal.com',
				accessToken: 'token_abc',
				fetchImpl: mockFetchStatus(204, {}, { rejectWith: new Error('network down') }),
			}),
			(err) => err instanceof PayPalApiError === false && err.message === 'network down',
		);
	});

	it('fails on timeout', async () => {
		const abortError = new Error('aborted');
		abortError.name = 'AbortError';
		await assert.rejects(
			() => suspendPayPalSubscription('I-PAYPAL-1', {
				apiBase: 'https://api-m.sandbox.paypal.com',
				accessToken: 'token_abc',
				fetchImpl: mockFetchStatus(204, {}, { rejectWith: abortError }),
			}),
			(err) => err instanceof PayPalApiError && err.isTimeout,
		);
	});
});

describe('verifyPayPalPeriodEndCancellationResponse', () => {
	it('accepts SUSPENDED status', () => {
		const result = verifyPayPalPeriodEndCancellationResponse({ status: 'SUSPENDED', subscriptionId: 'I-1' });
		assert.equal(result.ok, true);
	});

	it('rejects CANCELLED (immediate) status', () => {
		const result = verifyPayPalPeriodEndCancellationResponse({ status: 'CANCELLED' });
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paypal_subscription_immediately_canceled');
	});

	it('rejects missing status (malformed response)', () => {
		assert.equal(verifyPayPalPeriodEndCancellationResponse({}).ok, false);
	});
});

describe('verifyPayPalImmediateCancellationResponse', () => {
	it('accepts CANCELLED status', () => {
		assert.equal(verifyPayPalImmediateCancellationResponse({ status: 'CANCELLED' }).ok, true);
	});

	it('rejects SUSPENDED status', () => {
		const result = verifyPayPalImmediateCancellationResponse({ status: 'SUSPENDED' });
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paypal_subscription_still_suspended');
	});
});

describe('PayPalBillingProvider.cancelSubscription (Phase 4.3-C)', () => {
	it('returns cancelled:true on successful period-end suspend', async () => {
		const { fetchImpl } = createPayPalCancelFetchImpl({
			initialStatus: 'ACTIVE',
			afterActionStatus: 'SUSPENDED',
		});
		const provider = new PayPalBillingProvider(providerConfig);
		const result = await provider.cancelSubscription({
			providerSubscriptionId: 'I-PAYPAL-1',
			atPeriodEnd: true,
			fetchImpl,
		});
		assert.equal(result.cancelled, true);
		assert.equal(result.localOnly, false);
		assert.equal(result.provider, 'paypal');
		assert.equal(result.atPeriodEnd, true);
	});

	it('uses suspend (not cancel) for atPeriodEnd=true', async () => {
		const { fetchImpl, captured } = createPayPalCancelFetchImpl();
		const provider = new PayPalBillingProvider(providerConfig);
		await provider.cancelSubscription({
			providerSubscriptionId: 'I-PAYPAL-1',
			atPeriodEnd: true,
			fetchImpl,
		});
		assert.ok(captured().suspend);
		assert.equal(captured().cancel, null);
	});

	it('uses cancel endpoint for atPeriodEnd=false (immediate)', async () => {
		const { fetchImpl, captured } = createPayPalCancelFetchImpl({
			initialStatus: 'ACTIVE',
			afterActionStatus: 'CANCELLED',
			action: 'cancel',
		});
		const provider = new PayPalBillingProvider(providerConfig);
		const result = await provider.cancelSubscription({
			providerSubscriptionId: 'I-PAYPAL-1',
			atPeriodEnd: false,
			fetchImpl,
		});
		assert.ok(captured().cancel);
		assert.equal(captured().suspend, null);
		assert.equal(result.atPeriodEnd, false);
	});

	it('throws when provider not ready', async () => {
		const provider = new PayPalBillingProvider({});
		await assert.rejects(
			() => provider.cancelSubscription({ providerSubscriptionId: 'I-1' }),
			(err) => err.code === 'PROVIDER_NOT_IMPLEMENTED',
		);
	});

	it('throws when subscription id missing', async () => {
		const provider = new PayPalBillingProvider(providerConfig);
		await assert.rejects(
			() => provider.cancelSubscription({ atPeriodEnd: true }),
			(err) => err.errorCode === 'PAYPAL_SUBSCRIPTION_ID_MISSING',
		);
	});

	it('atPeriodEnd=true on already CANCELLED subscription fails closed', async () => {
		const { fetchImpl } = createPayPalCancelFetchImpl({
			initialStatus: 'CANCELLED',
			afterActionStatus: 'CANCELLED',
		});
		const provider = new PayPalBillingProvider(providerConfig);
		await assert.rejects(
			() => provider.cancelSubscription({
				providerSubscriptionId: 'I-PAYPAL-1',
				atPeriodEnd: true,
				fetchImpl,
			}),
			(err) => err.errorCode === 'PAYPAL_PERIOD_END_CANCEL_UNSUPPORTED',
		);
	});

	it('already SUSPENDED is idempotent for atPeriodEnd=true', async () => {
		const { fetchImpl, captured } = createPayPalCancelFetchImpl({
			initialStatus: 'SUSPENDED',
		});
		const provider = new PayPalBillingProvider(providerConfig);
		const result = await provider.cancelSubscription({
			providerSubscriptionId: 'I-PAYPAL-1',
			atPeriodEnd: true,
			fetchImpl,
		});
		assert.equal(result.cancelled, true);
		assert.equal(result.alreadyScheduled, true);
		assert.equal(captured().suspend, null);
	});

	it('already CANCELLED is idempotent for atPeriodEnd=false', async () => {
		const { fetchImpl, captured } = createPayPalCancelFetchImpl({
			initialStatus: 'CANCELLED',
		});
		const provider = new PayPalBillingProvider(providerConfig);
		const result = await provider.cancelSubscription({
			providerSubscriptionId: 'I-PAYPAL-1',
			atPeriodEnd: false,
			fetchImpl,
		});
		assert.equal(result.cancelled, true);
		assert.equal(result.alreadyCancelled, true);
		assert.equal(captured().cancel, null);
	});

	it('throws on invalid post-suspend response (malformed success)', async () => {
		const { fetchImpl } = createPayPalCancelFetchImpl({
			initialStatus: 'ACTIVE',
			afterActionStatus: 'ACTIVE',
		});
		const provider = new PayPalBillingProvider(providerConfig);
		await assert.rejects(
			() => provider.cancelSubscription({
				providerSubscriptionId: 'I-PAYPAL-1',
				atPeriodEnd: true,
				fetchImpl,
			}),
			(err) => err.errorCode === 'PAYPAL_CANCEL_RESPONSE_INVALID',
		);
	});

	it('propagates PayPal API errors without swallowing', async () => {
		const { fetchImpl } = createPayPalCancelFetchImpl({
			actionStatus: 404,
		});
		const provider = new PayPalBillingProvider(providerConfig);
		await assert.rejects(
			() => provider.cancelSubscription({
				providerSubscriptionId: 'I-PAYPAL-1',
				atPeriodEnd: true,
				fetchImpl,
			}),
			(err) => err instanceof PayPalApiError && err.status === 404,
		);
	});

	it('never returns cancelled:true on API failure', async () => {
		const provider = new PayPalBillingProvider(providerConfig);
		const fetchImpl = mockFetchStatus(500, { message: 'server error' });
		await assert.rejects(
			() => provider.cancelSubscription({
				providerSubscriptionId: 'I-PAYPAL-1',
				atPeriodEnd: true,
				fetchImpl,
			}),
		);
	});
});
