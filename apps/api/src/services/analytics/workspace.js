import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { getCachedAnalytics, setCachedAnalytics } from './cache.js';
import {
	avg,
	bump,
	dayKey,
	formatDuration,
	inRange,
	monthLabel,
	pct,
	resolveRange,
	safeList,
	seriesFromMap,
} from './helpers.js';

function workspaceKeyFor(req) {
	return req.workspace?.workspace_key || req.workspace?.id || req.pocketbaseUserId;
}

export async function buildWorkspaceOverview(req, { range = '30d', from, to, bypassCache = false } = {}) {
	const owner = req.pocketbaseUserId;
	const workspaceKey = workspaceKeyFor(req);
	const { rangeKey, start, end, startIso, endIso } = resolveRange(range, from, to);
	const cacheKey = `workspace:${workspaceKey}:overview:${rangeKey}:${startIso.slice(0, 10)}`;

	if (!bypassCache) {
		const cached = await getCachedAnalytics(cacheKey);
		if (cached?.fresh && cached.payload) {
			return { ...cached.payload, meta: { ...(cached.payload.meta || {}), cached: true, computedAt: cached.computedAt } };
		}
	}

	const ownerFilter = pocketbaseClient.filter('owner = {:owner}', { owner });
	const [
		articles,
		imageJobs,
		queueJobs,
		pinJobs,
		pinHistory,
		wpHistory,
		wpJobs,
		creditsTx,
		subscription,
		usage,
		websites,
		accounts,
		boards,
	] = await Promise.all([
		safeList(pocketbaseClient.collection('articles').getList(1, 300, { filter: ownerFilter, sort: '-created', requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('ai_pin_image_jobs').getList(1, 300, { filter: ownerFilter, sort: '-created', requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('queue_jobs').getList(1, 300, { filter: ownerFilter, sort: '-created', requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('pinterest_publish_jobs').getList(1, 300, {
			filter: ownerFilter,
			sort: '-updated',
			expand: 'ai_pin,account',
			requestKey: null,
		}).then((r) => r.items)),
		safeList(pocketbaseClient.collection('pinterest_publish_history').getList(1, 300, { filter: ownerFilter, sort: '-published_at', requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('publish_history').getList(1, 300, {
			filter: pocketbaseClient.filter('owner = {:owner}', { owner }),
			sort: '-published_at',
			requestKey: null,
		}).then((r) => r.items)),
		safeList(pocketbaseClient.collection('publish_jobs').getList(1, 200, { filter: ownerFilter, sort: '-created', requestKey: null }).then((r) => r.items)),
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
		}).then((r) => r.items?.[0] || null).catch(() => null),
		safeList(pocketbaseClient.collection('websites').getList(1, 100, { filter: ownerFilter, requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('pinterest_accounts').getList(1, 100, { filter: ownerFilter, requestKey: null }).then((r) => r.items)),
		safeList(pocketbaseClient.collection('pinterest_boards').getList(1, 200, { filter: ownerFilter, requestKey: null }).then((r) => r.items)),
	]);

	const articlesInRange = articles.filter((row) => inRange(row.created, start, end));
	const imagesInRange = imageJobs.filter((row) => inRange(row.created || row.completed_at, start, end));
	const queueInRange = queueJobs.filter((row) => inRange(row.created, start, end));
	const burns = creditsTx.filter((row) => (row.type === 'burn' || Number(row.amount) < 0) && inRange(row.created, start, end));
	const creditsUsed = burns.reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0);
	const creditsRemaining = Number(subscription?.credits_balance) || 0;

	const pinPublished = pinJobs.filter((j) => j.status === 'published');
	const pinFailed = pinJobs.filter((j) => j.status === 'failed');
	const pinScheduled = pinJobs.filter((j) => j.status === 'scheduled' || j.status === 'publishing');
	const wpPublished = wpHistory.filter((row) => row.result === 'published' || row.result === 'scheduled');
	const wpFailed = wpHistory.filter((row) => row.result === 'failed');
	const wpDrafts = wpJobs.filter((j) => j.wp_status === 'draft' || j.status === 'queued');

	const genDurations = [
		...imageJobs.map((j) => Number(j.duration_ms)).filter(Boolean),
		...queueJobs.filter((j) => String(j.type || '').includes('article') || String(j.type || '').includes('image')).map((j) => Number(j.duration_ms)).filter(Boolean),
	];
	const publishDurations = [
		...pinHistory.map((j) => Number(j.duration_ms)).filter(Boolean),
		...wpHistory.map((j) => Number(j.duration_ms)).filter(Boolean),
		...pinPublished.filter((j) => j.created && j.published_at).map((j) => new Date(j.published_at) - new Date(j.created)).filter((ms) => ms > 0),
	];

	const decided = pinPublished.length + pinFailed.length + wpPublished.length + wpFailed.length;
	const failures = pinFailed.length + wpFailed.length;
	const failureRate = pct(failures, decided || 1);

	const daily = new Map();
	const monthly = new Map();
	for (const item of [...pinJobs, ...wpHistory, ...articlesInRange]) {
		const stamp = item.published_at || item.created;
		if (!stamp || !inRange(stamp, start, end)) continue;
		bump(daily, dayKey(stamp));
		const d = new Date(stamp);
		bump(monthly, `${monthLabel(d)} ${d.getFullYear()}`);
	}

	const items = pinJobs.map((job) => {
		const pin = job.expand?.ai_pin || null;
		const account = job.expand?.account || null;
		return {
			id: job.id,
			status: job.status,
			websiteId: job.websiteId || pin?.websiteId || '',
			articleId: job.articleId || pin?.articleId || '',
			accountId: job.account || account?.id || '',
			accountLabel: job.account_label || account?.label || account?.account_name || '',
			accountUsername: job.account_username || account?.username || '',
			boardId: job.board_id || '',
			boardName: job.board_name || '',
			scheduledAt: job.scheduled_at || null,
			publishedAt: job.published_at || null,
			createdAt: job.created,
			updatedAt: job.updated,
			pinterestPinId: job.pinterest_pin_id || '',
			pinterestPinUrl: job.pinterest_pin_url || '',
			destinationUrl: pin?.destination_url || pin?.link || '',
			performance: job.performance || {},
			pin: pin ? {
				id: pin.id,
				title: pin.title || '',
				description: pin.description || '',
				overlayText: pin.overlay_text || '',
				imageUrl: pin.image_url || '',
				status: pin.status || '',
				destinationUrl: pin.destination_url || pin.link || '',
			} : null,
		};
	});

	const summary = {
		published: pinPublished.length,
		failed: pinFailed.length,
		scheduled: pinScheduled.length,
		clicks: items.reduce((sum, item) => sum + (Number(item.performance?.outboundClicks) || 0), 0),
		saves: items.reduce((sum, item) => sum + (Number(item.performance?.saves) || 0), 0),
		impressions: items.reduce((sum, item) => sum + (Number(item.performance?.impressions) || 0), 0),
		bestBoard: boards[0]?.name || items.find((i) => i.boardName)?.boardName || '—',
		bestPin: pinPublished[0]?.expand?.ai_pin?.title || items.find((i) => i.pin?.title)?.pin?.title || '—',
		articlesGenerated: articlesInRange.length || Number(usage?.articles) || 0,
		imagesGenerated: imagesInRange.filter((j) => ['completed', 'fallback'].includes(j.status)).length || Number(usage?.images) || 0,
		aiRequests: queueInRange.length + articlesInRange.length + imagesInRange.length,
		creditsUsed,
		creditsRemaining,
		wordpressPosts: wpPublished.length,
		wordpressDrafts: wpDrafts.length,
		wordpressFailures: wpFailed.length,
		pinterestPins: pinPublished.length,
		queueJobs: queueJobs.filter((j) => ['pending', 'queued', 'waiting', 'running', 'retrying'].includes(j.status)).length
			|| Number(usage?.queue_jobs) || 0,
		avgGenerationTime: formatDuration(avg(genDurations)),
		avgPublishTime: formatDuration(avg(publishDurations)),
		failureRate,
		mediaUploadSuccess: pct(
			wpJobs.filter((j) => j.wp_media_id || (Array.isArray(j.media_ids) && j.media_ids.length)).length,
			Math.max(wpJobs.length, 1),
		),
		boardsUsed: new Set(items.map((i) => i.boardId || i.boardName).filter(Boolean)).size || boards.length,
		retryRate: pct(
			pinJobs.filter((j) => Number(j.attempt_count) > 1).length + wpJobs.filter((j) => Number(j.attempt_count) > 1).length,
			Math.max(pinJobs.length + wpJobs.length, 1),
		),
		connectedAccounts: accounts.filter((a) => a.status === 'connected').length || accounts.length,
		connectedWebsites: websites.length,
	};

	const payload = {
		summary,
		items,
		charts: {
			dailyActivity: seriesFromMap(daily).slice(-14),
			monthlyActivity: seriesFromMap(monthly).slice(-6),
		},
		wordpress: {
			published: wpPublished.length,
			drafts: wpDrafts.length,
			failures: wpFailed.length,
			avgPublishTime: formatDuration(avg(wpHistory.map((r) => Number(r.duration_ms)).filter(Boolean))),
			mediaUploadSuccess: summary.mediaUploadSuccess,
		},
		pinterest: {
			published: pinPublished.length,
			scheduled: pinScheduled.length,
			failures: pinFailed.length,
			retryRate: summary.retryRate,
			boardsUsed: summary.boardsUsed,
		},
		queue: {
			jobs: summary.queueJobs,
			completed: queueJobs.filter((j) => j.status === 'completed').length,
			failed: queueJobs.filter((j) => j.status === 'failed').length,
			avgDuration: formatDuration(avg(queueJobs.map((j) => Number(j.duration_ms)).filter(Boolean))),
		},
		meta: {
			range: rangeKey,
			from: startIso,
			to: endIso,
			workspaceKey,
			cached: false,
			computedAt: new Date().toISOString(),
		},
	};

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
		const headers = ['id', 'title', 'status', 'board', 'websiteId', 'account', 'publishedAt', 'impressions', 'saves', 'clicks', 'closeups', 'url'];
		const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
		const lines = [headers.join(',')];
		for (const item of overview.items || []) {
			lines.push([
				item.id,
				item.pin?.title || '',
				item.status,
				item.boardName || item.boardId || '',
				item.websiteId || '',
				item.accountLabel || item.accountUsername || '',
				item.publishedAt || '',
				item.performance?.impressions ?? '',
				item.performance?.saves ?? '',
				item.performance?.outboundClicks ?? '',
				item.performance?.closeups ?? '',
				item.pinterestPinUrl || '',
			].map(escape).join(','));
		}
		return {
			contentType: 'text/csv;charset=utf-8',
			body: `${lines.join('\n')}\n`,
			filename: `workspace-analytics-${range || '30d'}.csv`,
		};
	}
	return {
		contentType: 'application/json',
		body: JSON.stringify(overview, null, 2),
		filename: `workspace-analytics-${range || '30d'}.json`,
	};
}
