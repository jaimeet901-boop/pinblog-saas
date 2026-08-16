import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { getCachedAnalytics, setCachedAnalytics } from './cache.js';
import {
	resolveRange,
	safeList,
} from './helpers.js';
import { workspaceScopeFilter } from '../workspace-ownership.js';
import { FACEBOOK_JOB_COLLECTION } from '../facebook/channel-pack.js';
import {
	assembleWorkspaceOverviewFromSources,
	toWorkspaceAnalyticsCsv,
} from './workspace-overview.js';

export {
	assembleWorkspaceOverviewFromSources,
	mapFacebookWorkspaceAnalyticsItem,
	mapPinterestWorkspaceAnalyticsItem,
	mapWordpressWorkspaceAnalyticsItem,
	toWorkspaceAnalyticsCsv,
	workspaceAnalyticsItemDestination,
	workspaceAnalyticsItemTitle,
	workspaceAnalyticsItemUrl,
} from './workspace-overview.js';

function workspaceKeyFor(req) {
	return req.workspace?.workspace_key || req.workspace?.id || req.pocketbaseUserId;
}

export async function buildWorkspaceOverview(req, { range = '30d', from, to, bypassCache = false } = {}) {
	const workspaceKey = workspaceKeyFor(req);
	const { rangeKey, start, end, startIso, endIso } = resolveRange(range, from, to);
	const cacheKey = `workspace:${workspaceKey}:overview:${rangeKey}:${startIso.slice(0, 10)}`;

	if (!bypassCache) {
		const cached = await getCachedAnalytics(cacheKey);
		if (cached?.fresh && cached.payload) {
			return { ...cached.payload, meta: { ...(cached.payload.meta || {}), cached: true, computedAt: cached.computedAt } };
		}
	}

	const scopeFilter = workspaceScopeFilter(req);
	const [
		articles,
		imageJobs,
		queueJobs,
		pinJobs,
		pinHistory,
		wpHistory,
		wpJobs,
		facebookJobs,
		creditsTx,
		subscription,
		usage,
		websites,
		accounts,
		boards,
		aiPins,
	] = await Promise.all([
		safeList(pocketbaseClient.collection('articles').getList(1, 300, { filter: scopeFilter, sort: '-created', requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('ai_pin_image_jobs').getList(1, 300, { filter: scopeFilter, sort: '-created', requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('queue_jobs').getList(1, 300, { filter: scopeFilter, sort: '-created', requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('pinterest_publish_jobs').getList(1, 300, {
			filter: scopeFilter,
			sort: '-updated',
			expand: 'ai_pin,account',
			requestKey: null,
		}).then((r) => r.items)),
		safeList(pocketbaseClient.collection('pinterest_publish_history').getList(1, 300, { filter: scopeFilter, sort: '-published_at', requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('publish_history').getList(1, 300, {
			filter: scopeFilter,
			sort: '-published_at',
			requestKey: null,
		}).then((r) => r.items)),
		safeList(pocketbaseClient.collection('publish_jobs').getList(1, 200, {
			filter: scopeFilter,
			sort: '-created',
			expand: 'site',
			requestKey: null,
		}).then((r) => r.items)),
		safeList(pocketbaseClient.collection(FACEBOOK_JOB_COLLECTION).getList(1, 300, {
			filter: scopeFilter,
			sort: '-updated',
			expand: 'ai_pin,account',
			requestKey: null,
		}).then((r) => r.items)),
		safeList(pocketbaseClient.collection('credit_transactions').getList(1, 300, {
			filter: pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
			sort: '-created',
			requestKey: null,
		}).then((r) => r.items)),
		pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
			{ requestKey: null },
		).catch(() => null),
		pocketbaseClient.collection('workspace_usage').getList(1, 1, {
			filter: pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
			sort: '-period',
			requestKey: null,
		).then((r) => r.items?.[0] || null).catch(() => null),
		safeList(pocketbaseClient.collection('websites').getList(1, 100, { filter: scopeFilter, requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('pinterest_accounts').getList(1, 100, { filter: scopeFilter, requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('pinterest_boards').getList(1, 200, { filter: scopeFilter, requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('ai_pins').getList(1, 300, { filter: scopeFilter, sort: '-updated', requestKey: null }).then((r) => r.items)),
	]);

	const payload = assembleWorkspaceOverviewFromSources({
		articles,
		imageJobs,
		queueJobs,
		pinJobs,
		pinHistory,
		wpHistory,
		wpJobs,
		facebookJobs,
		creditsTx,
		subscription,
		usage,
		websites,
		accounts,
		boards,
		aiPins,
		start,
		end,
		rangeKey,
		startIso,
		endIso,
		workspaceKey,
	});

	await setCachedAnalytics({
		cacheKey,
		scope: 'workspace',
		scopeKey: workspaceKey,
		rangeKey,
		payload,
	});

	return payload;
}

export async function exportWorkspaceAnalytics(req, { range, from, to, format = 'json' } = {}) {
	const overview = await buildWorkspaceOverview(req, { range, from, to });
	if (format === 'csv') {
		return {
			contentType: 'text/csv;charset=utf-8',
			body: toWorkspaceAnalyticsCsv(overview.items || []),
			filename: `workspace-analytics-${range || '30d'}.csv`,
		};
	}
	return {
		contentType: 'application/json',
		body: JSON.stringify(overview, null, 2),
		filename: `workspace-analytics-${range || '30d'}.json`,
	};
}
