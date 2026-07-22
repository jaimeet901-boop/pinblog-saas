import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { ANALYTICS_TTL_SECONDS } from './helpers.js';

export async function getCachedAnalytics(cacheKey) {
	const row = await pocketbaseClient.collection('analytics_cache').getFirstListItem(
		pocketbaseClient.filter('cache_key = {:key}', { key: cacheKey }),
		{ requestKey: null },
	).catch(() => null);

	if (!row) return null;
	const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
	const fresh = expiresAt > Date.now() && !row.stale;
	return {
		payload: row.payload || null,
		fresh,
		computedAt: row.computed_at || row.updated || null,
		expiresAt: row.expires_at || null,
		row,
	};
}

export async function setCachedAnalytics({
	cacheKey,
	scope,
	scopeKey = '',
	rangeKey = '',
	payload,
	ttlSeconds = ANALYTICS_TTL_SECONDS,
}) {
	const now = new Date();
	const expires = new Date(now.getTime() + (Number(ttlSeconds) || ANALYTICS_TTL_SECONDS) * 1000);
	const body = {
		cache_key: cacheKey,
		scope,
		scope_key: scopeKey,
		range_key: rangeKey,
		payload,
		computed_at: now.toISOString(),
		expires_at: expires.toISOString(),
		ttl_seconds: Number(ttlSeconds) || ANALYTICS_TTL_SECONDS,
		stale: false,
		meta: {},
	};

	const existing = await pocketbaseClient.collection('analytics_cache').getFirstListItem(
		pocketbaseClient.filter('cache_key = {:key}', { key: cacheKey }),
		{ requestKey: null },
	).catch(() => null);

	if (existing) {
		return pocketbaseClient.collection('analytics_cache').update(existing.id, body).catch(() => existing);
	}
	return pocketbaseClient.collection('analytics_cache').create(body).catch(() => null);
}

export async function invalidateAnalyticsCache({ scope, scopeKey } = {}) {
	const filter = scope
		? (scopeKey
			? pocketbaseClient.filter('scope = {:scope} && scope_key = {:key}', { scope, key: scopeKey })
			: pocketbaseClient.filter('scope = {:scope}', { scope }))
		: '';
	const rows = await pocketbaseClient.collection('analytics_cache').getFullList({
		filter: filter || undefined,
		requestKey: null,
	}).catch(() => []);
	for (const row of rows) {
		await pocketbaseClient.collection('analytics_cache').update(row.id, { stale: true }).catch(() => null);
	}
	return rows.length;
}

export async function upsertDailyMetric({
	scope,
	scopeKey,
	day,
	metric,
	value,
	owner,
	workspace,
	dimensions = {},
	meta = {},
}) {
	const dayIso = new Date(day);
	dayIso.setHours(0, 0, 0, 0);
	const existing = await pocketbaseClient.collection('analytics_daily').getFirstListItem(
		pocketbaseClient.filter('scope = {:scope} && scope_key = {:key} && day = {:day} && metric = {:metric}', {
			scope,
			key: scopeKey,
			day: dayIso.toISOString(),
			metric,
		}),
		{ requestKey: null },
	).catch(() => null);

	const body = {
		scope,
		scope_key: scopeKey,
		day: dayIso.toISOString(),
		metric,
		value: Number(value) || 0,
		owner: owner || undefined,
		workspace: workspace || undefined,
		dimensions,
		meta,
	};

	if (existing) {
		return pocketbaseClient.collection('analytics_daily').update(existing.id, body).catch(() => existing);
	}
	return pocketbaseClient.collection('analytics_daily').create(body).catch(() => null);
}
