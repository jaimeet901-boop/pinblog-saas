import { validateBillingInterval } from './billing-model.js';
import { extractPaddlePriceId } from './providers/paddle-webhook-helpers.js';
import { getPaddleSubscription, PaddleApiError } from './providers/paddle-api-client.js';

/** Map Paddle Billing API billing_cycle.interval to contract intervals. */
const PADDLE_BILLING_CYCLE_INTERVAL_MAP = Object.freeze({
	month: 'monthly',
	year: 'yearly',
});

function fail(error, extra = {}) {
	return { ok: false, error, ...extra };
}

/**
 * Parse an authoritative ISO timestamp from Paddle — fail closed on missing/invalid.
 */
export function parsePaddleAuthoritativeIsoDate(value, fieldKey) {
	const field = String(fieldKey || 'timestamp').trim();
	const raw = String(value ?? '').trim();
	if (!raw) {
		return fail(`paddle_${field}_missing`);
	}
	const parsed = Date.parse(raw);
	if (!Number.isFinite(parsed)) {
		return fail(`paddle_${field}_invalid`, { value: raw });
	}
	return { ok: true, value: raw };
}

export function extractPaddleSubscriptionId(subscription = {}) {
	return String(subscription?.id || '').trim();
}

export function extractPaddleSubscriptionStatus(subscription = {}) {
	return String(subscription?.status || '').trim().toLowerCase();
}

/**
 * Extract scheduled_change without inferring fulfillment outcomes.
 * Returns { ok, scheduledChange: null | { action, effectiveAt } }.
 */
export function extractPaddleScheduledChange(subscription = {}) {
	const raw = subscription?.scheduled_change ?? subscription?.scheduledChange ?? null;
	if (raw == null) {
		return { ok: true, scheduledChange: null };
	}
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		return fail('paddle_scheduled_change_malformed');
	}

	const action = String(raw.action ?? '').trim().toLowerCase();
	const effectiveAtRaw = raw.effective_at ?? raw.effectiveAt ?? null;

	if (!action && !effectiveAtRaw) {
		return fail('paddle_scheduled_change_malformed');
	}

	if (action && !effectiveAtRaw) {
		return fail('paddle_scheduled_change_effective_at_missing');
	}

	if (effectiveAtRaw) {
		const effectiveAtCheck = parsePaddleAuthoritativeIsoDate(effectiveAtRaw, 'scheduled_change_effective_at');
		if (!effectiveAtCheck.ok) return effectiveAtCheck;
		return {
			ok: true,
			scheduledChange: {
				action,
				effectiveAt: effectiveAtCheck.value,
			},
		};
	}

	return fail('paddle_scheduled_change_action_missing');
}

/**
 * Collect unique price IDs from Paddle subscription items — fail closed when ambiguous.
 */
export function extractPaddleSubscriptionPriceIds(subscription = {}) {
	const direct = extractPaddlePriceId(subscription);
	const ids = new Set();
	if (direct) ids.add(direct);

	const items = Array.isArray(subscription?.items) ? subscription.items : [];
	for (const item of items) {
		const fromItem = String(
			item?.price_id
			|| item?.price?.id
			|| item?.price?.price_id
			|| '',
		).trim();
		if (fromItem) ids.add(fromItem);
	}

	return [...ids];
}

/**
 * Authoritative Paddle subscription price identity (single price required).
 */
export function extractPaddleSubscriptionPriceId(subscription = {}) {
	const ids = extractPaddleSubscriptionPriceIds(subscription);
	if (ids.length === 0) {
		return fail('paddle_subscription_price_missing');
	}
	if (ids.length > 1) {
		return fail('paddle_subscription_price_ambiguous', { priceIds: ids });
	}
	return { ok: true, priceId: ids[0] };
}

function resolvePaddlePriceBillingCycle(subscription = {}, priceId = '') {
	const items = Array.isArray(subscription?.items) ? subscription.items : [];
	for (const item of items) {
		const itemPriceId = String(
			item?.price_id
			|| item?.price?.id
			|| item?.price?.price_id
			|| '',
		).trim();
		if (itemPriceId && itemPriceId !== priceId) continue;

		const cycle = item?.price?.billing_cycle || item?.price?.billingCycle || null;
		if (cycle && typeof cycle === 'object') {
			return cycle;
		}
	}

	const topLevelCycle = subscription?.billing_cycle || subscription?.billingCycle || null;
	if (topLevelCycle && typeof topLevelCycle === 'object') {
		return topLevelCycle;
	}

	return null;
}

/**
 * Normalize Paddle billing_cycle to contract interval (monthly/yearly).
 */
export function normalizePaddleBillingCycleInterval(billingCycle = {}) {
	const intervalRaw = String(billingCycle?.interval ?? '').trim().toLowerCase();
	const frequency = Number(billingCycle?.frequency);

	if (!intervalRaw) {
		return fail('paddle_billing_cycle_interval_missing');
	}
	if (!Number.isFinite(frequency) || frequency !== 1) {
		return fail('paddle_billing_cycle_frequency_unsupported', { frequency });
	}

	const mapped = PADDLE_BILLING_CYCLE_INTERVAL_MAP[intervalRaw];
	if (!mapped) {
		return fail('paddle_billing_cycle_interval_unsupported', { interval: intervalRaw });
	}

	return validateBillingInterval(mapped, { allowEmpty: false });
}

export function extractPaddleSubscriptionBillingInterval(subscription = {}, priceId = '') {
	const priceCheck = priceId
		? { ok: true, priceId }
		: extractPaddleSubscriptionPriceId(subscription);
	if (!priceCheck.ok) return priceCheck;

	const billingCycle = resolvePaddlePriceBillingCycle(subscription, priceCheck.priceId);
	if (!billingCycle) {
		return fail('paddle_billing_cycle_missing');
	}

	return normalizePaddleBillingCycleInterval(billingCycle);
}

/**
 * Authoritative current billing period from Paddle subscription response.
 */
export function extractPaddleCurrentBillingPeriod(subscription = {}) {
	const period = subscription?.current_billing_period ?? subscription?.currentBillingPeriod ?? null;
	if (!period || typeof period !== 'object' || Array.isArray(period)) {
		return fail('paddle_current_billing_period_missing');
	}

	const startsAtRaw = period.starts_at ?? period.startsAt ?? null;
	const endsAtRaw = period.ends_at ?? period.endsAt ?? null;

	const startsAtCheck = parsePaddleAuthoritativeIsoDate(startsAtRaw, 'current_billing_period_starts_at');
	if (!startsAtCheck.ok) return startsAtCheck;

	const endsAtCheck = parsePaddleAuthoritativeIsoDate(endsAtRaw, 'current_billing_period_ends_at');
	if (!endsAtCheck.ok) return endsAtCheck;

	if (Date.parse(endsAtCheck.value) <= Date.parse(startsAtCheck.value)) {
		return fail('paddle_current_billing_period_invalid_range');
	}

	return {
		ok: true,
		currentBillingPeriod: {
			startsAt: startsAtCheck.value,
			endsAt: endsAtCheck.value,
		},
	};
}

/**
 * Verify local/provider subscription identity against authoritative Paddle subscription ID.
 */
export function verifyPaddleSubscriptionIdentity({
	subscription = {},
	subscriptionRecord = null,
	expectedSubscriptionId = '',
} = {}) {
	const paddleSubscriptionId = extractPaddleSubscriptionId(subscription);
	if (!paddleSubscriptionId) {
		return fail('paddle_subscription_id_missing');
	}

	const expectedId = String(expectedSubscriptionId || '').trim();
	if (expectedId && expectedId !== paddleSubscriptionId) {
		return fail('paddle_subscription_id_mismatch', {
			expectedSubscriptionId: expectedId,
			paddleSubscriptionId,
		});
	}

	if (subscriptionRecord && typeof subscriptionRecord === 'object') {
		const localPaddleId = String(subscriptionRecord.paddle_subscription_id || '').trim();
		if (localPaddleId && localPaddleId !== paddleSubscriptionId) {
			return fail('paddle_subscription_identity_mismatch', {
				localSubscriptionId: localPaddleId,
				paddleSubscriptionId,
			});
		}

		const provider = String(subscriptionRecord.provider || '').trim().toLowerCase();
		const providerSubId = String(subscriptionRecord.provider_subscription_id || '').trim();
		if (provider === 'paddle' && providerSubId && providerSubId !== paddleSubscriptionId) {
			return fail('paddle_subscription_identity_mismatch', {
				localSubscriptionId: providerSubId,
				paddleSubscriptionId,
			});
		}
	}

	return { ok: true, subscriptionId: paddleSubscriptionId };
}

/**
 * Phase 4.4-A — Pure verification contract for Paddle subscription reconciliation.
 * Exposes authoritative Paddle state only; never mutates entitlement or fulfillment flags.
 */
export function verifyPaddleSubscriptionForReconciliation({
	subscription = {},
	subscriptionRecord = null,
	expectedSubscriptionId = '',
} = {}) {
	if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
		return fail('paddle_subscription_missing');
	}

	const identity = verifyPaddleSubscriptionIdentity({
		subscription,
		subscriptionRecord,
		expectedSubscriptionId,
	});
	if (!identity.ok) return identity;

	const status = extractPaddleSubscriptionStatus(subscription);
	if (!status) {
		return fail('paddle_subscription_status_missing');
	}

	const scheduled = extractPaddleScheduledChange(subscription);
	if (!scheduled.ok) return scheduled;

	const price = extractPaddleSubscriptionPriceId(subscription);
	if (!price.ok) return price;

	const interval = extractPaddleSubscriptionBillingInterval(subscription, price.priceId);
	if (!interval.ok) return interval;

	const period = extractPaddleCurrentBillingPeriod(subscription);
	if (!period.ok) return period;

	const scheduledChange = scheduled.scheduledChange;
	const cancelScheduledAtPeriodEnd = scheduledChange?.action === 'cancel' && Boolean(scheduledChange?.effectiveAt);

	return {
		ok: true,
		subscriptionId: identity.subscriptionId,
		status,
		scheduledChange,
		cancelScheduledAtPeriodEnd,
		priceId: price.priceId,
		interval: interval.value,
		currentBillingPeriod: period.currentBillingPeriod,
		customerId: String(subscription.customer_id || subscription.customerId || '').trim(),
	};
}

/**
 * Fetch authoritative Paddle subscription and run reconciliation verification (fail-closed).
 */
export async function fetchAndVerifyPaddleSubscriptionForReconciliation({
	subscriptionId = '',
	subscriptionRecord = null,
	environment = '',
	config = {},
	fetchImpl = fetch,
} = {}) {
	const id = String(subscriptionId || '').trim();
	if (!id) {
		return fail('paddle_subscription_id_missing');
	}

	let subscription;
	try {
		subscription = await getPaddleSubscription(id, {
			environment,
			config,
			fetchImpl,
		});
	} catch (error) {
		if (error instanceof PaddleApiError) {
			return fail(error.code || error.message || 'paddle_api_error', {
				status: error.status || 0,
				retryable: Boolean(error.isServerError || error.isTimeout),
			});
		}
		return fail('paddle_api_error', { message: error?.message || String(error) });
	}

	if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
		return fail('paddle_subscription_malformed');
	}
	if (!extractPaddleSubscriptionId(subscription)) {
		return fail('paddle_subscription_malformed');
	}

	return verifyPaddleSubscriptionForReconciliation({
		subscription,
		subscriptionRecord,
		expectedSubscriptionId: id,
	});
}
