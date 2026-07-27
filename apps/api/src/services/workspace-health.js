import pocketbaseClient from '../utils/pocketbaseClient.js';
import { getWallet } from './credits-engine.js';
import { countWorkspaceResources } from './workspace-ownership.js';

/**
 * Shared workspace health score + recommendations (customer + admin).
 */
export async function computeWorkspaceHealthDetailed({
	workspace,
	subscription = null,
	ownerId = '',
	req = null,
} = {}) {
	const workspaceId = workspace?.id || '';
	const workspaceKey = workspace?.workspace_key || '';
	const owner = ownerId || workspace?.owner || '';

	const [wordpressCount, pinterestCount, articleCount, pinCount, providers, failedPublish, members] = await Promise.all([
		req
			? countWorkspaceResources('websites', req)
			: pocketbaseClient.collection('websites').getList(1, 1, {
				filter: pocketbaseClient.filter('owner = {:owner}', { owner }),
				requestKey: null,
			}).then((r) => r.totalItems || 0).catch(() => 0),
		req
			? countWorkspaceResources('pinterest_accounts', req)
			: pocketbaseClient.collection('pinterest_accounts').getList(1, 1, {
				filter: pocketbaseClient.filter('owner = {:owner}', { owner }),
				requestKey: null,
			}).then((r) => r.totalItems || 0).catch(() => 0),
		req
			? countWorkspaceResources('articles', req)
			: pocketbaseClient.collection('articles').getList(1, 1, {
				filter: pocketbaseClient.filter('owner = {:owner}', { owner }),
				requestKey: null,
			}).then((r) => r.totalItems || 0).catch(() => 0),
		req
			? countWorkspaceResources('ai_pins', req).catch(() => countWorkspaceResources('pins', req))
			: pocketbaseClient.collection('ai_pins').getList(1, 1, {
				filter: pocketbaseClient.filter('owner = {:owner}', { owner }),
				requestKey: null,
			}).then((r) => r.totalItems || 0).catch(() => 0),
		pocketbaseClient.collection('ai_providers').getFullList({
			filter: 'enabled = true',
			fields: 'id,code,status,enabled',
			requestKey: null,
		}).catch(() => []),
		pocketbaseClient.collection('pinterest_publish_jobs').getList(1, 20, {
			filter: pocketbaseClient.filter('owner = {:owner} && status = "failed"', { owner }),
			sort: '-updated',
			requestKey: null,
		}).then((r) => r.totalItems || 0).catch(() => 0),
		workspaceId
			? pocketbaseClient.collection('workspace_members').getFullList({
				filter: pocketbaseClient.filter('workspace = {:ws} && status = "active"', { ws: workspaceId }),
				fields: 'id',
				requestKey: null,
			}).catch(() => [])
			: Promise.resolve([]),
	]);

	let credits = Number(subscription?.credits_balance);
	if (!Number.isFinite(credits) && workspaceKey) {
		try {
			const wallet = await getWallet(workspaceKey);
			credits = Number(wallet.remaining) || 0;
		} catch {
			credits = 0;
		}
	}
	credits = Number.isFinite(credits) ? credits : 0;

	const storageUsedGb = Number(workspace?.metadata?.storageUsedGb) || 0.1;
	const storageLimitGb = Number(workspace?.metadata?.storageLimitGb) || 5;
	const storageRatio = storageLimitGb > 0 ? storageUsedGb / storageLimitGb : 0;

	const aiConfigured = (providers || []).some((row) => row.enabled && (row.status === 'healthy' || row.status === 'ready' || !row.status));
	const wordpressConfigured = wordpressCount > 0;
	const pinterestConfigured = pinterestCount > 0;
	const billingStatus = subscription?.billing_status || subscription?.status || 'active';
	const status = workspace?.status || 'active';

	let score = 100;
	const issues = [];
	const recommendations = [];

	if (status === 'suspended' || status === 'closed') {
		score -= 40;
		issues.push('Workspace suspended/closed');
		recommendations.push({ code: 'activate_workspace', label: 'Activate the workspace', to: '/app/settings' });
	}
	if (billingStatus === 'past_due' || billingStatus === 'grace') {
		score -= 20;
		issues.push('Billing at risk');
		recommendations.push({ code: 'fix_billing', label: 'Update billing / subscription', to: '/app/subscription' });
	}
	if (!wordpressConfigured) {
		score -= 12;
		issues.push('WordPress not connected');
		recommendations.push({ code: 'connect_wordpress', label: 'Connect a WordPress website', to: '/app/websites' });
	}
	if (!pinterestConfigured) {
		score -= 12;
		issues.push('Pinterest not connected');
		recommendations.push({ code: 'connect_pinterest', label: 'Connect a Pinterest account', to: '/app/pinterest' });
	}
	if (!aiConfigured) {
		score -= 10;
		issues.push('AI providers not ready');
		recommendations.push({ code: 'configure_ai', label: 'Confirm AI providers are available', to: '/app/settings' });
	}
	if (credits <= 0) {
		score -= 15;
		issues.push('Credits exhausted');
		recommendations.push({ code: 'buy_credits', label: 'Top up credits or upgrade plan', to: '/app/subscription' });
	} else if (credits < 50) {
		score -= 8;
		issues.push('Credits low');
		recommendations.push({ code: 'topup_credits', label: 'Add credits before publishing stalls', to: '/app/subscription' });
	}
	if (storageRatio >= 0.9) {
		score -= 10;
		issues.push('Storage nearly full');
		recommendations.push({ code: 'storage', label: 'Free storage or upgrade plan', to: '/app/subscription' });
	} else if (storageRatio >= 0.75) {
		score -= 5;
		issues.push('Storage high');
		recommendations.push({ code: 'storage_watch', label: 'Review media storage usage', to: '/app/images' });
	}
	if (failedPublish > 0) {
		score -= Math.min(20, failedPublish * 4);
		issues.push(`${failedPublish} recent publish failures`);
		recommendations.push({ code: 'fix_publishing', label: 'Review failed publishing jobs', to: '/app/pinterest-history' });
	}
	if (articleCount === 0 && pinCount === 0) {
		score -= 6;
		issues.push('No content generated yet');
		recommendations.push({ code: 'create_content', label: 'Generate your first article or pin', to: '/app/writer' });
	}
	if ((members?.length || 0) < 1) {
		score -= 5;
		issues.push('No active members');
	}

	score = Math.max(0, Math.min(100, Math.round(score)));
	const label = score >= 80 ? 'healthy' : score >= 55 ? 'watch' : 'critical';

	const integrations = {
		wordpress: wordpressConfigured,
		pinterest: pinterestConfigured,
		ai: aiConfigured,
	};

	if (workspaceId && Number(workspace.health_score) !== score) {
		pocketbaseClient.collection('workspaces').update(workspaceId, {
			health_score: score,
			health_label: label,
		}).catch(() => null);
	}

	return {
		score,
		label,
		issues,
		recommendations,
		integrations,
		metrics: {
			credits,
			storageUsedGb: Math.round(storageUsedGb * 10) / 10,
			storageLimitGb,
			wordpressCount,
			pinterestCount,
			articleCount,
			pinCount,
			failedPublish,
			membersActive: members?.length || 0,
			billingStatus,
			status,
		},
	};
}
