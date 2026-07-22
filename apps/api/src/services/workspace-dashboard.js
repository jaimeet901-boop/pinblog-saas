import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { assertCapability } from './workspace-rbac.js';
import { getSubscriptionPlan } from './workspace-context.js';
import { getWorkspaceCredits, getWorkspaceUsage } from './workspace-billing.js';

function statusTone(status) {
	if (status === 'published' || status === 'connected' || status === 'completed') return 'green';
	if (status === 'failed' || status === 'error') return 'red';
	if (status === 'scheduled' || status === 'queued' || status === 'processing') return 'amber';
	return 'default';
}

async function listOwned(collection, ownerId, { sort = '-created', perPage = 20 } = {}) {
	return pocketbaseClient.collection(collection).getList(1, perPage, {
		filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		sort,
		requestKey: null,
	}).catch(() => ({ items: [], totalItems: 0 }));
}

export async function getWorkspaceDashboard(req) {
	assertCapability(req, 'workspace.read');
	const ownerId = req.pocketbaseUserId;
	const plan = await getSubscriptionPlan(req.workspaceSubscription);
	const [usage, credits, websites, articles, pins, activity, notifications, providers] = await Promise.all([
		getWorkspaceUsage(req),
		getWorkspaceCredits(req),
		listOwned('websites', ownerId, { perPage: 50 }),
		listOwned('articles', ownerId, { perPage: 10 }),
		listOwned('pins', ownerId, { perPage: 20 }),
		pocketbaseClient.collection('workspace_activity').getList(1, 15, {
			filter: pocketbaseClient.filter('workspace = {:ws}', { ws: req.workspace.id }),
			sort: '-created',
			requestKey: null,
		}).catch(() => ({ items: [] })),
		pocketbaseClient.collection('workspace_notifications').getList(1, 10, {
			filter: pocketbaseClient.filter(
				'workspace = {:ws} && (user = "" || user = {:user})',
				{ ws: req.workspace.id, user: ownerId },
			),
			sort: '-created',
			requestKey: null,
		}).catch(() => ({ items: [], totalItems: 0 })),
		pocketbaseClient.collection('ai_providers').getFullList({
			filter: 'enabled = true',
			fields: 'id,code,name,status,enabled',
			requestKey: null,
		}).catch(() => []),
	]);

	let pinterestAccounts = [];
	try {
		const result = await pocketbaseClient.collection('pinterest_accounts').getFullList({
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
			requestKey: null,
		});
		pinterestAccounts = result;
	} catch {
		pinterestAccounts = [];
	}

	let publishJobs = [];
	try {
		const result = await pocketbaseClient.collection('pinterest_publish_jobs').getList(1, 50, {
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
			sort: '-updated',
			requestKey: null,
		});
		publishJobs = result.items || [];
	} catch {
		publishJobs = [];
	}

	const publishedPins = publishJobs.filter((job) => job.status === 'published').length;
	const failedJobs = publishJobs.filter((job) => job.status === 'failed').length;
	const scheduledJobs = publishJobs.filter((job) => job.status === 'scheduled').length;
	const connectedPinterest = pinterestAccounts.filter((account) => account.status === 'connected').length
		|| pinterestAccounts.length;

	const recentImages = pins.items.filter((pin) => pin.image_url).slice(0, 6);
	const recentActivity = [];

	for (const row of activity.items || []) {
		recentActivity.push({
			id: row.id,
			type: row.type,
			title: row.title,
			at: row.created,
			tone: row.tone || 'default',
			summary: row.summary || '',
		});
	}

	for (const article of articles.items.slice(0, 5)) {
		recentActivity.push({
			id: `article-${article.id}`,
			type: 'Article Generated',
			title: article.seo_title || article.keyword || 'Untitled article',
			at: article.created,
			tone: 'default',
		});
	}

	for (const pin of pins.items.slice(0, 5)) {
		recentActivity.push({
			id: `pin-${pin.id}`,
			type: pin.status === 'published' ? 'Published' : 'Pins Generated',
			title: pin.title || 'Untitled pin',
			at: pin.created,
			tone: statusTone(pin.status),
		});
	}

	for (const job of publishJobs.slice(0, 8)) {
		recentActivity.push({
			id: `job-${job.id}`,
			type: job.status === 'published' ? 'Published' : job.status === 'scheduled' ? 'Scheduled' : job.status === 'failed' ? 'Failed' : 'Pins Generated',
			title: job.title || 'Pinterest job',
			at: job.published_at || job.scheduled_at || job.updated || job.created,
			tone: statusTone(job.status),
		});
	}

	recentActivity.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

	const providerStatus = (providers || []).map((provider) => ({
		code: provider.code,
		name: provider.name,
		status: provider.status || (provider.enabled ? 'healthy' : 'disabled'),
		enabled: Boolean(provider.enabled),
	}));

	const successTotal = publishedPins + failedJobs;
	const successRate = successTotal ? Math.round((publishedPins / successTotal) * 100) : null;

	const calendarMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
	let calendarJobs = [];
	try {
		const events = await pocketbaseClient.collection('calendar_events').getFullList({
			filter: pocketbaseClient.filter('workspace = {:ws}', { ws: req.workspace.id }),
			sort: 'scheduled_at',
			requestKey: null,
		});
		calendarJobs = events
			.filter((event) => String(event.scheduled_at || '').startsWith(calendarMonth))
			.map((event) => ({
				id: event.id,
				title: event.title,
				status: event.status,
				scheduledAt: event.scheduled_at,
				timezone: event.timezone || 'UTC',
				eventType: event.event_type,
			}));
	} catch {
		calendarJobs = publishJobs
			.filter((job) => job.scheduled_at && String(job.scheduled_at).startsWith(calendarMonth))
			.map((job) => ({
				id: job.id,
				title: job.title || 'Scheduled pin',
				status: job.status,
				scheduledAt: job.scheduled_at,
				timezone: job.scheduled_timezone || 'UTC',
				eventType: 'publish',
			}));
	}

	return {
		workspace: {
			id: req.workspace.id,
			name: req.workspace.name,
			slug: req.workspace.slug,
			status: req.workspace.status,
			role: req.workspaceRole,
		},
		plan: {
			slug: plan?.slug || 'free',
			name: plan?.name || 'Free',
			credits: Number(plan?.credits) || 0,
			limits: plan?.limits || {},
			features: plan?.features || {},
		},
		credits: {
			balance: credits.balance,
			quota: credits.quota,
			used: credits.used,
			remaining: credits.remaining,
		},
		usage,
		statistics: {
			websites: websites.totalItems || 0,
			articles: articles.totalItems || 0,
			pins: pins.totalItems || 0,
			images: recentImages.length,
			publishedPins,
			scheduledJobs,
			failedJobs,
			pinterestAccounts: connectedPinterest,
			successRate,
			monthArticles: usage.totals?.monthArticles || 0,
		},
		websites: websites.items.map((site) => ({
			id: site.id,
			name: site.name,
			domain: site.domain || site.url,
			status: site.status,
		})),
		pinterestAccounts: pinterestAccounts.map((account) => ({
			id: account.id,
			label: account.label || account.username || account.id,
			status: account.status,
		})),
		recentActivity: recentActivity.slice(0, 12),
		recentArticles: articles.items.slice(0, 5).map((article) => ({
			id: article.id,
			title: article.seo_title || article.keyword || 'Untitled',
			status: article.status,
			created: article.created,
		})),
		recentImages: recentImages.map((pin) => ({
			id: pin.id,
			title: pin.title || 'Image',
			imageUrl: pin.image_url,
			created: pin.created,
		})),
		calendarJobs,
		providerStatus,
		publishingStatus: {
			published: publishedPins,
			scheduled: scheduledJobs,
			failed: failedJobs,
			queue: scheduledJobs,
		},
		notifications: {
			unread: (notifications.items || []).filter((item) => !item.dismissed_at && !item.read_at).length,
			items: (notifications.items || []).filter((item) => !item.dismissed_at).slice(0, 5).map((item) => ({
				id: item.id,
				title: item.title,
				body: item.body,
				priority: item.priority || 'normal',
				readAt: item.read_at,
				created: item.created,
			})),
		},
	};
}

export async function recordWorkspaceActivity(req, { type, title, summary = '', tone = 'default', meta = {} }) {
	if (!req.workspace?.id) return null;
	return pocketbaseClient.collection('workspace_activity').create({
		workspace: req.workspace.id,
		user: req.pocketbaseUserId,
		type,
		title,
		summary,
		tone,
		meta,
	}).catch(() => null);
}
