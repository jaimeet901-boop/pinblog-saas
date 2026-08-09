/**
 * Paddle API client tests — HTTP boundary mocks only.
 * Run: node --test src/services/billing/providers/paddle-api-client.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	getPaddleSubscription,
	getPaddleTransaction,
	paddleApiRequest,
	PaddleApiError,
} from './paddle-api-client.js';

const sandboxConfig = { apiKey: 'test_api_key', sandbox: true };

function mockFetch(responseStatus, body, { rejectWith } = {}) {
	return async (url, options = {}) => {
		if (rejectWith) throw rejectWith;
		return {
			ok: responseStatus >= 200 && responseStatus < 300,
			status: responseStatus,
			json: async () => body,
		};
	};
}

describe('paddleApiRequest', () => {
	it('GET /transactions/{id} uses sandbox base URL', async () => {
		let capturedUrl = '';
		const fetchImpl = async (url, options) => {
			capturedUrl = url;
			assert.equal(options.method, 'GET');
			assert.match(options.headers.Authorization, /^Bearer test_api_key$/);
			return { ok: true, status: 200, json: async () => ({ data: { id: 'txn_1', status: 'completed' } }) };
		};

		const data = await paddleApiRequest({
			method: 'GET',
			path: '/transactions/txn_1',
			environment: 'sandbox',
			config: sandboxConfig,
			fetchImpl,
		});
		assert.equal(capturedUrl, 'https://sandbox-api.paddle.com/transactions/txn_1');
		assert.equal(data.id, 'txn_1');
	});

	it('GET /subscriptions/{id} uses live base URL', async () => {
		let capturedUrl = '';
		const fetchImpl = async (url) => {
			capturedUrl = url;
			return { ok: true, status: 200, json: async () => ({ data: { id: 'sub_1', status: 'active' } }) };
		};

		await paddleApiRequest({
			method: 'GET',
			path: '/subscriptions/sub_1',
			environment: 'live',
			config: { apiKey: 'live_key' },
			fetchImpl,
		});
		assert.equal(capturedUrl, 'https://api.paddle.com/subscriptions/sub_1');
	});

	it('throws PaddleApiError on 404', async () => {
		await assert.rejects(
			() => getPaddleTransaction('txn_missing', {
				environment: 'sandbox',
				config: sandboxConfig,
				fetchImpl: mockFetch(404, { error: { detail: 'not found', code: 'not_found' } }),
			}),
			(err) => err instanceof PaddleApiError && err.isNotFound,
		);
	});

	it('throws PaddleApiError on 500', async () => {
		await assert.rejects(
			() => getPaddleTransaction('txn_err', {
				environment: 'sandbox',
				config: sandboxConfig,
				fetchImpl: mockFetch(500, { error: { detail: 'server error' } }),
			}),
			(err) => err instanceof PaddleApiError && err.isServerError,
		);
	});

	it('throws timeout error on abort', async () => {
		const abortError = new Error('aborted');
		abortError.name = 'AbortError';
		await assert.rejects(
			() => getPaddleTransaction('txn_timeout', {
				environment: 'sandbox',
				config: sandboxConfig,
				fetchImpl: mockFetch(200, {}, { rejectWith: abortError }),
			}),
			(err) => err instanceof PaddleApiError && err.isTimeout,
		);
	});

	it('getPaddleSubscription requires subscription id', async () => {
		await assert.rejects(
			() => getPaddleSubscription('', { environment: 'sandbox', config: sandboxConfig }),
			(err) => err instanceof PaddleApiError,
		);
	});
});
