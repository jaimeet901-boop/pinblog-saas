/**
 * Phase 4.3-B — Paddle remote cancel-at-period-end tests.
 * Run: node --test src/services/billing/providers/paddle-cancel.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PaddleBillingProvider } from './paddle.js';
import {
	cancelPaddleSubscriptionAtPeriodEnd,
	verifyPaddleCancelAtPeriodEndResponse,
	PaddleApiError,
} from './paddle-api-client.js';

const sandboxConfig = { apiKey: 'test_api_key', sandbox: true };

function cancelSuccessPayload(subscriptionId = 'sub_paddle_1') {
	return {
		id: subscriptionId,
		status: 'active',
		scheduled_change: {
			action: 'cancel',
			effective_at: '2026-09-08T10:00:00.000Z',
			resume_at: null,
		},
	};
}

function mockFetchStatus(status, body = {}, { rejectWith } = {}) {
	return async (url, options = {}) => {
		if (rejectWith) throw rejectWith;
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
		};
	};
}

function captureCancelFetch(status = 200, body = cancelSuccessPayload()) {
	let captured = { url: '', options: null };
	const fetchImpl = async (url, options = {}) => {
		captured = { url, options };
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => ({ data: body }),
		};
	};
	return { fetchImpl, captured: () => captured };
}

describe('cancelPaddleSubscriptionAtPeriodEnd (API client)', () => {
	it('POST /subscriptions/{id}/cancel with next_billing_period', async () => {
		const { fetchImpl, captured } = captureCancelFetch();
		const result = await cancelPaddleSubscriptionAtPeriodEnd('sub_paddle_1', {
			environment: 'sandbox',
			config: sandboxConfig,
			fetchImpl,
		});
		const req = captured();
		assert.equal(req.url, 'https://sandbox-api.paddle.com/subscriptions/sub_paddle_1/cancel');
		assert.equal(req.options.method, 'POST');
		assert.match(req.options.headers.Authorization, /^Bearer test_api_key$/);
		assert.deepEqual(JSON.parse(req.options.body), { effective_from: 'next_billing_period' });
		assert.equal(result.scheduled_change.action, 'cancel');
	});

	it('requires subscription id', async () => {
		await assert.rejects(
			() => cancelPaddleSubscriptionAtPeriodEnd('', { environment: 'sandbox', config: sandboxConfig }),
			(err) => err instanceof PaddleApiError && err.code === 'paddle_subscription_id_missing',
		);
	});

	it('POST /subscriptions/{id}/cancel with immediately', async () => {
		const { fetchImpl, captured } = captureCancelFetch(200, {
			id: 'sub_paddle_1',
			status: 'canceled',
			scheduled_change: null,
		});
		const result = await cancelPaddleSubscriptionAtPeriodEnd('sub_paddle_1', {
			environment: 'sandbox',
			config: sandboxConfig,
			fetchImpl,
			effectiveFrom: 'immediately',
		});
		const req = captured();
		assert.deepEqual(JSON.parse(req.options.body), { effective_from: 'immediately' });
		assert.equal(result.status, 'canceled');
	});

	it('rejects unsupported effective_from values', async () => {
		await assert.rejects(
			() => cancelPaddleSubscriptionAtPeriodEnd('sub_1', {
				environment: 'sandbox',
				config: sandboxConfig,
				effectiveFrom: 'yesterday',
			}),
			(err) => err instanceof PaddleApiError && err.code === 'paddle_cancel_effective_from_unsupported',
		);
	});

	for (const status of [400, 401, 403, 404, 409, 429, 500]) {
		it(`fails on Paddle HTTP ${status}`, async () => {
			await assert.rejects(
				() => cancelPaddleSubscriptionAtPeriodEnd('sub_paddle_1', {
					environment: 'sandbox',
					config: sandboxConfig,
					fetchImpl: mockFetchStatus(status, { error: { detail: 'fail', code: 'err' } }),
				}),
				(err) => err instanceof PaddleApiError && err.status === status,
			);
		});
	}

	it('fails on network error', async () => {
		await assert.rejects(
			() => cancelPaddleSubscriptionAtPeriodEnd('sub_paddle_1', {
				environment: 'sandbox',
				config: sandboxConfig,
				fetchImpl: mockFetchStatus(200, {}, { rejectWith: new Error('network down') }),
			}),
			(err) => err instanceof PaddleApiError,
		);
	});

	it('fails on timeout', async () => {
		const abortError = new Error('aborted');
		abortError.name = 'AbortError';
		await assert.rejects(
			() => cancelPaddleSubscriptionAtPeriodEnd('sub_paddle_1', {
				environment: 'sandbox',
				config: sandboxConfig,
				fetchImpl: mockFetchStatus(200, {}, { rejectWith: abortError }),
			}),
			(err) => err instanceof PaddleApiError && err.isTimeout,
		);
	});
});

describe('verifyPaddleCancelAtPeriodEndResponse', () => {
	it('accepts active subscription with scheduled cancel', () => {
		const result = verifyPaddleCancelAtPeriodEndResponse(cancelSuccessPayload());
		assert.equal(result.ok, true);
		assert.equal(result.effectiveAt, '2026-09-08T10:00:00.000Z');
	});

	it('rejects missing scheduled_change (malformed response)', () => {
		assert.equal(verifyPaddleCancelAtPeriodEndResponse({ status: 'active' }).ok, false);
	});

	it('rejects immediately canceled subscription', () => {
		const result = verifyPaddleCancelAtPeriodEndResponse({
			id: 'sub_1',
			status: 'canceled',
			scheduled_change: { action: 'cancel', effective_at: '2026-09-08T10:00:00.000Z' },
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'paddle_subscription_immediately_canceled');
	});
});

describe('PaddleBillingProvider.cancelSubscription (Phase 4.3-B)', () => {
	it('returns cancelled:true on successful cancel-at-period-end', async () => {
		const { fetchImpl } = captureCancelFetch();
		const provider = new PaddleBillingProvider(sandboxConfig);
		const result = await provider.cancelSubscription({
			providerSubscriptionId: 'sub_paddle_1',
			atPeriodEnd: true,
			fetchImpl,
		});
		assert.equal(result.cancelled, true);
		assert.equal(result.localOnly, false);
		assert.equal(result.provider, 'paddle');
		assert.equal(result.subscriptionId, 'sub_paddle_1');
	});

	it('uses providerSubscriptionId from input', async () => {
		const { fetchImpl, captured } = captureCancelFetch();
		const provider = new PaddleBillingProvider(sandboxConfig);
		await provider.cancelSubscription({
			providerSubscriptionId: 'sub_from_input',
			fetchImpl,
		});
		assert.match(captured().url, /\/subscriptions\/sub_from_input\/cancel$/);
	});

	it('throws when provider not ready', async () => {
		const provider = new PaddleBillingProvider({});
		await assert.rejects(
			() => provider.cancelSubscription({ providerSubscriptionId: 'sub_1' }),
			(err) => err.code === 'PROVIDER_NOT_IMPLEMENTED',
		);
	});

	it('throws when subscription id missing', async () => {
		const provider = new PaddleBillingProvider(sandboxConfig);
		await assert.rejects(
			() => provider.cancelSubscription({ atPeriodEnd: true }),
			(err) => err.errorCode === 'PADDLE_SUBSCRIPTION_ID_MISSING',
		);
	});

	it('atPeriodEnd=false is explicitly unsupported', async () => {
		const provider = new PaddleBillingProvider(sandboxConfig);
		await assert.rejects(
			() => provider.cancelSubscription({
				providerSubscriptionId: 'sub_1',
				atPeriodEnd: false,
			}),
			(err) => err.errorCode === 'PADDLE_IMMEDIATE_CANCEL_UNSUPPORTED',
		);
	});

	it('throws on invalid Paddle response (malformed success)', async () => {
		const fetchImpl = mockFetchStatus(200, { data: { id: 'sub_1', status: 'active' } });
		const provider = new PaddleBillingProvider(sandboxConfig);
		await assert.rejects(
			() => provider.cancelSubscription({
				providerSubscriptionId: 'sub_1',
				fetchImpl,
			}),
			(err) => err.errorCode === 'PADDLE_CANCEL_RESPONSE_INVALID',
		);
	});

	it('propagates Paddle API errors without swallowing', async () => {
		const provider = new PaddleBillingProvider(sandboxConfig);
		await assert.rejects(
			() => provider.cancelSubscription({
				providerSubscriptionId: 'sub_1',
				fetchImpl: mockFetchStatus(404, { error: { detail: 'missing' } }),
			}),
			(err) => err instanceof PaddleApiError && err.isNotFound,
		);
	});
});
