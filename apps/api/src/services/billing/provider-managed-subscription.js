/**
 * Phase 3.2 — Identify Paddle-managed subscriptions that must not receive
 * unsafe local scheduler renewals. Verified Paddle webhooks remain authoritative.
 */

export const PROVIDER_MANAGED_SKIP_REASON = 'provider_managed';

/**
 * Conservative fail-closed predicate for Paddle-managed paid billing lifecycles.
 *
 * Uses Phase 1/2 metadata written during verified Paddle fulfillment:
 * - billing_source === 'paddle' (primary)
 * - provider === 'paddle' with paddle_subscription_id (identity)
 * - activation_source === 'paddle_webhook' with provider === 'paddle' (legacy rows)
 *
 * Does NOT treat generic provider fields (stripe/paypal/none) as Paddle-managed.
 */
export function isProviderManagedPaddleSubscription(subscription = {}) {
	const billingSource = String(subscription.billing_source || '').trim().toLowerCase();
	if (billingSource === 'paddle') {
		return true;
	}

	const provider = String(subscription.provider || '').trim().toLowerCase();
	const paddleSubscriptionId = String(subscription.paddle_subscription_id || '').trim();
	if (provider === 'paddle' && paddleSubscriptionId) {
		return true;
	}

	const activationSource = String(subscription.activation_source || '').trim().toLowerCase();
	if (activationSource === 'paddle_webhook' && provider === 'paddle') {
		return true;
	}

	return false;
}

/**
 * Resolve early skip reason for generic local renewal (scheduler / legacy webhooks).
 * Returns empty string when local renewal may proceed.
 */
export function resolveLocalRenewalSkipReason(subscription = {}, { force = false, now = new Date() } = {}) {
	const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
	if (!force && periodEnd && periodEnd.getTime() > now.getTime()) {
		return 'period_not_ended';
	}

	if (subscription.status === 'canceled' && !subscription.cancel_at_period_end) {
		return 'canceled';
	}

	if (isProviderManagedPaddleSubscription(subscription)) {
		return PROVIDER_MANAGED_SKIP_REASON;
	}

	return '';
}

/**
 * Pure scheduler auto-renew eligibility (mirrors processSubscriptionLifecycleBatch).
 */
export function shouldSchedulerAttemptAutoRenew(subscription = {}, config = {}, now = new Date()) {
	if (!config?.autoRenew) {
		return false;
	}

	const periodEnd = subscription.current_period_end;
	const periodDaysLeft = periodEnd
		? Math.ceil((new Date(periodEnd).getTime() - now.getTime()) / 86400000)
		: null;

	return (
		periodDaysLeft != null
		&& periodDaysLeft < 0
		&& ['active', 'trialing'].includes(subscription.status)
		&& !subscription.cancel_at_period_end
	);
}
