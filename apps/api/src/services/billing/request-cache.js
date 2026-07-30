/**
 * Request-scoped billing config cache (AsyncLocalStorage).
 * No global/process-wide caching — entries live only for one request ALS context.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const billingRequestCache = new AsyncLocalStorage();

/**
 * Run work with a fresh per-request billing cache.
 * Use from Express middleware or route wrappers.
 */
export function runWithBillingRequestCache(fn) {
	const existing = billingRequestCache.getStore();
	if (existing) return fn();
	return billingRequestCache.run({
		rawPayloadPromise: null,
		resolvedConfigPromise: null,
		monitoringSnapshot: null,
	}, fn);
}

export function getBillingRequestCache() {
	return billingRequestCache.getStore() || null;
}

export function middlewareBillingRequestCache(req, res, next) {
	runWithBillingRequestCache(() => next());
}
