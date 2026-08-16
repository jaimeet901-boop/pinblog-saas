/**
 * Aggregates real PocketBase / service data for Website Manager cards
 * and the per-website control dashboard. No synthetic metrics.
 */
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { ensureWebsiteArticlesSchema } from '../utils/ensure-website-articles-schema.js';
import { countWebsiteArticles } from './website-article-discovery.js';
import { listWordpressSites } from './wordpress-sites.js';
import { getWordpressPublishAnalytics, listPublishHistory, listPublishJobs } from './wordpress-publish.js';
import { listWordpressApiLogs } from './wordpress-api-log.js';
import { listProviders, isTextOrientedProvider, isImageOrientedProvider } from './ai-providers.js';
import { getUserCreditUsage } from './ai-pin-credits.js';
import { getWordpressQueueStats } from './wordpress-publish-queue.js';
import { getPlatformSettings } from './platform-settings.js';
import { getOwnedUserSettings, mapSettingsResponse } from './user-settings.js';
import logger from '../utils/logger.js';

const PENDING_JOB_STATUSES = new Set([
	'pending',
	'queued',
	'waiting',
	'waiting_provider',
	'retrying',
	'running',
	'scheduled',
	'publishing',
	'processing',
]);

function toneFromStatus(status) {
	const value = String(status || '').toLowerCase();
	if (['connected', 'active', 'ready', 'healthy', 'operational', 'ok', 'published', 'completed', 'available'].includes(value)) {
		return 'green';
	}
	if (['failed', 'error', 'down', 'disconnected', 'not_configured', 'unavailable'].includes(value)) {
		return 'red';
	}
	if (['running', 'scanning', 'queued', 'pending', 'degraded', 'scheduled', 'paused', 'untested', 'idle', 'configured'].includes(value)) {
		return 'amber';
	}
	return 'default';
}

function indicator(label, status, detail = '') {
	return {
		label,
		status: status || 'unknown',
		tone: toneFromStatus(status),
		detail: detail || '',
	};
}

async function resolveArticlesSchema() {
	const ensured = await ensureWebsiteArticlesSchema(pocketbaseClient);
	return {
		websiteField: ensured.websiteField,
		statusField: ensured.statusField,
	};
}

async function safeCount(collection, filter) {
	const result = await pocketbaseClient.collection(collection).getList(1, 1, {
		filter,
		requestKey: null,
	}).catch(() => ({ totalItems: 0 }));
	return Number(result.totalItems) || 0;
}

async function safeList(collection, filter, { page = 1, perPage = 20, sort = '-created' } = {}) {
	return pocketbaseClient.collection(collection).getList(page, perPage, {
		filter,
		sort,
		requestKey: null,
	}).catch(() => ({ items: [], totalItems: 0 }));
}

function matchWordpressSite(wpSites, websiteId) {
	const id = String(websiteId || '');
	return (wpSites || []).find((site) => String(site.websiteId || '') === id) || null;
}

function restApiStatusFromWp(wpSite, website) {
	if (!wpSite) {
		if (website?.has_wp_app_password || website?.wp_username) {
			return { status: 'untested', detail: 'Credentials present; connection not tested yet' };
		}
		return { status: 'not_configured', detail: 'WordPress credentials not configured' };
	}
	const health = wpSite.health || {};
	if (health.restApi === true || health.restApi === 'ok') {
		return { status: 'ok', detail: health.version ? `WP ${health.version}` : 'REST API reachable' };
	}
	if (wpSite.status === 'connected') {
		return { status: 'ok', detail: wpSite.wpVersion ? `WP ${wpSite.wpVersion}` : 'Connected' };
	}
	if (wpSite.status === 'failed' || wpSite.lastError) {
		return { status: 'failed', detail: wpSite.lastError || 'REST API check failed' };
	}
	if (wpSite.hasCredentials) {
		return { status: 'untested', detail: 'Credentials saved; awaiting test' };
	}
	return { status: 'not_configured', detail: 'WordPress site link missing credentials' };
}

function connectionStatusFromWp(wpSite, website) {
	if (wpSite?.status === 'connected' || website?.status === 'connected') {
		return { status: 'connected', detail: wpSite?.lastTestedAt ? `Last tested ${wpSite.lastTestedAt}` : '' };
	}
	if (wpSite?.status === 'failed' || website?.status === 'failed') {
		return { status: 'failed', detail: wpSite?.lastError || 'Connection failed' };
	}
	if (wpSite?.hasCredentials || website?.has_wp_app_password) {
		return { status: 'configured', detail: 'Credentials saved' };
	}
	return { status: 'not_configured', detail: 'No WordPress credentials' };
}

async function articleStatsForWebsite(websiteId, schema) {
	const websiteFilter = pocketbaseClient.filter(`${schema.websiteField} = {:websiteId}`, { websiteId });
	const collection = await pocketbaseClient.collections.getOne('website_articles').catch(() => null);
	const fields = new Set((collection?.fields || collection?.schema || []).map((field) => field.name));
	const hasField = (name) => fields.size === 0 || fields.has(name);

	const countIf = async (enabled, filter) => {
		if (!enabled) return null;
		return safeCount('website_articles', filter);
	};

	const [
		totalArticles,
		newArticles,
		publishedArticles,
		importedArticles,
		missingFeaturedImage,
		missingSeoTitle,
		missingMetaDescription,
		missingCategory,
		missingTags,
	] = await Promise.all([
		countWebsiteArticles({
			pocketbaseClient,
			websiteId,
			websiteField: schema.websiteField,
		}),
		countWebsiteArticles({
			pocketbaseClient,
			websiteId,
			websiteField: schema.websiteField,
			statusField: schema.statusField,
			status: 'new',
		}),
		countWebsiteArticles({
			pocketbaseClient,
			websiteId,
			websiteField: schema.websiteField,
			statusField: schema.statusField,
			status: 'published',
		}),
		countWebsiteArticles({
			pocketbaseClient,
			websiteId,
			websiteField: schema.websiteField,
			statusField: schema.statusField,
			status: 'imported',
		}),
		countIf(hasField('featured_image'), `${websiteFilter} && featured_image = ""`),
		countIf(hasField('title'), `${websiteFilter} && title = ""`),
		countIf(hasField('meta_description'), `${websiteFilter} && meta_description = ""`),
		countIf(hasField('category'), `${websiteFilter} && category = ""`),
		// tags is JSON in schema — empty-string filters are unreliable, so do not invent a count.
		Promise.resolve(hasField('tags') ? null : null),
	]);

	return {
		totalArticles: totalArticles || 0,
		newArticles: newArticles || 0,
		readyArticles: newArticles || 0,
		draftArticles: newArticles || 0,
		publishedArticles: publishedArticles || 0,
		importedArticles: importedArticles || 0,
		missingFeaturedImage,
		missingSeoTitle,
		missingMetaDescription,
		missingCategory,
		missingTags: null,
		missingAltText: null,
		brokenImages: null,
		brokenLinks: null,
		lastScan: '',
		nextScheduledScan: '',
	};
}

async function pinAndJobStatsForWebsite(ownerId, websiteId, wpSiteId) {
	const websiteFilter = pocketbaseClient.filter('owner = {:owner} && websiteId = {:websiteId}', {
		owner: ownerId,
		websiteId,
	});

	const [
		aiPinsTotal,
		publishedPinJobs,
		pendingPinJobs,
		failedPinJobs,
		retryingPinJobs,
		pendingQueueJobs,
		failedQueueJobs,
		scheduledPinJobs,
		wpJobs,
		wpSyncCount,
		latestPublishedJob,
		latestGeneratedPin,
		latestGeneratedImage,
		draftPins,
	] = await Promise.all([
		safeCount('ai_pins', websiteFilter),
		safeCount(
			'pinterest_publish_jobs',
			pocketbaseClient.filter('owner = {:owner} && websiteId = {:websiteId} && status = "published"', {
				owner: ownerId,
				websiteId,
			}),
		),
		safeCount(
			'pinterest_publish_jobs',
			pocketbaseClient.filter(
				'owner = {:owner} && websiteId = {:websiteId} && (status = "pending" || status = "queued" || status = "scheduled" || status = "publishing" || status = "waiting_provider")',
				{ owner: ownerId, websiteId },
			),
		),
		safeCount(
			'pinterest_publish_jobs',
			pocketbaseClient.filter('owner = {:owner} && websiteId = {:websiteId} && status = "failed"', {
				owner: ownerId,
				websiteId,
			}),
		),
		safeCount(
			'pinterest_publish_jobs',
			pocketbaseClient.filter('owner = {:owner} && websiteId = {:websiteId} && status = "retrying"', {
				owner: ownerId,
				websiteId,
			}),
		),
		safeCount(
			'queue_jobs',
			pocketbaseClient.filter(
				'owner = {:owner} && websiteId = {:websiteId} && (status = "pending" || status = "queued" || status = "waiting" || status = "waiting_provider" || status = "retrying" || status = "running")',
				{ owner: ownerId, websiteId },
			),
		),
		safeCount(
			'queue_jobs',
			pocketbaseClient.filter('owner = {:owner} && websiteId = {:websiteId} && status = "failed"', {
				owner: ownerId,
				websiteId,
			}),
		),
		safeList(
			'pinterest_publish_jobs',
			pocketbaseClient.filter(
				'owner = {:owner} && websiteId = {:websiteId} && (status = "scheduled" || status = "publishing")',
				{ owner: ownerId, websiteId },
			),
			{ perPage: 20, sort: 'scheduled_at' },
		),
		wpSiteId
			? pocketbaseClient.collection('publish_jobs').getFullList({
				filter: pocketbaseClient.filter('owner = {:owner} && site = {:site}', {
					owner: ownerId,
					site: wpSiteId,
				}),
				requestKey: null,
			}).catch(() => [])
			: Promise.resolve([]),
		wpSiteId
			? safeCount(
				'wordpress_sync_runs',
				pocketbaseClient.filter('owner = {:owner} && site = {:site}', {
					owner: ownerId,
					site: wpSiteId,
				}),
			)
			: Promise.resolve(null),
		safeList(
			'pinterest_publish_jobs',
			pocketbaseClient.filter('owner = {:owner} && websiteId = {:websiteId} && status = "published"', {
				owner: ownerId,
				websiteId,
			}),
			{ perPage: 1, sort: '-published_at' },
		),
		safeList('ai_pins', websiteFilter, { perPage: 1, sort: '-created' }),
		safeList('ai_pins', `${websiteFilter} && image_url != ""`, { perPage: 1, sort: '-updated' }),
		safeList(
			'ai_pins',
			pocketbaseClient.filter(
				'owner = {:owner} && websiteId = {:websiteId} && (status = "draft" || status = "failed")',
				{ owner: ownerId, websiteId },
			),
			{ perPage: 25, sort: '-updated' },
		),
	]);

	const publishedPinCount = publishedPinJobs || 0;
	const wpPending = (wpJobs || []).filter((job) => PENDING_JOB_STATUSES.has(String(job.status || ''))).length;
	const wpFailed = (wpJobs || []).filter((job) => job.status === 'failed').length;
	const wpPublished = (wpJobs || []).filter((job) => job.status === 'published').length;
	const wpScheduled = (wpJobs || []).filter((job) => (
		job.status === 'scheduled'
		|| (job.status === 'published' && (job.wp_status === 'future' || Boolean(job.scheduled_at)))
	));
	const lastWpPublish = (wpJobs || [])
		.filter((job) => job.status === 'published' || job.wp_post_url)
		.sort((a, b) => new Date(b.completed_at || b.updated || b.created || 0) - new Date(a.completed_at || a.updated || a.created || 0))[0]
		|| null;

	const completedWithDuration = (wpJobs || []).filter((job) => {
		const start = job.started_at ? new Date(job.started_at).getTime() : NaN;
		const end = job.completed_at ? new Date(job.completed_at).getTime() : NaN;
		return Number.isFinite(start) && Number.isFinite(end) && end >= start;
	});
	const avgPublishTimeMs = completedWithDuration.length
		? Math.round(completedWithDuration.reduce((sum, job) => {
			const start = new Date(job.started_at).getTime();
			const end = new Date(job.completed_at).getTime();
			return sum + (end - start);
		}, 0) / completedWithDuration.length)
		: null;

	const attempts = publishedPinCount + (failedPinJobs || 0) + wpPublished + wpFailed;
	const successes = publishedPinCount + wpPublished;
	const successRate = attempts > 0
		? Math.round((successes / attempts) * 1000) / 10
		: null;

	const lastPublishRow = (latestPublishedJob.items || [])[0] || null;
	const lastGeneratedPin = (latestGeneratedPin.items || [])[0] || null;
	const lastGeneratedImageRow = (latestGeneratedImage.items || [])[0] || null;
	const generatedImages = Number(latestGeneratedImage.totalItems) || 0;

	return {
		publishedPins: publishedPinCount || 0,
		failedPins: failedPinJobs || 0,
		aiPinsTotal: aiPinsTotal || 0,
		generatedImages,
		pendingJobs: (pendingPinJobs || 0) + wpPending + (pendingQueueJobs || 0),
		failedJobs: (failedPinJobs || 0) + wpFailed + (failedQueueJobs || 0),
		retryingJobs: retryingPinJobs || 0,
		queuePending: pendingQueueJobs || 0,
		queueFailed: failedQueueJobs || 0,
		wpJobCount: (wpJobs || []).length,
		wpPublished,
		wpFailed,
		wpSyncs: wpSyncCount,
		lastWpPublishAt: lastWpPublish?.completed_at || lastWpPublish?.updated || lastWpPublish?.created || '',
		lastWpPublishTitle: lastWpPublish?.title || '',
		avgPublishTimeMs,
		successRate,
		lastPublishAt: lastPublishRow?.published_at || lastPublishRow?.updated || '',
		lastPublishTitle: lastPublishRow?.title || '',
		lastGeneratedAt: lastGeneratedPin?.created || '',
		lastGeneratedTitle: lastGeneratedPin?.title || '',
		lastGeneratedImageAt: lastGeneratedImageRow?.updated || lastGeneratedImageRow?.created || '',
		lastGeneratedImageUrl: lastGeneratedImageRow?.image_url || '',
		scheduledPinJobs: scheduledPinJobs.items || [],
		wpScheduledJobs: wpScheduled,
		draftPins: (draftPins.items || []).map((pin) => ({
			id: pin.id,
			title: pin.title || '',
			status: pin.status || '',
			imageUrl: pin.image_url || '',
		})),
	};
}

function scoreLabel(score) {
	if (score >= 85) return 'Excellent';
	if (score >= 70) return 'Good';
	if (score >= 40) return 'Warning';
	return 'Critical';
}

function scoreTone(label) {
	if (label === 'Excellent' || label === 'Good') return 'green';
	if (label === 'Warning') return 'amber';
	return 'red';
}

function computeWebsiteScore({ health, jobStats, indicators, website }) {
	let score = 0;
	const breakdown = [];

	const wpStatus = health.wordpressConnection?.status;
	let wpPts = 0;
	if (wpStatus === 'connected') wpPts = 20;
	else if (wpStatus === 'configured') wpPts = 10;
	else if (wpStatus === 'untested') wpPts = 5;
	score += wpPts;
	breakdown.push({ key: 'wordpressConnection', points: wpPts, max: 20 });

	const restStatus = health.restApi?.status;
	let restPts = 0;
	if (restStatus === 'ok') restPts = 15;
	else if (restStatus === 'untested') restPts = 5;
	score += restPts;
	breakdown.push({ key: 'restApi', points: restPts, max: 15 });

	let scanPts = 0;
	if (website.last_scan_at) {
		const ageMs = Date.now() - new Date(website.last_scan_at).getTime();
		const ageDays = Number.isFinite(ageMs) ? ageMs / (1000 * 60 * 60 * 24) : Infinity;
		if (website.discovery_status === 'failed') scanPts = 0;
		else if (ageDays <= 7) scanPts = 15;
		else if (ageDays <= 30) scanPts = 8;
		else scanPts = 4;
	}
	score += scanPts;
	breakdown.push({ key: 'lastSuccessfulScan', points: scanPts, max: 15 });

	const pending = Number(jobStats.pendingJobs) || 0;
	let pendingPts = 10;
	if (pending >= 20) pendingPts = 0;
	else if (pending >= 10) pendingPts = 3;
	else if (pending >= 1) pendingPts = 6;
	score += pendingPts;
	breakdown.push({ key: 'pendingJobs', points: pendingPts, max: 10 });

	const failed = Number(jobStats.failedJobs) || 0;
	let failedPts = 15;
	if (failed > 3) failedPts = 0;
	else if (failed >= 1) failedPts = 5;
	score += failedPts;
	breakdown.push({ key: 'failedJobs', points: failedPts, max: 15 });

	const pinStatus = indicators?.pinterestConnection?.status;
	let pinPts = 0;
	if (pinStatus === 'connected') pinPts = 15;
	else if (pinStatus === 'configured') pinPts = 5;
	score += pinPts;
	breakdown.push({ key: 'pinterestConnection', points: pinPts, max: 15 });

	const aiStatus = indicators?.imageGeneration?.status;
	let aiPts = 0;
	if (aiStatus === 'available') aiPts = 10;
	score += aiPts;
	breakdown.push({ key: 'imageGeneration', points: aiPts, max: 10 });

	const clamped = Math.max(0, Math.min(100, Math.round(score)));
	const label = scoreLabel(clamped);
	return {
		score: clamped,
		label,
		tone: scoreTone(label),
		breakdown,
	};
}

function buildContentOverview(articleStats) {
	return {
		totalArticles: articleStats.totalArticles || 0,
		readyForPins: articleStats.readyArticles || 0,
		alreadyPublished: articleStats.publishedArticles || 0,
		missingFeaturedImage: articleStats.missingFeaturedImage,
		missingSeoTitle: articleStats.missingSeoTitle,
		missingMetaDescription: articleStats.missingMetaDescription,
		missingCategory: articleStats.missingCategory,
		missingTags: articleStats.missingTags,
	};
}

function buildPerformance(jobStats, articleStats) {
	const totalGenerated = (articleStats?.totalArticles || 0) + (jobStats.aiPinsTotal || 0) + (jobStats.generatedImages || 0);
	const totalPublished = (articleStats?.publishedArticles || 0) + (jobStats.publishedPins || 0) + (jobStats.wpPublished || 0);
	return {
		totalAiPinsGenerated: jobStats.aiPinsTotal || 0,
		totalPublishedPins: jobStats.publishedPins || 0,
		totalGeneratedContent: totalGenerated,
		totalPublished,
		successRate: jobStats.successRate,
		avgPublishTimeMs: jobStats.avgPublishTimeMs,
		lastPublishAt: jobStats.lastPublishAt || '',
		lastPublishTitle: jobStats.lastPublishTitle || '',
		lastGeneratedImageAt: jobStats.lastGeneratedImageAt || '',
		lastGeneratedImageUrl: jobStats.lastGeneratedImageUrl || '',
		lastGeneratedAt: jobStats.lastGeneratedAt || '',
		lastGeneratedTitle: jobStats.lastGeneratedTitle || '',
		lastAiGenerationAt: jobStats.lastGeneratedAt || '',
		lastPinGenerationAt: jobStats.lastGeneratedAt || '',
		lastImageGenerationAt: jobStats.lastGeneratedImageAt || '',
	};
}

function buildStatsBlock(articleStats, jobStats, website) {
	return {
		totalArticles: articleStats.totalArticles || 0,
		generatedArticles: articleStats.totalArticles || 0,
		publishedArticles: articleStats.publishedArticles || 0,
		draftArticles: articleStats.draftArticles || articleStats.newArticles || 0,
		readyArticles: articleStats.readyArticles || 0,
		generatedPins: jobStats.aiPinsTotal || 0,
		publishedPins: jobStats.publishedPins || 0,
		generatedImages: jobStats.generatedImages || 0,
		trafficImports: articleStats.importedArticles || 0,
		wordpressSyncs: jobStats.wpSyncs,
		failedJobs: jobStats.failedJobs || 0,
		readyToPublish: (jobStats.draftPins || []).length,
		pendingJobs: jobStats.pendingJobs || 0,
		newArticles: articleStats.newArticles || 0,
		lastScan: website.last_scan_at || '',
		nextScheduledScan: website.next_scan_at || '',
	};
}

function statusLabel(ok, good, bad) {
	return ok ? good : bad;
}

function buildWordpressStatus({ website, wpSite, jobStats }) {
	const connection = connectionStatusFromWp(wpSite, website);
	const restApi = restApiStatusFromWp(wpSite, website);
	const hasUsername = Boolean(String(website?.wp_username || wpSite?.username || '').trim());
	const hasAppPassword = Boolean(website?.has_wp_app_password || wpSite?.hasCredentials);
	const credentialsOk = hasUsername && hasAppPassword;

	return {
		connection: {
			status: connection.status,
			tone: toneFromStatus(connection.status),
			label: statusLabel(connection.status === 'connected', 'Connected', connection.status === 'configured' ? 'Configured' : 'Not Connected'),
			detail: connection.detail || '',
		},
		restApi: {
			status: restApi.status,
			tone: toneFromStatus(restApi.status === 'ok' ? 'connected' : restApi.status),
			label: statusLabel(restApi.status === 'ok', 'REST API', restApi.status === 'untested' ? 'REST API Untested' : 'REST API Missing'),
			detail: restApi.detail || '',
		},
		credentials: {
			status: credentialsOk ? 'configured' : 'not_configured',
			tone: credentialsOk ? 'green' : 'red',
			label: credentialsOk ? 'Credentials Saved' : 'Credentials Missing',
			detail: credentialsOk
				? 'WordPress username and application password are saved.'
				: 'WordPress credentials are missing. Configure them in Website Settings.',
		},
		applicationPassword: {
			status: hasAppPassword ? 'configured' : 'not_configured',
			tone: hasAppPassword ? 'green' : 'red',
			label: hasAppPassword ? 'Application Password' : 'Application Password Missing',
			detail: hasAppPassword
				? 'Application password is configured.'
				: 'Add an application password in Website Settings.',
		},
		lastPublishAt: jobStats.lastWpPublishAt || '',
		lastPublishTitle: jobStats.lastWpPublishTitle || '',
		lastSyncAt: wpSite?.lastSyncedAt || '',
		wpVersion: wpSite?.wpVersion || wpSite?.health?.version || '',
		needsConfiguration: !credentialsOk,
		configureHint: !credentialsOk
			? 'WordPress credentials are missing. Configure them in Website Settings.'
			: '',
	};
}

function buildPinterestStatus({ workspaceIndicators, publishTarget, jobStats, pinterestMeta }) {
	const connection = workspaceIndicators?.pinterestConnection || indicator('Pinterest', 'not_configured');
	const connected = String(connection.status || '').toLowerCase() === 'connected';
	const accountLabel = pinterestMeta?.accountName || connection.detail || '';
	const boardLabel = pinterestMeta?.boardName || '';
	return {
		account: {
			status: connected ? 'connected' : (connection.status || 'not_configured'),
			tone: connected ? 'green' : 'red',
			label: connected && accountLabel ? accountLabel : (connected ? 'Connected' : 'Not configured'),
			detail: connected
				? 'Pinterest account is connected.'
				: 'Connect a Pinterest account in Pinterest settings.',
		},
		defaultBoard: {
			status: boardLabel ? 'configured' : 'not_configured',
			tone: boardLabel ? 'green' : 'amber',
			label: boardLabel || 'Not configured',
			detail: boardLabel
				? 'A default board is selected for publishing.'
				: 'Choose a default board in Pinterest settings.',
		},
		api: {
			status: connected ? 'ok' : 'not_configured',
			tone: connected ? 'green' : 'red',
			label: connected ? 'API Ready' : 'Not configured',
			detail: connected ? 'Pinterest API access is available.' : 'Pinterest API is not ready yet.',
		},
		lastPublishAt: jobStats.lastPublishAt || '',
		publishedPins: jobStats.publishedPins || 0,
		failedPins: jobStats.failedPins || 0,
		needsConfiguration: !connected,
		configureHint: !connected
			? 'Pinterest is not connected. Connect an account in Pinterest settings.'
			: '',
	};
}

function buildAiConfiguration(aiDefaults) {
	return {
		language: aiDefaults?.language || null,
		country: aiDefaults?.country || null,
		tone: aiDefaults?.tone || null,
		defaultPromptPreview: aiDefaults?.promptPreview || null,
		textReady: Boolean(aiDefaults?.textReady),
		imageReady: Boolean(aiDefaults?.imageReady),
		editHref: '/app/settings',
	};
}

function buildSeoHealth(articleStats) {
	const rows = [
		{ key: 'missingFeaturedImages', label: 'Missing Featured Images', count: articleStats.missingFeaturedImage },
		{ key: 'missingSeoTitles', label: 'Missing SEO Titles', count: articleStats.missingSeoTitle },
		{ key: 'missingMetaDescriptions', label: 'Missing Meta Descriptions', count: articleStats.missingMetaDescription },
		{ key: 'missingAltText', label: 'Missing ALT Text', count: articleStats.missingAltText },
		{ key: 'articlesWithoutCategories', label: 'Articles without Categories', count: articleStats.missingCategory },
		{ key: 'articlesWithoutTags', label: 'Articles without Tags', count: articleStats.missingTags },
		{ key: 'brokenImages', label: 'Broken Images', count: articleStats.brokenImages },
		{ key: 'brokenLinks', label: 'Broken Links', count: articleStats.brokenLinks },
	];
	return {
		items: rows.map((row) => {
			const available = row.count != null && Number.isFinite(Number(row.count));
			return {
				...row,
				available,
				tracked: available,
				tone: !available ? 'default' : (Number(row.count) > 0 ? 'amber' : 'green'),
				status: !available ? 'not_available' : (Number(row.count) > 0 ? 'needs_attention' : 'ok'),
				display: available ? Number(row.count) : 'Not available',
			};
		}),
	};
}

function buildPublishingHealth({ wordpress, pinterest, workspaceIndicators, aiDefaults, jobStats }) {
	const wordpressReady = !wordpress.needsConfiguration && ['connected', 'configured', 'ok'].includes(wordpress.connection.status);
	const pinterestReady = !pinterest.needsConfiguration;
	const aiReady = Boolean(aiDefaults?.textReady);
	const imagesReady = Boolean(aiDefaults?.imageReady);
	const queueRunning = workspaceIndicators?.publishingQueue?.status === 'operational';
	const checks = [
		{ key: 'wordpressReady', label: 'WordPress Ready', ok: wordpressReady },
		{ key: 'pinterestReady', label: 'Pinterest Ready', ok: pinterestReady },
		{ key: 'aiReady', label: 'AI Ready', ok: aiReady },
		{ key: 'queueRunning', label: 'Queue Running', ok: queueRunning },
		{ key: 'imagesReady', label: 'Images Ready', ok: imagesReady },
	];
	const score = Math.round((checks.filter((item) => item.ok).length / checks.length) * 100);
	return {
		items: checks.map((item) => ({
			...item,
			status: item.ok ? 'ready' : 'missing',
			tone: item.ok ? 'green' : 'amber',
		})),
		overallScore: score,
		failedJobs: jobStats.failedJobs || 0,
		readyToPublish: (jobStats.draftPins || []).length,
	};
}

function buildCredentialsHealth({ website, wpSite, workspaceIndicators, aiDefaults, userSettingsFlags }) {
	const rows = [
		{
			key: 'wordpressUsername',
			label: 'WordPress Username',
			configured: Boolean(String(website?.wp_username || wpSite?.username || '').trim()),
		},
		{
			key: 'applicationPassword',
			label: 'Application Password',
			configured: Boolean(website?.has_wp_app_password || wpSite?.hasCredentials),
		},
		{
			key: 'pinterestToken',
			label: 'Pinterest Token',
			configured: String(workspaceIndicators?.pinterestConnection?.status || '').toLowerCase() === 'connected'
				|| Boolean(userSettingsFlags?.has_pinterest_token),
		},
	];
	return {
		items: rows.map((row) => ({
			...row,
			status: row.configured ? 'configured' : 'missing',
			tone: row.configured ? 'green' : 'red',
			labelStatus: row.configured ? 'Configured' : 'Missing',
		})),
	};
}

function buildAiReadiness({ website, wordpress, pinterest, aiDefaults, publishingHealth }) {
	const items = [
		{
			key: 'websiteConnected',
			label: 'Website Connected',
			ok: Boolean(website?.url),
			hint: 'Add a valid website URL in Website Settings.',
		},
		{
			key: 'wordpressReady',
			label: 'WordPress Ready',
			ok: !wordpress.needsConfiguration,
			hint: wordpress.configureHint || 'Configure WordPress credentials in Website Settings.',
		},
		{
			key: 'aiConfigured',
			label: 'AI generation',
			ok: Boolean(aiDefaults?.textReady),
			hint: 'AI generation is unavailable right now. Please try again later.',
		},
		{
			key: 'imageGenerationAvailable',
			label: 'Image generation',
			ok: Boolean(aiDefaults?.imageReady),
			hint: 'Image generation is unavailable right now. Please try again later.',
		},
		{
			key: 'pinterestReady',
			label: 'Pinterest Ready',
			ok: !pinterest.needsConfiguration,
			hint: pinterest.configureHint || 'Connect Pinterest in Pinterest settings.',
		},
		{
			key: 'publishingReady',
			label: 'Publishing Ready',
			ok: Number(publishingHealth.overallScore || 0) >= 60,
			hint: 'Finish WordPress, Pinterest, and AI setup to publish confidently.',
		},
	];
	const overallReady = items.every((item) => item.ok);
	return {
		items: items.map((item) => ({
			...item,
			status: item.ok ? 'ready' : 'missing',
			tone: item.ok ? 'green' : 'amber',
		})),
		overallReady,
		overallLabel: overallReady ? 'Overall Ready' : 'Setup Incomplete',
		overallTone: overallReady ? 'green' : 'amber',
	};
}

function buildSiteInfo({ website, wpSite }) {
	const profile = wpSite?.siteProfile || {};
	const plugins = Array.isArray(profile.activePlugins)
		? profile.activePlugins.length
		: (Number.isFinite(Number(profile.activePluginsCount))
			? Number(profile.activePluginsCount)
			: (Number.isFinite(Number(profile.pluginsCount)) ? Number(profile.pluginsCount) : null));
	return {
		domain: website.domain || '',
		created: website.created || '',
		lastScan: website.last_scan_at || '',
		lastSync: wpSite?.lastSyncedAt || '',
		wordpressVersion: wpSite?.wpVersion || profile.wordpressVersion || profile.version || '',
		phpVersion: profile.phpVersion || '',
		theme: profile.theme || profile.activeTheme || '',
		activePluginsCount: plugins,
	};
}

function assembleControlPayload({
	website,
	wpSite,
	articleStats,
	jobStats,
	workspaceIndicators,
	credits = null,
	publishTarget = null,
	aiDefaults = null,
	userSettingsFlags = null,
	pinterestMeta = null,
	recentActivity = [],
}) {
	const health = buildHealthBlock({ website, wpSite, articleStats, jobStats });
	const stats = buildStatsBlock(articleStats, jobStats, website);
	const score = computeWebsiteScore({ health, jobStats, indicators: workspaceIndicators, website });
	const contentOverview = buildContentOverview(articleStats);
	const performance = buildPerformance(jobStats, articleStats);
	const problems = buildQuickProblems({
		health,
		indicators: workspaceIndicators,
		website,
		jobStats,
		credits,
	});
	const wordpress = buildWordpressStatus({ website, wpSite, jobStats });
	const pinterest = buildPinterestStatus({
		workspaceIndicators,
		publishTarget,
		jobStats,
		pinterestMeta,
	});
	const aiConfiguration = buildAiConfiguration(aiDefaults);
	const seoHealth = buildSeoHealth(articleStats);
	const publishingHealth = buildPublishingHealth({
		wordpress,
		pinterest,
		workspaceIndicators,
		aiDefaults,
		jobStats,
	});
	const credentialsHealth = buildCredentialsHealth({
		website,
		wpSite,
		workspaceIndicators,
		aiDefaults,
		userSettingsFlags,
	});
	const aiReadiness = buildAiReadiness({
		website,
		wordpress,
		pinterest,
		aiDefaults,
		publishingHealth,
	});
	const siteInfo = buildSiteInfo({ website, wpSite });

	if (wordpress.needsConfiguration) {
		problems.unshift({
			id: 'wordpress_credentials_missing',
			code: 'wordpress_credentials_missing',
			label: 'WordPress credentials missing',
			tone: 'red',
			detail: 'Configure them in Website Settings.',
		});
	}

	return {
		health,
		stats,
		score,
		performance,
		contentOverview,
		problems,
		indicators: workspaceIndicators,
		publishReady: {
			count: (jobStats.draftPins || []).length,
			pinIds: (jobStats.draftPins || []).map((pin) => pin.id),
			accountId: publishTarget?.accountId || '',
			boardId: publishTarget?.boardId || '',
		},
		wordpress,
		pinterest,
		aiConfiguration,
		seoHealth,
		publishingHealth,
		credentialsHealth,
		aiReadiness,
		siteInfo,
		recentActivity: Array.isArray(recentActivity) ? recentActivity.slice(0, 10) : [],
	};
}

function buildQuickProblems({ health, indicators, website, jobStats, credits }) {
	const problems = [];

	if (['failed', 'not_configured', 'disconnected'].includes(health.wordpressConnection?.status)) {
		problems.push({
			id: 'wordpress_disconnected',
			code: 'wordpress_disconnected',
			label: 'WordPress disconnected',
			tone: 'red',
			detail: health.wordpressConnection?.detail || 'WordPress is not connected. Configure it in Website Settings.',
		});
	}

	if (['failed', 'not_configured', 'disconnected'].includes(indicators?.pinterestConnection?.status)) {
		problems.push({
			id: 'pinterest_disconnected',
			code: 'pinterest_disconnected',
			label: 'Pinterest disconnected',
			tone: 'red',
			detail: 'Pinterest is not connected. Connect an account in Pinterest settings.',
		});
	}

	if (indicators?.imageGeneration?.status === 'unavailable') {
		problems.push({
			id: 'image_generation_unavailable',
			code: 'image_generation_unavailable',
			label: 'AI image generation unavailable',
			tone: 'red',
			detail: 'Image generation is unavailable right now. Please try again later.',
		});
	}

	if (website.discovery_status === 'failed') {
		problems.push({
			id: 'scan_failed',
			code: 'scan_failed',
			label: 'Scan failed',
			tone: 'red',
			detail: 'The last website scan failed. Try scanning again from the Dashboard.',
		});
	}

	const pending = Number(jobStats.pendingJobs) || 0;
	const queuePaused = indicators?.publishingQueue?.status === 'paused';
	if (queuePaused || pending >= 10) {
		problems.push({
			id: 'queue_stuck',
			code: 'queue_stuck',
			label: 'Queue stuck',
			tone: 'amber',
			detail: queuePaused ? 'Publishing queue is paused' : `${pending} pending jobs`,
		});
	}

	const aiRemaining = Number(credits?.ai?.remaining);
	const imageRemaining = Number(credits?.image?.remaining);
	const creditsLow = (
		(Number.isFinite(aiRemaining) && aiRemaining <= 10)
		|| (Number.isFinite(imageRemaining) && imageRemaining <= 5)
	);
	if (creditsLow) {
		problems.push({
			id: 'credits_low',
			code: 'credits_low',
			label: 'Credits low',
			tone: 'amber',
			detail: 'Credits are running low. Review your plan or usage in Settings.',
		});
	}

	return problems;
}

function eventColor(type, status) {
	const normalized = String(type || '').toLowerCase();
	const statusValue = String(status || '').toLowerCase();
	if (normalized === 'error' || statusValue === 'failed' || statusValue === 'error') {
		return { tone: 'red', color: 'red' };
	}
	if (normalized === 'retry' || statusValue === 'retrying') {
		return { tone: 'amber', color: 'amber' };
	}
	if (normalized === 'scan') {
		return { tone: 'blue', color: 'blue' };
	}
	if (normalized === 'synchronization' || normalized === 'sync') {
		return { tone: 'default', color: 'cyan' };
	}
	if (normalized === 'ai_generation') {
		return { tone: 'amber', color: 'purple' };
	}
	if (normalized === 'publishing' || normalized === 'publish') {
		return { tone: 'green', color: 'green' };
	}
	return { tone: 'default', color: 'default' };
}

function annotateTimelineEvent(event) {
	const color = eventColor(event.type, event.status);
	return {
		...event,
		tone: color.tone,
		color: color.color,
	};
}

async function resolveDefaultPinterestTarget(ownerId) {
	const accounts = await pocketbaseClient.collection('pinterest_accounts').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		requestKey: null,
	}).catch(() => []);
	const connected = (accounts || []).find((account) => account.status === 'connected' || account.connected)
		|| null;
	if (!connected) {
		return { accountId: '', boardId: '', accountName: '', boardName: '', connected: false };
	}

	const boards = await pocketbaseClient.collection('pinterest_boards').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner} && account = {:account}', {
			owner: ownerId,
			account: connected.id,
		}),
		requestKey: null,
	}).catch(() => []);
	const defaultBoard = (boards || []).find((board) => board.is_default) || (boards || [])[0] || null;
	return {
		accountId: connected.id || '',
		boardId: defaultBoard?.board_id || defaultBoard?.id || '',
		accountName: connected.username || connected.account_name || connected.label || connected.name || '',
		boardName: defaultBoard?.name || defaultBoard?.board_name || '',
		connected: true,
	};
}

async function loadWorkspaceStatusIndicators(ownerId) {
	const [providers, pinterestAccounts, brandKits, queuePausedRow, calendarEvents] = await Promise.all([
		listProviders().catch(() => []),
		pocketbaseClient.collection('pinterest_accounts').getFullList({
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
			requestKey: null,
		}).catch(() => []),
		pocketbaseClient.collection('brand_kits').getFullList({
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
			requestKey: null,
		}).catch(() => []),
		pocketbaseClient.collection('queue_metrics').getFirstListItem(
			pocketbaseClient.filter('bucket_key = "global_control"'),
			{ requestKey: null },
		).catch(() => null),
		pocketbaseClient.collection('calendar_events').getList(1, 1, {
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
			requestKey: null,
		}).catch(() => ({ totalItems: 0 })),
	]);

	const imageProviders = (providers || []).filter((provider) => {
		const code = String(provider.code || '').toLowerCase();
		const name = String(provider.name || '').toLowerCase();
		const scopes = String(provider.scopes || provider.config?.scopes || '').toLowerCase();
		return /image|fal|flux|stability|ideogram/.test(`${code} ${name}`)
			|| scopes.includes('image');
	});
	const preferredImage = imageProviders.find((p) => p.enabled && (p.config?.hasApiKey || p.status === 'connected'))
		|| imageProviders.find((p) => p.enabled)
		|| imageProviders[0]
		|| null;

	const connectedPinterest = (pinterestAccounts || []).find((account) => (
		account.status === 'connected' || account.connected
	)) || null;

	const defaultBrandKit = (brandKits || []).find((kit) => kit.is_default) || (brandKits || [])[0] || null;
	const queuePaused = Boolean(queuePausedRow?.paused);
	const hasCalendar = Number(calendarEvents.totalItems) > 0;
	const imageGenerationAvailable = Boolean(
		preferredImage
		&& preferredImage.enabled
		&& (preferredImage.config?.hasApiKey || preferredImage.config?.hasSecretKey || preferredImage.status === 'connected'),
	);

	return {
		imageGeneration: indicator(
			'Image Generation',
			imageGenerationAvailable ? 'available' : 'unavailable',
			imageGenerationAvailable ? 'Available' : 'Unavailable',
		),
		pinterestConnection: indicator(
			'Pinterest Connection',
			connectedPinterest
				? (connectedPinterest.status === 'connected' || connectedPinterest.connected ? 'connected' : connectedPinterest.status || 'configured')
				: 'not_configured',
			connectedPinterest?.username || connectedPinterest?.account_name || connectedPinterest?.name || '',
		),
		brandKitAssigned: indicator(
			'Brand Kit Assigned',
			defaultBrandKit ? 'ready' : 'not_configured',
			defaultBrandKit?.name || 'No brand kit',
		),
		publishingQueue: indicator(
			'Publishing Queue',
			queuePaused ? 'paused' : 'operational',
			queuePaused ? 'Queue is paused' : 'Queue accepting jobs',
		),
		scheduler: indicator(
			'Scheduler',
			hasCalendar ? 'operational' : 'idle',
			hasCalendar ? 'Calendar events present' : 'No scheduled calendar events',
		),
	};
}

function buildHealthBlock({ website, wpSite, articleStats, jobStats }) {
	const connection = connectionStatusFromWp(wpSite, website);
	const restApi = restApiStatusFromWp(wpSite, website);
	const lastScanSummary = website.last_scan_summary || null;
	const lastSync = website.updated || website.last_scan_at || '';

	return {
		wordpressConnection: {
			status: connection.status,
			tone: toneFromStatus(connection.status),
			detail: connection.detail,
			lastTestedAt: wpSite?.lastTestedAt || '',
		},
		restApi: {
			status: restApi.status,
			tone: toneFromStatus(restApi.status === 'ok' ? 'connected' : restApi.status),
			detail: restApi.detail,
		},
		lastSuccessfulScan: website.last_scan_at || '',
		discoveredArticles: articleStats.totalArticles || 0,
		lastSynchronization: lastSync,
		discoveryStatus: website.discovery_status || 'pending',
		lastScanSummary,
		wpSiteId: wpSite?.id || '',
		wpVersion: wpSite?.wpVersion || wpSite?.health?.version || '',
		pendingJobs: jobStats.pendingJobs || 0,
		failedJobs: jobStats.failedJobs || 0,
		publishedPins: jobStats.publishedPins || 0,
	};
}

export async function buildWebsiteControlSummary(website, {
	ownerId,
	wpSites = [],
	articlesSchema,
	workspaceIndicators = null,
	credits = null,
	publishTarget = null,
	aiDefaults = null,
	userSettingsFlags = null,
	pinterestMeta = null,
} = {}) {
	const schema = articlesSchema || await resolveArticlesSchema();
	const wpSite = matchWordpressSite(wpSites, website.id);
	const articleStats = await articleStatsForWebsite(website.id, schema);
	articleStats.lastScan = website.last_scan_at || '';
	articleStats.nextScheduledScan = website.next_scan_at || '';
	const jobStats = await pinAndJobStatsForWebsite(ownerId, website.id, wpSite?.id || '');
	const recentActivity = await buildActivityTimeline({
		ownerId,
		websiteId: website.id,
		wpSiteId: wpSite?.id || '',
		website,
	}).then((events) => (events || []).slice(0, 10)).catch(() => []);

	return assembleControlPayload({
		website,
		wpSite,
		articleStats,
		jobStats,
		workspaceIndicators,
		credits,
		publishTarget,
		aiDefaults,
		userSettingsFlags,
		pinterestMeta,
		recentActivity,
	});
}

async function loadAiDefaults(ownerId) {
	const [providers, platform, settingsRecord] = await Promise.all([
		listProviders().catch(() => []),
		getPlatformSettings().catch(() => ({ settings: {} })),
		getOwnedUserSettings(ownerId).catch(() => null),
	]);
	const settings = platform?.settings || platform || {};
	const textProvider = (providers || []).find((item) => isTextOrientedProvider(item.code) && item.enabled && (item.config?.hasApiKey || item.status === 'connected'))
		|| (providers || []).find((item) => isTextOrientedProvider(item.code) && item.enabled)
		|| null;
	const imageProvider = (providers || []).find((item) => isImageOrientedProvider(item.code) && item.enabled && (item.config?.hasApiKey || item.status === 'connected'))
		|| (providers || []).find((item) => isImageOrientedProvider(item.code) && item.enabled)
		|| null;
	const prompt = String(settings?.prompts?.writerSystem || '').trim();
	const userFlags = mapSettingsResponse(settingsRecord);
	const languageCode = String(settings?.general?.defaultLanguage || '').trim();
	const tone = String(settings?.content?.defaultPinTone || settings?.content?.recipeStyle || '').trim();
	const model = textProvider?.defaultModel
		|| textProvider?.config?.model
		|| settings?.ai?.defaultModel
		|| textProvider?.name
		|| '';
	return {
		aiDefaults: {
			model: model || null,
			language: languageCode || null,
			country: null,
			tone: tone || null,
			promptPreview: prompt ? `${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}` : null,
			imageProvider: imageProvider?.name || settings?.images?.defaultImageProvider || null,
			textProvider: textProvider?.name || settings?.ai?.defaultProvider || null,
			textReady: Boolean(textProvider?.config?.hasApiKey || textProvider?.status === 'connected' || userFlags.has_openai_key || userFlags.has_gemini_key),
			imageReady: Boolean(imageProvider?.config?.hasApiKey || imageProvider?.status === 'connected' || userFlags.has_fal_key),
		},
		userSettingsFlags: userFlags,
	};
}

export async function getWebsitesControlCenter(ownerId, websites = [], { workspaceKey } = {}) {
	const [wpPayload, articlesSchema, workspaceIndicators, credits, publishTarget, aiBundle] = await Promise.all([
		listWordpressSites(ownerId).catch(() => ({ items: [] })),
		resolveArticlesSchema(),
		loadWorkspaceStatusIndicators(ownerId),
		getUserCreditUsage(pocketbaseClient, ownerId, workspaceKey).catch(() => null),
		resolveDefaultPinterestTarget(ownerId).catch(() => ({ accountId: '', boardId: '' })),
		loadAiDefaults(ownerId).catch(() => ({ aiDefaults: null, userSettingsFlags: null })),
	]);
	const wpSites = wpPayload.items || [];
	const pinterestMeta = {
		boardName: publishTarget?.boardName || '',
		accountName: publishTarget?.accountName || workspaceIndicators?.pinterestConnection?.detail || '',
	};

	const items = await Promise.all((websites || []).map(async (website) => {
		try {
			const control = await buildWebsiteControlSummary(website, {
				ownerId,
				wpSites,
				articlesSchema,
				workspaceIndicators,
				credits,
				publishTarget,
				aiDefaults: aiBundle?.aiDefaults || null,
				userSettingsFlags: aiBundle?.userSettingsFlags || null,
				pinterestMeta,
			});
			return { ...website, control };
		} catch (error) {
			logger.warn('Website control summary failed', {
				websiteId: website?.id,
				message: error?.message || String(error),
			});
			const emptyStats = {
				totalArticles: 0,
				readyArticles: 0,
				publishedPins: 0,
				pendingJobs: 0,
				failedJobs: 0,
				newArticles: 0,
				publishedArticles: 0,
				draftArticles: 0,
				missingFeaturedImage: 0,
				missingSeoTitle: 0,
				missingMetaDescription: 0,
				missingCategory: 0,
				missingTags: 0,
				importedArticles: 0,
				lastScan: website.last_scan_at || '',
				nextScheduledScan: website.next_scan_at || '',
			};
			const emptyJobs = {
				pendingJobs: 0,
				failedJobs: 0,
				publishedPins: 0,
				failedPins: 0,
				aiPinsTotal: 0,
				generatedImages: 0,
				draftPins: [],
				successRate: null,
				wpPublished: 0,
				wpFailed: 0,
				wpSyncs: 0,
			};
			return {
				...website,
				control: assembleControlPayload({
					website,
					wpSite: matchWordpressSite(wpSites, website.id),
					articleStats: emptyStats,
					jobStats: emptyJobs,
					workspaceIndicators,
					credits,
					publishTarget,
					aiDefaults: aiBundle?.aiDefaults || null,
					userSettingsFlags: aiBundle?.userSettingsFlags || null,
					pinterestMeta,
				}),
			};
		}
	}));

	return {
		items,
		indicators: workspaceIndicators,
	};
}

async function buildActivityTimeline({
	ownerId,
	websiteId,
	wpSiteId,
	website,
}) {
	const events = [];

	if (website.last_scan_at) {
		const summary = website.last_scan_summary || {};
		events.push({
			id: `scan-${website.id}-${website.last_scan_at}`,
			type: website.discovery_status === 'failed' ? 'error' : 'scan',
			title: 'Website scan',
			status: website.discovery_status || 'completed',
			at: website.last_scan_at,
			detail: summary.found != null
				? `Found ${summary.found} articles (${summary.newArticles || 0} new)`
				: 'Scan completed',
		});
	}

	const [generations, pinJobs, imageJobs, wpHistory, wpLogs, workspaceActivity] = await Promise.all([
		safeList(
			'ai_pin_generation_history',
			pocketbaseClient.filter('owner = {:owner} && websiteId = {:websiteId}', { owner: ownerId, websiteId }),
			{ perPage: 15 },
		),
		safeList(
			'pinterest_publish_jobs',
			pocketbaseClient.filter('owner = {:owner} && websiteId = {:websiteId}', { owner: ownerId, websiteId }),
			{ perPage: 15 },
		),
		safeList(
			'ai_pin_image_jobs',
			pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
			{ perPage: 10 },
		),
		wpSiteId
			? listPublishHistory(ownerId, { page: 1, perPage: 15 }).catch(() => ({ items: [] }))
			: Promise.resolve({ items: [] }),
		wpSiteId
			? listWordpressApiLogs(ownerId, { siteId: wpSiteId, page: 1, perPage: 15 }).catch(() => ({ items: [] }))
			: Promise.resolve({ items: [] }),
		pocketbaseClient.collection('workspace_activity').getList(1, 20, {
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
			sort: '-created',
			requestKey: null,
		}).catch(() => ({ items: [] })),
	]);

	for (const row of generations.items || []) {
		events.push({
			id: `gen-${row.id}`,
			type: 'ai_generation',
			title: row.title || row.overlay_text || 'AI pin generation',
			status: row.status || 'completed',
			at: row.created,
			detail: row.event_type || '',
		});
	}

	for (const job of pinJobs.items || []) {
		let type = 'publishing';
		if (job.status === 'failed') type = 'error';
		else if (job.status === 'retrying') type = 'retry';
		events.push({
			id: `pin-job-${job.id}`,
			type,
			title: job.title || 'Pinterest publish',
			status: job.status,
			at: job.updated || job.created,
			detail: job.last_error || job.status || '',
		});
	}

	for (const job of imageJobs.items || []) {
		const metaWebsite = job.websiteId || job.payload?.websiteId || '';
		if (metaWebsite && metaWebsite !== websiteId) continue;
		events.push({
			id: `img-${job.id}`,
			type: job.status === 'failed' ? 'error' : (job.status === 'retrying' ? 'retry' : 'ai_generation'),
			title: 'AI image job',
			status: job.status,
			at: job.updated || job.created,
			detail: job.last_error || (job.prompt || '').slice(0, 80),
		});
	}

	for (const row of wpHistory.items || []) {
		if (wpSiteId && row.siteId && row.siteId !== wpSiteId) continue;
		events.push({
			id: `wp-hist-${row.id}`,
			type: row.result === 'failed' ? 'error' : 'publishing',
			title: row.title || 'WordPress publish',
			status: row.result || row.wpStatus || '',
			at: row.publishedAt || row.created,
			detail: row.error || row.publishedUrl || '',
		});
	}

	for (const row of wpLogs.items || []) {
		if (row.ok) continue;
		events.push({
			id: `wp-log-${row.id}`,
			type: 'error',
			title: `WordPress API ${row.method} ${row.path || ''}`.trim(),
			status: 'error',
			at: row.created,
			detail: row.error || `HTTP ${row.statusCode}`,
		});
	}

	for (const row of workspaceActivity.items || []) {
		const meta = row.meta || {};
		if (meta.websiteId && meta.websiteId !== websiteId) continue;
		events.push({
			id: `act-${row.id}`,
			type: row.type || 'activity',
			title: row.title || 'Activity',
			status: row.tone || 'default',
			at: row.created,
			detail: row.summary || '',
		});
	}

	if (website.updated && website.updated !== website.last_scan_at) {
		events.push({
			id: `sync-${website.id}-${website.updated}`,
			type: 'synchronization',
			title: 'Website record synchronized',
			status: 'completed',
			at: website.updated,
			detail: website.discovery_status || '',
		});
	}

	events.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
	return events.slice(0, 40).map(annotateTimelineEvent);
}

export async function getWebsiteDashboard(ownerId, website, { workspaceKey } = {}) {
	const websiteId = website.id;
	const [wpPayload, articlesSchema, workspaceIndicators, credits, publishTarget] = await Promise.all([
		listWordpressSites(ownerId).catch(() => ({ items: [] })),
		resolveArticlesSchema(),
		loadWorkspaceStatusIndicators(ownerId),
		getUserCreditUsage(pocketbaseClient, ownerId, workspaceKey).catch(() => null),
		resolveDefaultPinterestTarget(ownerId).catch(() => ({ accountId: '', boardId: '' })),
	]);

	const wpSite = matchWordpressSite(wpPayload.items || [], websiteId);
	const articleStats = await articleStatsForWebsite(websiteId, articlesSchema);
	articleStats.lastScan = website.last_scan_at || '';
	articleStats.nextScheduledScan = website.next_scan_at || '';
	const jobStats = await pinAndJobStatsForWebsite(ownerId, websiteId, wpSite?.id || '');
	const control = assembleControlPayload({
		website,
		wpSite,
		articleStats,
		jobStats,
		workspaceIndicators,
		credits,
		publishTarget,
	});

	const [
		wpAnalytics,
		wpJobs,
		wpHistory,
		wpLogs,
		wpQueueStats,
		pinJobs,
		generations,
		aiPins,
		activityTimeline,
		upcomingCalendar,
	] = await Promise.all([
		wpSite?.id
			? getWordpressPublishAnalytics(ownerId, { siteId: wpSite.id }).catch(() => null)
			: Promise.resolve(null),
		wpSite?.id
			? listPublishJobs(ownerId, { page: 1, perPage: 20 }).then((result) => ({
				...result,
				items: (result.items || []).filter((job) => !wpSite?.id || job.siteId === wpSite.id),
			})).catch(() => ({ items: [], totalItems: 0 }))
			: Promise.resolve({ items: [], totalItems: 0 }),
		wpSite?.id
			? listPublishHistory(ownerId, { page: 1, perPage: 20 }).then((result) => ({
				...result,
				items: (result.items || []).filter((row) => !wpSite?.id || row.siteId === wpSite.id),
			})).catch(() => ({ items: [], totalItems: 0 }))
			: Promise.resolve({ items: [], totalItems: 0 }),
		wpSite?.id
			? listWordpressApiLogs(ownerId, { siteId: wpSite.id, page: 1, perPage: 20 }).catch(() => ({ items: [] }))
			: Promise.resolve({ items: [] }),
		getWordpressQueueStats().catch(() => null),
		safeList(
			'pinterest_publish_jobs',
			pocketbaseClient.filter('owner = {:owner} && websiteId = {:websiteId}', { owner: ownerId, websiteId }),
			{ perPage: 20 },
		),
		safeList(
			'ai_pin_generation_history',
			pocketbaseClient.filter('owner = {:owner} && websiteId = {:websiteId}', { owner: ownerId, websiteId }),
			{ perPage: 20 },
		),
		safeList(
			'ai_pins',
			pocketbaseClient.filter('owner = {:owner} && websiteId = {:websiteId}', { owner: ownerId, websiteId }),
			{ perPage: 20 },
		),
		buildActivityTimeline({ ownerId, websiteId, wpSiteId: wpSite?.id || '', website }),
		pocketbaseClient.collection('calendar_events').getList(1, 20, {
			filter: pocketbaseClient.filter('owner = {:owner} && start >= {:now}', {
				owner: ownerId,
				now: new Date().toISOString(),
			}),
			sort: 'start',
			requestKey: null,
		}).catch(() => ({ items: [], totalItems: 0 })),
	]);

	const errorLogs = [
		...(wpLogs.items || []).filter((row) => !row.ok).map((row) => ({
			id: row.id,
			source: 'wordpress',
			message: row.error || `HTTP ${row.statusCode} ${row.method} ${row.path}`,
			at: row.created,
		})),
		...(pinJobs.items || []).filter((job) => job.status === 'failed').map((job) => ({
			id: job.id,
			source: 'pinterest',
			message: job.last_error || 'Pinterest publish failed',
			at: job.updated || job.created,
		})),
		...(wpJobs.items || []).filter((job) => job.status === 'failed').map((job) => ({
			id: job.id,
			source: 'wordpress_publish',
			message: job.lastError || job.last_error || 'WordPress publish failed',
			at: job.updated || job.created,
		})),
	].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 25);

	const lastAiOperations = (generations.items || []).map((row) => ({
		id: row.id,
		title: row.title || row.overlay_text || 'AI operation',
		eventType: row.event_type || '',
		status: row.status || 'completed',
		at: row.created,
		imageUrl: row.image_url || '',
		aiCreditsUsed: row.ai_credits_used || 0,
		imageCreditsUsed: row.image_credits_used || 0,
	}));

	const storageUsage = {
		discoveredArticles: articleStats.totalArticles || 0,
		aiPins: aiPins.totalItems || 0,
		generationHistory: generations.totalItems || 0,
		publishJobs: (wpJobs.totalItems || 0) + (pinJobs.totalItems || 0),
		wordpressApiLogs: wpLogs.totalItems || 0,
	};

	const upcomingScheduled = [
		...(jobStats.scheduledPinJobs || []).map((job) => ({
			id: job.id,
			channel: 'pinterest',
			title: job.title || 'Pinterest publish',
			at: job.scheduled_at || job.created,
			status: job.status,
		})),
		...(jobStats.wpScheduledJobs || []).map((job) => ({
			id: job.id,
			channel: 'wordpress',
			title: job.title || 'WordPress publish',
			at: job.scheduled_at || job.created,
			status: job.status,
		})),
		...(upcomingCalendar.items || []).map((event) => ({
			id: event.id,
			channel: 'calendar',
			title: event.title || event.name || 'Scheduled event',
			at: event.start || event.starts_at || event.created,
			status: event.status || 'scheduled',
		})),
	].sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0)).slice(0, 20);

	return {
		overview: {
			websiteId,
			name: website.name,
			domain: website.domain,
			url: website.url,
			status: website.status,
			discoveryStatus: website.discovery_status,
			created: website.created,
			updated: website.updated,
		},
		health: control.health,
		stats: control.stats,
		score: control.score,
		performance: control.performance,
		contentOverview: control.contentOverview,
		problems: control.problems,
		indicators: workspaceIndicators,
		publishReady: control.publishReady,
		widgets: {
			systemHealth: {
				score: control.score,
				wordpress: control.health.wordpressConnection,
				restApi: control.health.restApi,
				pinterest: workspaceIndicators.pinterestConnection,
				imageGeneration: workspaceIndicators.imageGeneration,
				queue: workspaceIndicators.publishingQueue,
				scheduler: workspaceIndicators.scheduler,
			},
			contentPipeline: control.contentOverview,
			pinterestPerformance: {
				...control.performance,
				pending: (pinJobs.items || []).filter((job) => PENDING_JOB_STATUSES.has(String(job.status || ''))).length,
				failed: (pinJobs.items || []).filter((job) => job.status === 'failed').length,
				connection: workspaceIndicators.pinterestConnection,
			},
			aiUsage: {
				credits,
				generationCount: generations.totalItems || 0,
				totalPins: aiPins.totalItems || 0,
				lastOperations: lastAiOperations.slice(0, 5),
			},
			recentErrors: errorLogs.slice(0, 10),
			upcomingScheduled,
			websiteResources: storageUsage,
		},
		wordpress: {
			site: wpSite || null,
			analytics: wpAnalytics,
			jobs: wpJobs.items || [],
			history: wpHistory.items || [],
			queueStats: wpQueueStats,
		},
		aiGeneration: {
			totalPins: aiPins.totalItems || 0,
			recentPins: (aiPins.items || []).map((pin) => ({
				id: pin.id,
				title: pin.title || '',
				status: pin.status || '',
				imageUrl: pin.image_url || '',
				created: pin.created,
			})),
			operations: lastAiOperations,
			generationCount: generations.totalItems || 0,
		},
		pinterest: {
			jobs: (pinJobs.items || []).map((job) => ({
				id: job.id,
				title: job.title || '',
				status: job.status || '',
				scheduledAt: job.scheduled_at || '',
				publishedAt: job.published_at || '',
				lastError: job.last_error || '',
				created: job.created,
				updated: job.updated,
			})),
			published: (pinJobs.items || []).filter((job) => job.status === 'published').length,
			failed: (pinJobs.items || []).filter((job) => job.status === 'failed').length,
			pending: (pinJobs.items || []).filter((job) => PENDING_JOB_STATUSES.has(String(job.status || ''))).length,
			connection: workspaceIndicators.pinterestConnection,
		},
		publishingHistory: [
			...(wpHistory.items || []).map((row) => ({
				id: row.id,
				channel: 'wordpress',
				title: row.title || '',
				status: row.result || row.wpStatus || '',
				url: row.publishedUrl || '',
				at: row.publishedAt || row.created,
				error: row.error || '',
			})),
			...(pinJobs.items || []).map((job) => ({
				id: job.id,
				channel: 'pinterest',
				title: job.title || '',
				status: job.status || '',
				url: '',
				at: job.published_at || job.updated || job.created,
				error: job.last_error || '',
			})),
		].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 30),
		queue: {
			pendingJobs: control.stats.pendingJobs,
			failedJobs: control.stats.failedJobs,
			wordpress: wpQueueStats,
			wordpressJobs: wpJobs.items || [],
			pinterestJobs: pinJobs.items || [],
			indicator: workspaceIndicators.publishingQueue,
		},
		recentActivity: activityTimeline.slice(0, 12),
		activityTimeline,
		errorLogs,
		storageUsage,
		creditsUsage: credits
			? {
				plan: credits.plan,
				ai: credits.ai,
				image: credits.image,
			}
			: null,
		lastAiOperations,
		quickActions: [
			{ id: 'scan', label: 'Scan Website', action: 'scan' },
			{ id: 'sync', label: 'Sync Articles', action: 'sync' },
			{ id: 'generate_pins', label: 'Generate Pins', href: `/app/ai-pins?websiteId=${websiteId}` },
			{ id: 'publish_ready', label: 'Publish Ready Pins', action: 'publish_ready' },
			{ id: 'refresh', label: 'Refresh Dashboard', action: 'refresh' },
			{ id: 'analytics', label: 'Open Analytics', href: '/app/analytics' },
		],
	};
}
