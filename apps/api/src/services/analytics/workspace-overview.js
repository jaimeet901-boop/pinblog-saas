/**
 * Pure workspace analytics rollup (PR-17).
 * No PocketBase client — safe for unit tests.
 */
import {
	avg,
	bump,
	dayKey,
	formatDuration,
	inRange,
	monthLabel,
	pct,
	seriesFromMap,
} from './helpers.js';
import {
	buildFacebookAnalyticsSummary,
	mapFacebookAnalyticsJobItem,
} from '../facebook/analytics-rollup.js';
import { rollupWordpressPublishAnalytics } from '../wordpress-publish-analytics-rollup.js';

function jobStamp(job) {
	return job?.published_at || job?.scheduled_at || job?.updated || job?.created || null;
}

function isOpenScheduled(job) {
	const status = String(job?.status || '').toLowerCase();
	return status === 'scheduled' || status === 'publishing';
}

function isWordpressOpenScheduled(job) {
	if (isOpenScheduled(job)) return true;
	const wpStatus = String(job?.wp_status || '').toLowerCase();
	return wpStatus === 'scheduled' || wpStatus === 'future';
}

function performanceClicks(item) {
	return Number(item?.performance?.outboundClicks || item?.performance?.clicks || 0);
}

function performanceImpressions(item) {
	return Number(item?.performance?.impressions || 0);
}

export function workspaceAnalyticsItemTitle(item) {
	return String(item?.title || item?.pin?.title || item?.post?.title || '').trim();
}

export function workspaceAnalyticsItemUrl(item) {
	const channel = String(item?.channel || 'pinterest').toLowerCase();
	if (channel === 'facebook') {
		return String(item?.facebookPostUrl || item?.url || item?.destinationUrl || '').trim();
	}
	if (channel === 'wordpress') {
		return String(item?.wpPostUrl || item?.url || item?.destinationUrl || '').trim();
	}
	return String(item?.pinterestPinUrl || item?.url || item?.destinationUrl || '').trim();
}

export function workspaceAnalyticsItemDestination(item) {
	return String(
		item?.destinationLabel || item?.boardName || item?.boardId || item?.pageName || '',
	).trim();
}

export function mapPinterestWorkspaceAnalyticsItem(job = {}) {
	const pin = job.expand?.ai_pin || null;
	const account = job.expand?.account || null;
	const title = pin?.title || '';
	const url = job.pinterest_pin_url || '';
	return {
		id: job.id,
		channel: 'pinterest',
		status: job.status,
		websiteId: job.websiteId || pin?.websiteId || '',
		articleId: job.articleId || pin?.articleId || '',
		accountId: job.account || account?.id || '',
		accountLabel: job.account_label || account?.label || account?.account_name || '',
		accountUsername: job.account_username || account?.username || '',
		boardId: job.board_id || '',
		boardName: job.board_name || '',
		destinationLabel: job.board_name || job.board_id || '',
		destinationKind: 'board',
		scheduledAt: job.scheduled_at || null,
		publishedAt: job.published_at || null,
		createdAt: job.created,
		updatedAt: job.updated,
		pinterestPinId: job.pinterest_pin_id || '',
		pinterestPinUrl: url,
		facebookPostUrl: '',
		wpPostUrl: '',
		url,
		title,
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
		post: null,
	};
}

export function mapFacebookWorkspaceAnalyticsItem(job = {}) {
	const pin = job.expand?.ai_pin || null;
	const mapped = mapFacebookAnalyticsJobItem(job, pin);
	const title = mapped.post?.title || mapped.title || '';
	const url = mapped.facebookPostUrl || mapped.destinationUrl || '';
	const clicks = mapped.performance?.clicks ?? mapped.performance?.outboundClicks ?? null;
	return {
		...mapped,
		channel: 'facebook',
		websiteId: job.websiteId || pin?.websiteId || pin?.website_id || '',
		articleId: job.articleId || job.article_id || pin?.articleId || '',
		accountLabel: mapped.pageName || job.account_label || '',
		accountUsername: '',
		boardId: mapped.pageId || '',
		boardName: mapped.pageName || '',
		destinationLabel: mapped.pageName || '',
		destinationKind: 'page',
		createdAt: job.created || mapped.createdAt || null,
		updatedAt: job.updated || mapped.updatedAt || null,
		pinterestPinId: '',
		pinterestPinUrl: '',
		wpPostUrl: '',
		url,
		title,
		pin: mapped.post
			? {
				id: mapped.post.id,
				title: mapped.post.title || '',
				description: mapped.post.description || '',
				imageUrl: mapped.post.imageUrl || '',
				status: mapped.post.status || '',
				destinationUrl: mapped.destinationUrl || '',
			}
			: null,
		performance: {
			impressions: mapped.performance?.impressions ?? null,
			saves: null,
			outboundClicks: clicks,
			clicks,
			closeups: null,
			engagedUsers: mapped.performance?.engagedUsers ?? null,
			reactions: mapped.performance?.reactions ?? null,
		},
	};
}

export function mapWordpressWorkspaceAnalyticsItem(job = {}) {
	const site = job.expand?.site || null;
	const title = job.title || 'WordPress post';
	const url = job.wp_post_url || job.published_url || '';
	const destinationLabel = site?.name || site?.url || site?.domain || '';
	return {
		id: job.id,
		channel: 'wordpress',
		status: job.status,
		websiteId: job.website_id || job.websiteId || site?.websiteId || site?.website_id || '',
		articleId: job.article_id || job.articleId || '',
		accountId: '',
		accountLabel: destinationLabel,
		accountUsername: '',
		boardId: job.site || '',
		boardName: destinationLabel || job.site || '',
		destinationLabel,
		destinationKind: 'website',
		scheduledAt: job.scheduled_at || null,
		publishedAt: job.published_at || job.completed_at || null,
		createdAt: job.created,
		updatedAt: job.updated,
		pinterestPinId: '',
		pinterestPinUrl: '',
		facebookPostUrl: '',
		wpPostUrl: url,
		url,
		title,
		destinationUrl: url,
		performance: {},
		pin: {
			id: job.id,
			title,
			description: job.excerpt || '',
			imageUrl: job.featured_image_url || '',
			status: job.status || '',
			destinationUrl: url,
		},
		post: null,
	};
}

export function toWorkspaceAnalyticsCsv(items = []) {
	const headers = [
		'id',
		'channel',
		'title',
		'status',
		'destination',
		'websiteId',
		'account',
		'publishedAt',
		'impressions',
		'saves',
		'clicks',
		'closeups',
		'url',
	];
	const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
	const lines = [headers.join(',')];
	for (const item of items) {
		const clicks = item?.performance?.outboundClicks ?? item?.performance?.clicks;
		lines.push([
			item.id,
			item.channel || 'pinterest',
			workspaceAnalyticsItemTitle(item),
			item.status,
			workspaceAnalyticsItemDestination(item),
			item.websiteId || '',
			item.accountLabel || item.accountUsername || '',
			item.publishedAt || '',
			item.performance?.impressions ?? '',
			item.performance?.saves ?? '',
			clicks ?? '',
			item.performance?.closeups ?? '',
			workspaceAnalyticsItemUrl(item),
		].map(escape).join(','));
	}
	return `${lines.join('\n')}\n`;
}

export function assembleWorkspaceOverviewFromSources({
	articles = [],
	imageJobs = [],
	queueJobs = [],
	pinJobs = [],
	pinHistory = [],
	wpHistory = [],
	wpJobs = [],
	facebookJobs = [],
	creditsTx = [],
	subscription = null,
	usage = null,
	websites = [],
	accounts = [],
	boards = [],
	aiPins = [],
	start,
	end,
	rangeKey = '30d',
	startIso = '',
	endIso = '',
	workspaceKey = '',
} = {}) {
	const articlesInRange = articles.filter((row) => inRange(row.created, start, end));
	const imagesInRange = imageJobs.filter((row) => inRange(row.created || row.completed_at, start, end));
	const queueInRange = queueJobs.filter((row) => inRange(row.created, start, end));
	const burns = creditsTx.filter((row) => (row.type === 'burn' || Number(row.amount) < 0) && inRange(row.created, start, end));
	const creditsUsed = burns.reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0);
	const creditsRemaining = Number(subscription?.credits_balance) || 0;

	const pinJobsInRange = pinJobs.filter((job) => inRange(jobStamp(job), start, end));
	const pinPublished = pinJobsInRange.filter((job) => job.status === 'published');
	const pinFailed = pinJobsInRange.filter((job) => job.status === 'failed');
	const pinScheduled = pinJobs.filter(isOpenScheduled);
	const draftPins = aiPins.filter((pin) => pin.status === 'draft').length;

	const facebookJobsInRange = facebookJobs.filter((job) => inRange(jobStamp(job), start, end));
	const facebookPublished = facebookJobsInRange.filter((job) => job.status === 'published');
	const facebookFailed = facebookJobsInRange.filter((job) => job.status === 'failed');
	const facebookScheduled = facebookJobs.filter(isOpenScheduled);

	const wpHistoryInRange = wpHistory.filter((row) => inRange(row.published_at || row.created, start, end));
	const wpFailedJobs = wpJobs.filter((job) => job.status === 'failed' && inRange(jobStamp(job), start, end));
	const wpRollup = rollupWordpressPublishAnalytics(wpHistoryInRange, wpFailedJobs);
	const wpOpenScheduled = wpJobs.filter(isWordpressOpenScheduled);
	const wpDrafts = wpJobs.filter((job) => job.wp_status === 'draft' || job.status === 'queued');

	const genDurations = [
		...imageJobs.map((job) => Number(job.duration_ms)).filter(Boolean),
		...queueJobs.filter((job) => String(job.type || '').includes('article') || String(job.type || '').includes('image')).map((job) => Number(job.duration_ms)).filter(Boolean),
	];
	const publishDurations = [
		...pinHistory.map((job) => Number(job.duration_ms)).filter(Boolean),
		...wpHistory.map((job) => Number(job.duration_ms)).filter(Boolean),
		...pinPublished.filter((job) => job.created && job.published_at).map((job) => new Date(job.published_at) - new Date(job.created)).filter((ms) => ms > 0),
	];

	const publishedCount = pinPublished.length + facebookPublished.length + wpRollup.published;
	const failedCount = pinFailed.length + facebookFailed.length + wpRollup.failed;
	const scheduledCount = pinScheduled.length + facebookScheduled.length + wpOpenScheduled.length;
	const decided = publishedCount + failedCount;
	const failureRate = pct(failedCount, decided || 1);
	const successRate = decided > 0 ? pct(publishedCount, decided) : null;

	const daily = new Map();
	const monthly = new Map();
	for (const item of [...pinJobs, ...facebookJobs, ...wpJobs, ...articlesInRange]) {
		const stamp = item.published_at || item.created;
		if (!stamp || !inRange(stamp, start, end)) continue;
		bump(daily, dayKey(stamp));
		const date = new Date(stamp);
		bump(monthly, `${monthLabel(date)} ${date.getFullYear()}`);
	}

	const items = [
		...pinJobs.map(mapPinterestWorkspaceAnalyticsItem),
		...facebookJobs.map(mapFacebookWorkspaceAnalyticsItem),
		...wpJobs.map(mapWordpressWorkspaceAnalyticsItem),
	];

	const pinterestItems = items.filter((item) => item.channel === 'pinterest');
	const facebookSummary = buildFacebookAnalyticsSummary(facebookPublished, {
		failed: facebookFailed.length,
		scheduled: facebookScheduled.length,
	});

	const summary = {
		published: publishedCount,
		failed: failedCount,
		scheduled: scheduledCount,
		draftPins,
		clicks: items.reduce((sum, item) => sum + performanceClicks(item), 0),
		saves: items.reduce((sum, item) => sum + (Number(item.performance?.saves) || 0), 0),
		impressions: items.reduce((sum, item) => sum + performanceImpressions(item), 0),
		bestBoard: boards[0]?.name || pinterestItems.find((item) => item.boardName)?.boardName || '—',
		bestPin: pinPublished[0]?.expand?.ai_pin?.title || pinterestItems.find((item) => item.pin?.title)?.pin?.title || '—',
		articlesGenerated: articlesInRange.length || Number(usage?.articles) || 0,
		imagesGenerated: imagesInRange.filter((job) => ['completed', 'fallback'].includes(job.status)).length || Number(usage?.images) || 0,
		aiRequests: queueInRange.length + articlesInRange.length + imagesInRange.length,
		creditsUsed,
		creditsRemaining,
		wordpressPosts: wpRollup.published,
		wordpressDrafts: wpDrafts.length,
		wordpressFailures: wpRollup.failed,
		pinterestPins: pinPublished.length,
		facebookPosts: facebookPublished.length,
		queueJobs: queueJobs.filter((job) => ['pending', 'queued', 'waiting', 'running', 'retrying'].includes(job.status)).length
			|| Number(usage?.queue_jobs) || 0,
		avgGenerationTime: formatDuration(avg(genDurations)),
		avgPublishTime: formatDuration(avg(publishDurations)),
		failureRate,
		successRate,
		mediaUploadSuccess: pct(
			wpJobs.filter((job) => job.wp_media_id || (Array.isArray(job.media_ids) && job.media_ids.length)).length,
			Math.max(wpJobs.length, 1),
		),
		boardsUsed: new Set(pinterestItems.map((item) => item.boardId || item.boardName).filter(Boolean)).size || boards.length,
		retryRate: pct(
			pinJobs.filter((job) => Number(job.attempt_count) > 1).length
				+ facebookJobs.filter((job) => Number(job.attempt_count) > 1).length
				+ wpJobs.filter((job) => Number(job.attempt_count) > 1).length,
			Math.max(pinJobs.length + facebookJobs.length + wpJobs.length, 1),
		),
		connectedAccounts: accounts.filter((account) => account.status === 'connected').length || accounts.length,
		connectedWebsites: websites.length,
	};

	return {
		summary,
		items,
		charts: {
			dailyActivity: seriesFromMap(daily).slice(-14),
			monthlyActivity: seriesFromMap(monthly).slice(-6),
		},
		wordpress: {
			published: wpRollup.published,
			drafts: wpRollup.drafts,
			scheduled: wpOpenScheduled.length,
			failures: wpRollup.failed,
			avgPublishTime: formatDuration(avg(wpHistory.map((row) => Number(row.duration_ms)).filter(Boolean))),
			mediaUploadSuccess: summary.mediaUploadSuccess,
		},
		pinterest: {
			published: pinPublished.length,
			scheduled: pinScheduled.length,
			failures: pinFailed.length,
			drafts: draftPins,
			retryRate: summary.retryRate,
			boardsUsed: summary.boardsUsed,
		},
		facebook: facebookSummary,
		queue: {
			jobs: summary.queueJobs,
			completed: queueJobs.filter((job) => job.status === 'completed').length,
			failed: queueJobs.filter((job) => job.status === 'failed').length,
			avgDuration: formatDuration(avg(queueJobs.map((job) => Number(job.duration_ms)).filter(Boolean))),
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
}
