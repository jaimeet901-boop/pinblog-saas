/** Default stale threshold for abandoned reconciliation claims (5 minutes). */
export const RECONCILIATION_IDEMPOTENCY_STALE_MS = 5 * 60 * 1000;

/**
 * Deterministic reconciliation idempotency key — Paddle subscription + webhook event.
 * Format: subscription_reconcile:paddle:{subscriptionId}:{eventId}
 */
export function buildSubscriptionReconcileIdempotencyKey(subscriptionId, eventId, provider = 'paddle') {
	const subId = String(subscriptionId || '').trim();
	const evt = String(eventId || '').trim();
	const prov = String(provider || 'paddle').trim().toLowerCase();
	if (!subId || !evt) return '';
	return `subscription_reconcile:${prov}:${subId}:${evt}`.slice(0, 180);
}

export { buildSubscriptionReconcileIdempotencyKey as buildSubscriptionReconciliationIdempotencyKey };
