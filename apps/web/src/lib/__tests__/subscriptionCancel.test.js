/**
 * PR-08 — Paddle-first subscription cancel UI helper tests.
 * Run: node --test src/lib/__tests__/subscriptionCancel.test.js
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CHECKOUT_CANCEL_PATH,
	SUBSCRIPTION_CANCEL_BODY,
	SUBSCRIPTION_CANCEL_PATH,
	accessContinuesUntilMessage,
	canShowSubscriptionCancel,
	isCancelScheduled,
	mapSubscriptionCancelError,
} from '../subscriptionCancel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(
	path.resolve(here, '../../pages/app/SubscriptionPage.jsx'),
	'utf8',
);
const checkoutSource = readFileSync(
	path.resolve(here, '../subscriptionPlanCards.js'),
	'utf8',
);

function paddleSub(overrides = {}) {
	return {
		id: 'sub1',
		provider: 'paddle',
		status: 'active',
		billingStatus: 'active',
		cancelAtPeriodEnd: false,
		currentPeriodEnd: '2026-09-01T00:00:00.000Z',
		...overrides,
	};
}

describe('PR-08 subscription cancel helper', () => {
	it('posts to the existing cancel path with atPeriodEnd true only', () => {
		assert.equal(SUBSCRIPTION_CANCEL_PATH, '/workspace/v1/subscription/cancel');
		assert.deepEqual(SUBSCRIPTION_CANCEL_BODY, { atPeriodEnd: true });
		assert.deepEqual(Object.keys(SUBSCRIPTION_CANCEL_BODY), ['atPeriodEnd']);
		assert.equal(SUBSCRIPTION_CANCEL_BODY.atPeriodEnd, true);
	});

	it('shows Cancel for an active Paddle subscription DTO', () => {
		assert.equal(canShowSubscriptionCancel(paddleSub()), true);
	});

	it('does not use a global billing provider field — Stripe and Lemon stay hidden', () => {
		assert.equal(canShowSubscriptionCancel(paddleSub({ provider: 'stripe' })), false);
		assert.equal(canShowSubscriptionCancel(paddleSub({ provider: 'lemonsqueezy' })), false);
		assert.equal(canShowSubscriptionCancel(paddleSub({ provider: 'none' })), false);
		assert.equal(canShowSubscriptionCancel({
			...paddleSub({ provider: 'stripe' }),
			billing: { provider: 'paddle' },
		}), false);
		assert.equal(canShowSubscriptionCancel(null), false);
	});

	it('already scheduled does not show another Cancel', () => {
		assert.equal(canShowSubscriptionCancel(paddleSub({ cancelAtPeriodEnd: true })), false);
		assert.equal(canShowSubscriptionCancel(paddleSub({ billingStatus: 'cancel_scheduled' })), false);
		assert.equal(isCancelScheduled(paddleSub({ cancelAtPeriodEnd: true })), true);
		assert.equal(isCancelScheduled(paddleSub({ billingStatus: 'cancel_scheduled' })), true);
	});

	it('already canceled does not show Cancel', () => {
		assert.equal(canShowSubscriptionCancel(paddleSub({ status: 'canceled' })), false);
		assert.equal(canShowSubscriptionCancel(paddleSub({ billingStatus: 'expired' })), false);
	});

	it('maps existing API error statuses without new backend codes', () => {
		assert.equal(mapSubscriptionCancelError(403, { errorCode: 'FORBIDDEN' }).title, 'Permission denied');
		assert.equal(mapSubscriptionCancelError(404, { errorCode: 'NOT_FOUND' }).title, 'Subscription not found');
		assert.equal(
			mapSubscriptionCancelError(409, { errorCode: 'CANCELLATION_IN_PROGRESS' }).title,
			'Cancellation in progress',
		);
		assert.match(
			mapSubscriptionCancelError(422, { message: 'atPeriodEnd must be a boolean' }).description,
			/atPeriodEnd/,
		);
		assert.equal(
			mapSubscriptionCancelError(502, { errorCode: 'PROVIDER_CANCEL_FAILED' }).title,
			'Provider cancellation failed',
		);
	});

	it('tells the customer access continues until currentPeriodEnd', () => {
		const message = accessContinuesUntilMessage('2026-09-01T00:00:00.000Z');
		assert.equal(message.startsWith('Access continues until '), true);
		assert.notEqual(message, 'Access continues until the end of the current billing period.');
	});
});

describe('PR-08 SubscriptionPage wiring', () => {
	it('keeps checkout cancelUrl on /app/subscription?checkout=cancel', () => {
		assert.equal(CHECKOUT_CANCEL_PATH, '/app/subscription?checkout=cancel');
		assert.match(checkoutSource, /\/app\/subscription\?checkout=cancel/);
		assert.match(
			checkoutSource,
			/cancelUrl:\s*origin\s*\?\s*`\$\{origin\}\/app\/subscription\?checkout=cancel`/,
		);
	});

	it('calls the existing cancel route with the frozen atPeriodEnd true body', () => {
		assert.match(pageSource, /SUBSCRIPTION_CANCEL_PATH/);
		assert.match(pageSource, /SUBSCRIPTION_CANCEL_BODY/);
		assert.match(pageSource, /canShowSubscriptionCancel/);
		assert.equal(/atPeriodEnd:\s*false/.test(pageSource), false);
	});

	it('gates Cancel on the subscription DTO provider, not billing.provider', () => {
		assert.match(pageSource, /canShowSubscriptionCancel\(subscription\)/);
		assert.equal(/canShowSubscriptionCancel\(\s*billing/.test(pageSource), false);
		assert.equal(/billing\?\.provider\s*===\s*['"]paddle['"]/.test(pageSource), false);
	});
});
