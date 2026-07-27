import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { ensurePlansSeeded } from './plans.js';
import {
	getWallet,
	refundCredits,
	resetMonthlyCredits,
	setCreditsSuspended,
	reserveCredits,
	commitReservation,
	releaseReservation,
	mapReservation,
	writeBillingEvent,
	ensureWorkspaceWallet,
} from './credits-engine.js';

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
	const [transactions, subscriptions, reservations] = await Promise.all([
		pocketbaseClient.collection('credit_transactions').getFullList({ requestKey: null }).catch(() => []),
		pocketbaseClient.collection('workspace_subscriptions').getFullList({ requestKey: null }).catch(() => []),
		pocketbaseClient.collection('credit_reservations').getFullList({
			filter: pocketbaseClient.filter('status = "reserved"'),
			requestKey: null,
		}).catch(() => []),
	]);

	let issued = 0;
	let burned = 0;
	let refunded = 0;
	let bonus = 0;
	let topups = 0;
	const now = Date.now();
	const thirtyDays = 30 * 86400000;

	for (const row of transactions) {
		const amount = Number(row.amount) || 0;
		if (amount > 0 && (row.type === 'grant' || row.type === 'topup' || row.type === 'refund' || row.type === 'adjust')) {
			issued += amount;
		}
		if (row.type === 'refund' && amount > 0) refunded += amount;
		if (String(row.feature || '') === 'bonus' || String(row.reason || '').toLowerCase().includes('bonus')) {
			bonus += Math.max(0, amount);
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
	const reservedOpen = reservations.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

	return {
		creditsIssued: issued,
		creditsBurned: burned,
		creditsRefunded: refunded,
		bonusIssued: bonus,
		avgPerWorkspace: avg,
		topups30d: topups,
		workspaceCount: subscriptions.length,
		openReservations: reservations.length,
		reservedCredits: reservedOpen,
		wallets: subscriptions.map((item) => ({
			workspaceKey: item.workspace_key,
			workspaceName: item.workspace_name || item.workspace_key,
			balance: Number(item.credits_balance) || 0,
			purchasedCredits: Number(item.purchased_credits) || 0,
			bonusCredits: Number(item.bonus_credits_balance) || 0,
			usedTotal: Number(item.credits_used_total) || 0,
			suspended: Boolean(item.credits_suspended),
			billingStatus: item.billing_status || item.status || 'active',
		})),
	};
}

export async function listCreditLedger(query = {}) {
	await ensurePlansSeeded();
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
	const workspaceKey = query.workspaceKey || query.workspace || '';
	const type = query.type || '';
	const feature = query.feature || '';

	const parts = [];
	if (workspaceKey) {
		parts.push(pocketbaseClient.filter('workspace_key = {:key}', { key: String(workspaceKey) }));
	}
	if (type) {
		parts.push(pocketbaseClient.filter('type = {:type}', { type: String(type) }));
	}
	if (feature) {
		parts.push(pocketbaseClient.filter('feature = {:feature}', { feature: String(feature) }));
	}
	const filter = parts.length ? parts.join(' && ') : '';

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
			feature: row.feature || '',
			reason: row.reason || '',
			balance: Number(row.balance) || 0,
			createdBy: row.created_by || '',
			reservationId: row.reservation_id || '',
			referenceId: row.reference_id || '',
			createdAt: row.created,
			timeLabel: formatRelativeDay(row.created),
			text: `${row.workspace_name || row.workspace_key} · ${Number(row.amount) >= 0 ? '+' : ''}${Number(row.amount).toLocaleString()} ${row.type}${row.feature ? `/${row.feature}` : ''}${row.reason ? ` · ${row.reason}` : ''}`,
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

	if (type === 'refund') {
		await ensureWorkspaceWallet(workspaceKey, { workspaceName, ownerEmail: payload.ownerEmail || '' });
		const result = await refundCredits({
			workspaceKey,
			amount: Math.abs(amount),
			reason,
			actor,
			feature: payload.feature || '',
			referenceId: payload.referenceId || '',
			metadata: payload.metadata || {},
		});
		return {
			id: result.transactionId,
			workspaceKey,
			workspaceName,
			amount: result.amount,
			type: 'refund',
			reason,
			balance: result.balance,
			createdBy: actor,
		};
	}

	let subscription = await getSubscription(workspaceKey);
	const currentBalance = Number(subscription?.credits_balance) || 0;
	const nextBalance = Math.max(0, currentBalance + amount);
	const purchasedDelta = type === 'topup' && amount > 0 ? amount : 0;
	const bonusDelta = (payload.bonus === true || String(payload.feature || '') === 'bonus') && amount > 0 ? amount : 0;

	if (!subscription) {
		subscription = await ensureWorkspaceWallet(workspaceKey, {
			workspaceName: workspaceName || workspaceKey,
			ownerEmail: payload.ownerEmail || '',
			planId: payload.planId,
			initialBalance: nextBalance,
		});
		if (nextBalance !== Number(subscription.credits_balance)) {
			await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
				credits_balance: nextBalance,
				purchased_credits: purchasedDelta,
				bonus_credits_balance: bonusDelta,
			});
		}
	} else {
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			credits_balance: nextBalance,
			workspace_name: workspaceName || subscription.workspace_name,
			purchased_credits: (Number(subscription.purchased_credits) || 0) + purchasedDelta,
			bonus_credits_balance: (Number(subscription.bonus_credits_balance) || 0) + bonusDelta,
			credits_used_total: type === 'burn' && amount < 0
				? (Number(subscription.credits_used_total) || 0) + Math.abs(amount)
				: subscription.credits_used_total,
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
		feature: payload.feature || (bonusDelta ? 'bonus' : ''),
		metadata: payload.metadata || {},
	});

	if (type === 'topup') {
		await writeBillingEvent({
			workspaceKey,
			workspaceName,
			eventType: 'topup',
			actor,
			message: `Top-up ${amount} credits`,
			metadata: { amount },
		});
	}

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

export async function getWorkspaceWallet(workspaceKey) {
	return getWallet(String(workspaceKey || '').trim());
}

export async function listReservations(query = {}) {
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
	const workspaceKey = query.workspaceKey || '';
	const status = query.status || '';
	const parts = [];
	if (workspaceKey) parts.push(pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }));
	if (status) parts.push(pocketbaseClient.filter('status = {:status}', { status }));
	const result = await pocketbaseClient.collection('credit_reservations').getList(page, perPage, {
		filter: parts.length ? parts.join(' && ') : undefined,
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [], page, perPage, totalItems: 0, totalPages: 0 }));
	return {
		items: (result.items || []).map(mapReservation),
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 0,
	};
}

export async function adminReserveCredits(payload = {}, actorUserId = '') {
	const workspaceKey = slugify(payload.workspaceKey || payload.workspaceName);
	await ensureWorkspaceWallet(workspaceKey, {
		workspaceName: payload.workspaceName || workspaceKey,
		ownerEmail: payload.ownerEmail || '',
	});
	return reserveCredits({
		workspaceKey,
		amount: payload.amount,
		feature: payload.feature || '',
		reason: payload.reason || '',
		actorUserId,
		referenceId: payload.referenceId || '',
		idempotencyKey: payload.idempotencyKey || '',
		metadata: payload.metadata || {},
	});
}

export async function adminCommitReservation(id, actor = 'admin') {
	return commitReservation(id, { actor });
}

export async function adminReleaseReservation(id, actor = 'admin') {
	return releaseReservation(id, { actor });
}

export async function adminResetCredits(workspaceKey, actor = 'admin') {
	return resetMonthlyCredits({ workspaceKey: String(workspaceKey || '').trim(), actor, force: true });
}

export async function adminSuspendCredits(workspaceKey, suspended, actor = 'admin') {
	return setCreditsSuspended(String(workspaceKey || '').trim(), suspended, actor);
}

export async function listBillingHistory(query = {}) {
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
	const workspaceKey = query.workspaceKey || '';
	const filter = workspaceKey
		? pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey })
		: '';
	const result = await pocketbaseClient.collection('billing_events').getList(page, perPage, {
		filter: filter || undefined,
		sort: '-occurred_at',
		requestKey: null,
	}).catch(() => ({ items: [], page, perPage, totalItems: 0, totalPages: 0 }));
	return {
		items: (result.items || []).map((row) => ({
			id: row.id,
			workspaceKey: row.workspace_key,
			workspaceName: row.workspace_name || row.workspace_key,
			eventType: row.event_type,
			fromPlan: row.from_plan || '',
			toPlan: row.to_plan || '',
			actor: row.actor || '',
			message: row.message || '',
			occurredAt: row.occurred_at || row.created,
			metadata: row.metadata || {},
		})),
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 0,
	};
}

export { refundCredits };
