/**
 * Phase 2 — Paddle.js Default Payment Link helper.
 * Run: npm test --prefix apps/web -- src/lib/__tests__/paddleCheckout.test.js
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	maybeOpenPaddleCheckoutFromUrl,
	readPaddleJsEnvironment,
	readPaddleTransactionId,
	resetPaddleCheckoutGuards,
} from '../paddleCheckout.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const helperSource = readFileSync(path.resolve(here, '../paddleCheckout.js'), 'utf8');
const pageSource = readFileSync(
	path.resolve(here, '../../pages/app/SubscriptionPage.jsx'),
	'utf8',
);
const planCardsSource = readFileSync(
	path.resolve(here, '../subscriptionPlanCards.js'),
	'utf8',
);

function createPaddleMock() {
	const calls = {
		initialize: [],
		open: [],
	};
	const paddle = {
		Checkout: {
			open(payload) {
				calls.open.push(payload);
			},
		},
	};
	async function initializePaddle(config) {
		calls.initialize.push(config);
		return paddle;
	}
	return { calls, initializePaddle };
}

describe('readPaddleJsEnvironment', () => {
	it('defaults to sandbox for empty or unknown values', () => {
		assert.equal(readPaddleJsEnvironment({}), 'sandbox');
		assert.equal(readPaddleJsEnvironment({ VITE_PADDLE_ENVIRONMENT: '' }), 'sandbox');
		assert.equal(readPaddleJsEnvironment({ VITE_PADDLE_ENVIRONMENT: 'sandbox' }), 'sandbox');
		assert.equal(readPaddleJsEnvironment({ VITE_PADDLE_ENVIRONMENT: 'Staging' }), 'sandbox');
	});

	it('maps production and live to production', () => {
		assert.equal(readPaddleJsEnvironment({ VITE_PADDLE_ENVIRONMENT: 'production' }), 'production');
		assert.equal(readPaddleJsEnvironment({ VITE_PADDLE_ENVIRONMENT: 'live' }), 'production');
		assert.equal(readPaddleJsEnvironment({ VITE_PADDLE_ENVIRONMENT: 'LIVE' }), 'production');
	});
});

describe('readPaddleTransactionId', () => {
	it('returns empty when _ptxn is absent', () => {
		assert.equal(readPaddleTransactionId(''), '');
		assert.equal(readPaddleTransactionId('?checkout=success'), '');
		assert.equal(readPaddleTransactionId('https://seodeva.com/app/subscription'), '');
	});

	it('reads _ptxn from a query string or full URL', () => {
		assert.equal(readPaddleTransactionId('?_ptxn=txn_01abc'), 'txn_01abc');
		assert.equal(
			readPaddleTransactionId('https://seodeva.com/app/subscription?_ptxn=txn_01abc&checkout=success'),
			'txn_01abc',
		);
	});
});

describe('maybeOpenPaddleCheckoutFromUrl', () => {
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;

	beforeEach(() => {
		resetPaddleCheckoutGuards();
		fetchCalls = 0;
		globalThis.fetch = async () => {
			fetchCalls += 1;
			return { ok: true, json: async () => ({}) };
		};
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		resetPaddleCheckoutGuards();
	});

	it('does nothing when _ptxn is absent', async () => {
		const { calls, initializePaddle } = createPaddleMock();
		const result = await maybeOpenPaddleCheckoutFromUrl({
			search: '?checkout=success',
			env: { VITE_PADDLE_CLIENT_TOKEN: 'test_client_token' },
			initializePaddle,
		});
		assert.deepEqual(result, { opened: false, reason: 'no_ptxn' });
		assert.equal(calls.initialize.length, 0);
		assert.equal(calls.open.length, 0);
		assert.equal(fetchCalls, 0);
	});

	it('initializes sandbox and opens the existing transaction', async () => {
		const { calls, initializePaddle } = createPaddleMock();
		const result = await maybeOpenPaddleCheckoutFromUrl({
			search: '?_ptxn=txn_01valid',
			env: { VITE_PADDLE_CLIENT_TOKEN: 'test_client_token' },
			initializePaddle,
		});
		assert.deepEqual(result, { opened: true, transactionId: 'txn_01valid' });
		assert.equal(calls.initialize.length, 1);
		assert.deepEqual(calls.initialize[0], {
			environment: 'sandbox',
			token: 'test_client_token',
		});
		assert.equal(calls.open.length, 1);
		assert.deepEqual(calls.open[0], { transactionId: 'txn_01valid' });
		assert.equal(fetchCalls, 0);
	});

	it('initializes production when VITE_PADDLE_ENVIRONMENT is production or live', async () => {
		const { calls, initializePaddle } = createPaddleMock();
		const result = await maybeOpenPaddleCheckoutFromUrl({
			search: '?_ptxn=txn_01live',
			env: {
				VITE_PADDLE_CLIENT_TOKEN: 'test_client_token',
				VITE_PADDLE_ENVIRONMENT: 'live',
			},
			initializePaddle,
		});
		assert.equal(result.opened, true);
		assert.deepEqual(calls.initialize[0], {
			environment: 'production',
			token: 'test_client_token',
		});
	});

	it('initializes and opens only once for the same _ptxn', async () => {
		const { calls, initializePaddle } = createPaddleMock();
		const options = {
			search: '?_ptxn=txn_01once',
			env: { VITE_PADDLE_CLIENT_TOKEN: 'test_client_token' },
			initializePaddle,
		};
		await maybeOpenPaddleCheckoutFromUrl(options);
		const second = await maybeOpenPaddleCheckoutFromUrl(options);
		assert.equal(second.reason, 'already_opened');
		assert.equal(calls.initialize.length, 1);
		assert.equal(calls.open.length, 1);
		assert.equal(fetchCalls, 0);
	});

	it('does not initialize when the client-side token is missing', async () => {
		const errors = [];
		const originalError = console.error;
		console.error = (...args) => {
			errors.push(args.map(String).join(' '));
		};
		const { calls, initializePaddle } = createPaddleMock();
		try {
			const result = await maybeOpenPaddleCheckoutFromUrl({
				search: '?_ptxn=txn_01missing',
				env: { VITE_PADDLE_CLIENT_TOKEN: '' },
				initializePaddle,
			});
			assert.equal(result.reason, 'missing_token');
			assert.equal(result.opened, false);
			assert.equal(calls.initialize.length, 0);
			assert.equal(calls.open.length, 0);
			assert.match(errors.join('\n'), /VITE_PADDLE_CLIENT_TOKEN is missing/);
		} finally {
			console.error = originalError;
		}
	});
});

describe('paddleCheckout security and wiring', () => {
	it('uses only VITE_PADDLE_CLIENT_TOKEN and never backend secrets', () => {
		assert.match(helperSource, /VITE_PADDLE_CLIENT_TOKEN/);
		assert.match(helperSource, /VITE_PADDLE_ENVIRONMENT/);
		assert.doesNotMatch(helperSource, /PADDLE_API_KEY/);
		assert.doesNotMatch(helperSource, /pdl_sdbx_apikey_/);
		assert.doesNotMatch(helperSource, /webhookSecret/);
		assert.doesNotMatch(helperSource, /PADDLE_WEBHOOK/);
		assert.doesNotMatch(helperSource, /\/workspace\/v1\/subscription\/checkout/);
		assert.doesNotMatch(helperSource, /\/workspace\/v1\/credits\/packs\/purchase/);
		assert.match(helperSource, /transactionId/);
		assert.doesNotMatch(helperSource, /priceId/);
		assert.doesNotMatch(helperSource, /price_id/);
	});

	it('SubscriptionPage opens _ptxn via the shared helper and keeps existing checkout POST', () => {
		assert.match(pageSource, /maybeOpenPaddleCheckoutFromUrl/);
		assert.match(pageSource, /startSubscriptionCheckout/);
		assert.match(planCardsSource, /\/workspace\/v1\/subscription\/checkout/);
		assert.match(pageSource, /CREDIT_PACK_PURCHASE_PATH/);
		assert.match(pageSource, /buildCreditPackPurchaseBody/);
		assert.match(pageSource, /listCreditPackItems/);
		assert.doesNotMatch(pageSource, /checkout=success[\s\S]{0,80}activated/);
		assert.doesNotMatch(pageSource, /PADDLE_API_KEY/);
		assert.doesNotMatch(pageSource, /pdl_sdbx_apikey_/);
	});
});
