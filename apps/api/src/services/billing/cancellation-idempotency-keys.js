/** Default stale threshold for abandoned cancellation claims (5 minutes). */
export const CANCELLATION_IDEMPOTENCY_STALE_MS = 5 * 60 * 1000;

/**
 * Deterministic cancellation idempotency key — subscription identity only.
 * Format: subscription_cancel:{workspaceKey}:{provider}:{providerSubscriptionId}
 */
export function buildSubscriptionCancelIdempotencyKey(workspaceKey, provider, providerSubscriptionId) {
	const ws = String(workspaceKey || '').trim();
	const prov = String(provider || '').trim().toLowerCase();
	const subId = String(providerSubscriptionId || '').trim();
	return `subscription_cancel:${ws}:${prov}:${subId}`.slice(0, 180);
}
