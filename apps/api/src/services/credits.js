import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { ensurePlansSeeded } from './plans.js';

function slugify(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
}

function formatRelativeDay(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	const today = new Date();
	const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const diffDays = Math.round((startToday - startThat) / 86400000);
	if (diffDays === 0) return 'Today';
	if (diffDays === 1) return 'Yesterday';
	return date.toISOString().slice(0, 10);
}

async function getSubscription(workspaceKey) {
	try {
		return await pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
		);
	} catch {
		return null;
	}
}

export async function getCreditsSummary() {
	await ensurePlansSeeded();
	const [transactions, subscriptions] = await Promise.all([
		pocketbaseClient.collection('credit_transactions').getFullList({ requestKey: null }).catch(() => []),
		pocketbaseClient.collection('workspace_subscriptions').getFullList({ requestKey: null }).catch(() => []),
	]);

	let issued = 0;
	let burned = 0;
	let topups = 0;
	const now = Date.now();
	const thirtyDays = 30 * 86400000;

	for (const row of transactions) {
		const amount = Number(row.amount) || 0;
		if (amount > 0 && (row.type === 'grant' || row.type === 'topup' || row.type === 'refund' || row.type === 'adjust')) {
			issued += amount;
		}
		if (amount < 0 || row.type === 'burn' || row.type === 'expire') {
			burned += Math.abs(amount);
		}
		if (row.type === 'topup' || (row.type === 'grant' && String(row.reason || '').toLowerCase().includes('top'))) {
			const created = new Date(row.created).getTime();
			if (Number.isFinite(created) && now - created <= thirtyDays) topups += 1;
		}
	}

	const balances = subscriptions.map((item) => Number(item.credits_balance) || 0);
	const avg = balances.length
		? Math.round(balances.reduce((sum, value) => sum + value, 0) / balances.length)
		: 0;

	return {
		creditsIssued: issued,
		creditsBurned: burned,
		avgPerWorkspace: avg,
		topups30d: topups,
		workspaceCount: subscriptions.length,
	};
}

export async function listCreditLedger(query = {}) {
	await ensurePlansSeeded();
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
	const workspaceKey = query.workspaceKey || query.workspace || '';

	const filter = workspaceKey
		? pocketbaseClient.filter('workspace_key = {:key}', { key: String(workspaceKey) })
		: '';

	const result = await pocketbaseClient.collection('credit_transactions').getList(page, perPage, {
		filter: filter || undefined,
		sort: '-created',
		requestKey: null,
	});

	return {
		items: result.items.map((row) => ({
			id: row.id,
			workspaceKey: row.workspace_key,
			workspaceName: row.workspace_name || row.workspace_key,
			amount: Number(row.amount) || 0,
			type: row.type,
			reason: row.reason || '',
			balance: Number(row.balance) || 0,
			createdBy: row.created_by || '',
			createdAt: row.created,
			timeLabel: formatRelativeDay(row.created),
			text: `${row.workspace_name || row.workspace_key} · ${Number(row.amount) >= 0 ? '+' : ''}${Number(row.amount).toLocaleString()} ${row.type}${row.reason ? ` · ${row.reason}` : ''}`,
		})),
		page: result.page,
		perPage: result.perPage,
		totalItems: result.totalItems,
		totalPages: result.totalPages,
	};
}

export async function grantCredits(payload = {}, actor = 'admin') {
	const workspaceKey = slugify(payload.workspaceKey || payload.workspace_key || payload.workspaceName);
	const workspaceName = String(payload.workspaceName || payload.workspace_name || workspaceKey).trim();
	const amount = Number(payload.amount);
	const reason = String(payload.reason || 'Admin credit grant').trim();
	const type = payload.type || 'grant';

	if (!workspaceKey) {
		throw httpError(422, 'workspaceKey is required', 'VALIDATION_ERROR');
	}
	if (!Number.isFinite(amount) || amount === 0) {
		throw httpError(422, 'amount must be a non-zero number', 'VALIDATION_ERROR');
	}
	if (!['grant', 'burn', 'refund', 'adjust', 'expire', 'topup'].includes(type)) {
		throw httpError(422, 'invalid credit transaction type', 'VALIDATION_ERROR');
	}

	let subscription = await getSubscription(workspaceKey);
	const currentBalance = Number(subscription?.credits_balance) || 0;
	const nextBalance = Math.max(0, currentBalance + amount);

	if (!subscription) {
		const plans = await pocketbaseClient.collection('plans').getList(1, 1, { sort: 'display_order' });
		const planId = payload.planId || plans.items[0]?.id;
		if (!planId) {
			throw httpError(400, 'No plans available to attach workspace', 'NO_PLANS');
		}
		subscription = await pocketbaseClient.collection('workspace_subscriptions').create({
			workspace_key: workspaceKey,
			workspace_name: workspaceName || workspaceKey,
			owner_email: payload.ownerEmail || '',
			plan: planId,
			status: 'active',
			seats: 1,
			credits_balance: nextBalance,
		});
	} else {
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			credits_balance: nextBalance,
			workspace_name: workspaceName || subscription.workspace_name,
		});
	}

	const tx = await pocketbaseClient.collection('credit_transactions').create({
		workspace_key: workspaceKey,
		workspace_name: workspaceName || subscription.workspace_name || workspaceKey,
		amount,
		type,
		reason,
		balance: nextBalance,
		created_by: actor,
		metadata: payload.metadata || {},
	});

	return {
		id: tx.id,
		workspaceKey,
		workspaceName: tx.workspace_name,
		amount,
		type,
		reason,
		balance: nextBalance,
		createdBy: actor,
		createdAt: tx.created,
	};
}

export async function listWorkspaceUsage(query = {}) {
	await ensurePlansSeeded();
	const period = query.period || (() => {
		const now = new Date();
		return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
	})();

	const records = await pocketbaseClient.collection('workspace_usage').getFullList({
		filter: pocketbaseClient.filter('period = {:period}', { period }),
		sort: '-credits_burned',
		requestKey: null,
	}).catch(() => []);

	return {
		period,
		items: records.map((row) => ({
			id: row.id,
			workspaceKey: row.workspace_key,
			workspaceName: row.workspace_name || row.workspace_key,
			period: row.period,
			articles: Number(row.articles) || 0,
			images: Number(row.images) || 0,
			tokens: Number(row.tokens) || 0,
			queueJobs: Number(row.queue_jobs) || 0,
			publishing: Number(row.publishing) || 0,
			apiCalls: Number(row.api_calls) || 0,
			creditsBurned: Number(row.credits_burned) || 0,
		})),
		totalItems: records.length,
	};
}
