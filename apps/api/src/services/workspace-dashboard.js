import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { assertCapability } from './workspace-rbac.js';
import { getSubscriptionPlan } from './workspace-context.js';
import { getWorkspaceCredits, getWorkspaceUsage } from './workspace-billing.js';
import { listWorkspaceResources } from './workspace-ownership.js';
import { computeWorkspaceHealthDetailed } from './workspace-health.js';
import { FACEBOOK_JOB_COLLECTION } from './facebook/channel-pack.js';
import { summarizeDashboardPublishJobs } from './workspace-dashboard-publish.js';

function statusTone(status) {
	if (status === 'published' || status === 'connected' || status === 'completed') return 'green';
	if (status === 'failed' || status === 'error') return 'red';
	if (status === 'scheduled' || status === 'queued' || status === 'processing') return 'amber';
	return 'default';
}

async function listOwned(collection, req, { sort = '-created', perPage = 20 } = {}) {
	return listWorkspaceResources(collection, req, { sort, perPage });
}

async function loadMonthlyTrends(ownerId, workspaceKey) {
	const months = [];
	const now = new Date();
	for (let i = 5; i >= 0; i -= 1) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
	}

	const usageRows = await pocketbaseClient.collection('workspace_usage').getFullList({
		filter: pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
		sort: '-period',
		requestKey: null,
	}).catch(() => []);

	const byPeriod = new Map();
	for (const row of usageRows) {
		const key = String(row.period || '').slice(0, 7);
		if (key) byPeriod.set(key, row);
	}

	return months.map((period) => {
		const row = byPeriod.get(period);
		return {
			period,
			creditsUsed: Number(row?.credits_burned) || 0,
			aiRequests: Number(row?.tokens) || 0,
			articles: Number(row?.articles) || 0,
			images: Number(row?.images) || 0,
			pins: Number(row?.pins) || 0,
		};
	});
}

export async function getWorkspaceDashboard(req) {
	assertCapability(req, 'workspace.read');
	const ownerId = req.workspaceOwnerId || req.workspace?.owner || req.pocketbaseUserId;
	const viewerId = req.pocketbaseUserId;
	const plan = await getSubscriptionPlan(req.workspaceSubscription);
	const [usage, credits, websites, articles, pins, activity, notifications, providers, members, monthlyTrends, health] = await Promise.all([
		getWorkspaceUsage(req),
		getWorkspaceCredits(req),
		listOwned('websites', req, { perPage: 50 }),
		listOwned('articles', req, { perPage: 10 }),
		listOwned('pins', req, { perPage: 20 }),
		pocketbaseClient.collection('workspace_activity').getList(1, 15, {
			filter: pocketbaseClient.filter('workspace = {:ws}', { ws: req.workspace.id }),
			sort: '-created',
			requestKey: null,
		}).catch(() => ({ items: [] })),
		pocketbaseClient.collection('workspace_notifications').getList(1, 10, {
			filter: pocketbaseClient.filter(
				'workspace = {:ws} && (user = "" || user = {:user} || user = {:viewer})',
				{ ws: req.workspace.id, user: ownerId, viewer: viewerId },
			),
			sort: '-created',
			requestKey: null,
		}).catch(() => ({ items: [], totalItems: 0 })),
		pocketbaseClient.collection('ai_providers').getFullList({
			filter: 'enabled = true',
			fields: 'id,code,name,status,enabled',
			requestKey: null,
		}).catch(() => []),
		pocketbaseClient.collection('workspace_members').getFullList({
			filter: pocketbaseClient.filter('workspace = {:ws} && (status = "active" || status = "invited")', {
				ws: req.workspace.id,
			}),
			fields: 'id,role,status',
			requestKey: null,
		}).catch(() => []),
		loadMonthlyTrends(ownerId, req.workspaceKey),
		computeWorkspaceHealthDetailed({
			workspace: req.workspace,
			subscription: req.workspaceSubscription,
			ownerId,
			req,
		}).catch(() => ({
			score: null,
			label: 'unknown',
			issues: [],
			recommendations: [],
			integrations: {},
			metrics: {},
		})),
	]);

	let pinterestAccounts = [];
	try {
		const result = await listWorkspaceResources('pinterest_accounts', req, { perPage: 50 });
		pinterestAccounts = result.items || [];
	} catch {
		pinterestAccounts = [];
	}

	let publishJobs = [];
	try {
		const result = await listWorkspaceResources('pinterest_publish_jobs', req, { perPage: 100, sort: '-updated' });
		publishJobs = result.items || [];
	} catch {
		publishJobs = [];
	}

	let wordpressJobs = [];
	try {
		const result = await listWorkspaceResources('publish_jobs', req, { perPage: 100, sort: '-updated' });
		wordpressJobs = result.items || [];
	} catch {
		wordpressJobs = [];
	}

	let facebookJobs = [];
	try {
		const result = await listWorkspaceResources(FACEBOOK_JOB_COLLECTION, req, { perPage: 100, sort: '-updated' });
		facebookJobs = result.items || [];
	} catch {
		facebookJobs = [];
	}

	let queueDepth = 0;
	try {
		const depth = await listWorkspaceResources('queue_jobs', req, {
			perPage: 1,
			extraFilter: '(status = "pending" || status = "queued" || status = "waiting" || status = "waiting_provider" || status = "retrying" || status = "running")',
		});
		queueDepth = depth.totalItems || 0;
	} catch {
		queueDepth = 0;
	}

	const {
		publishedPins,
		publishedWp,
		publishedFacebook,
		facebookPublications,
		failedJobs,
		scheduledJobs,
		publishedPosts,
		pinterestWaiting,
	} = summarizeDashboardPublishJobs({ publishJobs, wordpressJobs, facebookJobs });
	const connectedPinterest = pinterestAccounts.filter((account) => account.status === 'connected' || account.connected).length
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
			type: job.status === 'published'
				? 'Published'
				: job.status === 'waiting_provider'
					? 'Waiting Provider'
					: job.status === 'scheduled'
						? 'Scheduled'
						: job.status === 'failed'
							? 'Failed'
							: 'Pins Generated',
			title: job.title || 'Pinterest job',
			at: job.published_at || job.scheduled_at || job.updated || job.created,
			tone: statusTone(job.status === 'waiting_provider' ? 'scheduled' : job.status),
		});
	}

	for (const job of wordpressJobs.slice(0, 6)) {
		recentActivity.push({
			id: `wp-${job.id}`,
			type: job.status === 'published'
				? 'Published'
				: job.status === 'scheduled'
					? 'Scheduled'
					: job.status === 'failed'
						? 'Failed'
						: 'WordPress',
			title: job.title || 'WordPress job',
			at: job.completed_at || job.scheduled_at || job.updated || job.created,
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

	const successTotal = publishedPosts + failedJobs;
	const successRate = successTotal ? Math.round((publishedPosts / successTotal) * 100) : null;

	const calendarMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
	// C3: Dashboard calendar preview uses Unified Calendar Facade only (no CE-first path).
	const { loadDashboardCalendarJobs } = await import('./calendar/product-calendar.js');
	const calendarPreview = await loadDashboardCalendarJobs(req, {
		month: calendarMonth,
		assertCapability: () => {},
	}).catch(() => ({ month: calendarMonth, calendarJobs: [], items: [] }));
	const calendarJobs = calendarPreview.calendarJobs || [];

	const storageUsedGb = Number(req.workspace.metadata?.storageUsedGb)
		|| Math.round(((Number(usage.totals?.tokens) || 0) / 1_000_000) * 10) / 10
		|| 0.1;
	const storageLimitGb = Number(req.workspace.metadata?.storageLimitGb)
		|| (plan?.slug === 'agency' ? 100 : plan?.slug === 'pro' ? 50 : plan?.slug === 'starter' ? 20 : 5);

	return {
		workspace: {
			id: req.workspace.id,
			name: req.workspace.name,
			slug: req.workspace.slug,
			status: req.workspace.status,
			role: req.workspaceRole,
			ownerId,
			planSlug: plan?.slug || req.workspace.plan_slug || 'free',
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
		usageDashboard: {
			creditsUsed: Number(credits.used) || 0,
			creditsRemaining: Number(credits.remaining ?? credits.balance) || 0,
			storageUsedGb,
			storageLimitGb,
			aiRequests: Number(usage.totals?.tokens) || Number(usage.tokens) || 0,
			generatedArticles: articles.totalItems || 0,
			generatedImages: pins.items.filter((pin) => pin.image_url).length || Number(usage.totals?.images) || 0,
			generatedPins: pins.totalItems || 0,
			wordpressPublications: publishedWp,
			pinterestPublications: publishedPins,
			facebookPublications,
			monthlyTrends,
		},
		members: {
			total: members.length,
			active: members.filter((row) => row.status === 'active').length,
			invited: members.filter((row) => row.status === 'invited').length,
			seats: Number(req.workspaceSubscription?.seats) || 1,
		},
		statistics: {
			websites: websites.totalItems || 0,
			articles: articles.totalItems || 0,
			pins: pins.totalItems || 0,
			images: recentImages.length,
			publishedPins,
			publishedWordpress: publishedWp,
			publishedFacebook,
			publishedPosts,
			scheduledJobs,
			failedJobs,
			queueDepth,
			pinterestWaiting,
			pinterestAccounts: connectedPinterest,
			successRate,
			monthArticles: usage.totals?.monthArticles || 0,
			storageUsedGb,
			storageLimitGb,
			members: members.length,
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
			published: publishedPosts,
			scheduled: scheduledJobs,
			failed: failedJobs,
			queue: queueDepth || scheduledJobs,
			pinterestWaiting,
			successRate,
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
		health,
	};
}

export async function recordWorkspaceActivity(req, { type, title, summary = '', tone = 'default', meta = {} }) {
	const { recordTypedWorkspaceActivity } = await import('./workspace-activity.js');
	return recordTypedWorkspaceActivity(req, { type, title, summary, tone, meta });
}
