import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { assertCapability } from './workspace-rbac.js';
import { ensurePlansSeeded, listPlans, mapPlanDto } from './plans.js';
import { getSubscriptionPlan } from './workspace-context.js';

function currentPeriod() {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function getOrCreateUsage(workspaceKey, period = currentPeriod()) {
	try {
		return await pocketbaseClient.collection('workspace_usage').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key} && period = {:period}', {
				key: workspaceKey,
				period,
			}),
			{ requestKey: null },
		);
	} catch {
		return pocketbaseClient.collection('workspace_usage').create({
			workspace_key: workspaceKey,
			period,
			articles: 0,
			images: 0,
			tokens: 0,
			queue_jobs: 0,
			publishing: 0,
			api_calls: 0,
			credits_burned: 0,
		});
	}
}

async function countOwned(collection, ownerId, extraFilter = '') {
	const filter = extraFilter
		? pocketbaseClient.filter(`owner = {:owner} && (${extraFilter})`, { owner: ownerId })
		: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId });
	const result = await pocketbaseClient.collection(collection).getList(1, 1, {
		filter,
		requestKey: null,
	}).catch(() => ({ totalItems: 0 }));
	return result.totalItems || 0;
}

export async function getWorkspaceUsage(req) {
	assertCapability(req, 'workspace.read');
	const ownerId = req.workspaceOwnerId || req.workspace?.owner || req.pocketbaseUserId;
	const workspaceKey = req.workspaceKey;
	const period = currentPeriod();
	const usageRow = await getOrCreateUsage(workspaceKey, period);

	const { countWorkspaceResources } = await import('./workspace-ownership.js');
	const [articles, pins, websites, aiPins, history] = await Promise.all([
		countWorkspaceResources('articles', req),
		countWorkspaceResources('pins', req),
		countWorkspaceResources('websites', req),
		countWorkspaceResources('ai_pins', req).catch(() => 0),
		countWorkspaceResources('ai_pin_generation_history', req).catch(() => 0),
	]);

	let pinterestAccounts = 0;
	try {
		pinterestAccounts = await countWorkspaceResources('pinterest_accounts', req);
	} catch {
		pinterestAccounts = 0;
	}

	const now = new Date();
	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
	const monthArticles = await pocketbaseClient.collection('articles').getList(1, 1, {
		filter: pocketbaseClient.filter('(workspace = {:ws} || owner = {:owner}) && created >= {:start}', {
			ws: req.workspace?.id || '',
			owner: ownerId,
			start: monthStart,
		}),
		requestKey: null,
	}).catch(() => ({ totalItems: 0 }));

	return {
		period,
		articles: Number(usageRow.articles) || articles,
		images: Number(usageRow.images) || pins,
		tokens: Number(usageRow.tokens) || 0,
		queueJobs: Number(usageRow.queue_jobs) || 0,
		publishing: Number(usageRow.publishing) || 0,
		apiCalls: Number(usageRow.api_calls) || 0,
		creditsBurned: Number(usageRow.credits_burned) || 0,
		totals: {
			articles,
			images: pins,
			pins: aiPins || pins,
			websites,
			pinterestAccounts,
			generations: typeof history === 'number' ? history : (history.totalItems || 0),
			monthArticles: monthArticles.totalItems || 0,
			tokens: Number(usageRow.tokens) || 0,
			creditsBurned: Number(usageRow.credits_burned) || 0,
		},
	};
}

export async function getWorkspaceCredits(req) {
	assertCapability(req, 'workspace.read');
	const subscription = req.workspaceSubscription;
	const plan = await getSubscriptionPlan(subscription);
	const usage = await getWorkspaceUsage(req);
	const quota = Number(plan?.credits) || Number(plan?.limits?.aiRequests) || 0;
	const balance = Number(subscription?.credits_balance) || 0;
	const used = Math.max(0, quota - balance);

	const ledger = await pocketbaseClient.collection('credit_transactions').getList(1, 20, {
		filter: pocketbaseClient.filter('workspace_key = {:key}', { key: req.workspaceKey }),
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [], totalItems: 0 }));

	return {
		balance,
		quota,
		used: used || usage.totals.monthArticles || 0,
		remaining: balance,
		planSlug: plan?.slug || 'free',
		planName: plan?.name || 'Free',
		ledger: ledger.items.map((row) => ({
			id: row.id,
			amount: Number(row.amount) || 0,
			type: row.type,
			reason: row.reason || '',
			balance: Number(row.balance) || 0,
			createdAt: row.created,
		})),
		totalLedgerItems: ledger.totalItems || 0,
	};
}

export async function getWorkspaceSubscription(req) {
	assertCapability(req, 'workspace.read');
	await ensurePlansSeeded();
	const subscription = req.workspaceSubscription;
	const plan = await getSubscriptionPlan(subscription);
	const usage = await getWorkspaceUsage(req);
	const credits = await getWorkspaceCredits(req);
	const plans = await listPlans();
	const { resolveBillingConfig, listBillingProviders, listCreditPacks } = await import('./billing/index.js');
	const [billingConfig, providers, packs] = await Promise.all([
		resolveBillingConfig(),
		listBillingProviders(),
		listCreditPacks({ planId: plan?.id, planSlug: plan?.slug }),
	]);

	return {
		subscription: {
			id: subscription?.id,
			workspaceKey: req.workspaceKey,
			workspaceName: req.workspace.name,
			status: subscription?.status || 'active',
			billingStatus: subscription?.billing_status || subscription?.status || 'active',
			seats: Number(subscription?.seats) || 1,
			creditsBalance: Number(subscription?.credits_balance) || 0,
			purchasedCredits: Number(subscription?.purchased_credits) || 0,
			bonusCredits: Number(subscription?.bonus_credits_balance) || 0,
			currentPeriodStart: subscription?.current_period_start,
			currentPeriodEnd: subscription?.current_period_end,
			trialEndsAt: subscription?.trial_ends_at || null,
			gracePeriodEndsAt: subscription?.grace_period_ends_at || null,
			cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
			pendingPlan: subscription?.pending_plan || '',
			provider: subscription?.provider || billingConfig.provider,
			planId: plan?.id,
			planSlug: plan?.slug || req.workspace.plan_slug || 'free',
			planName: plan?.name || 'Free',
		},
		plan,
		plans: (plans.items || []).filter((item) => item.active),
		usage,
		credits,
		creditPacks: packs,
		billing: {
			provider: billingConfig.provider,
			checkoutEnabled: billingConfig.checkoutEnabled,
			planEnforcementEnabled: billingConfig.planEnforcementEnabled,
			autoRenew: billingConfig.autoRenew,
			gracePeriodDays: billingConfig.gracePeriodDays,
			providers,
			message: billingConfig.provider === 'none'
				? 'No payment provider selected. Plan changes update workspace metadata; connect Stripe, Paddle, or Lemon Squeezy in Global Settings for checkout.'
				: `${billingConfig.provider} interface active${billingConfig.checkoutEnabled ? '' : ' (checkout disabled)'}.`,
		},
	};
}

export async function changeWorkspacePlan(req, payload = {}) {
	assertCapability(req, 'workspace.billing.manage');
	await ensurePlansSeeded();

	const slug = String(payload.planSlug || payload.plan || payload.slug || '').trim().toLowerCase();
	const planId = payload.planId || '';
	let plan = null;
	if (planId) {
		plan = await pocketbaseClient.collection('plans').getOne(planId).catch(() => null);
	}
	if (!plan && slug) {
		plan = await pocketbaseClient.collection('plans').getFirstListItem(
			pocketbaseClient.filter('slug = {:slug}', { slug }),
			{ requestKey: null },
		).catch(() => null);
	}
	if (!plan || plan.active === false || plan.status === 'hidden' || plan.status === 'deprecated') {
		throw httpError(404, 'Plan not found or unavailable', 'PLAN_NOT_FOUND');
	}

	const previousSlug = req.workspace.plan_slug
		|| req.workspaceSubscription?.expand?.plan?.slug
		|| '';
	const isCreate = !req.workspaceSubscription?.id;

	const now = new Date();
	const end = new Date(now);
	end.setMonth(end.getMonth() + 1);

	const body = {
		workspace_key: req.workspaceKey,
		workspace_name: req.workspace.name,
		owner_email: req.workspaceUser.email || '',
		plan: plan.id,
		status: 'active',
		billing_status: 'active',
		seats: Number(req.workspaceSubscription?.seats) || 1,
		current_period_start: now.toISOString(),
		current_period_end: end.toISOString(),
		credits_balance: Number(plan.credits) || 0,
		owner_user: req.pocketbaseUserId,
	};

	const updated = req.workspaceSubscription?.id
		? await pocketbaseClient.collection('workspace_subscriptions').update(req.workspaceSubscription.id, body)
		: await pocketbaseClient.collection('workspace_subscriptions').create(body);

	await pocketbaseClient.collection('workspaces').update(req.workspace.id, {
		plan_slug: plan.slug,
	});

	// Keep legacy users.plan in sync for the workspace owner (not the acting member).
	const ownerUserId = req.workspaceOwnerId || req.workspace?.owner || req.pocketbaseUserId;
	await pocketbaseClient.collection('users').update(ownerUserId, {
		plan: plan.slug,
	}).catch(() => null);

	await pocketbaseClient.collection('credit_transactions').create({
		workspace_key: req.workspaceKey,
		workspace_name: req.workspace.name,
		amount: Number(plan.credits) || 0,
		type: 'grant',
		reason: `Plan change to ${plan.name}`,
		balance: Number(plan.credits) || 0,
		created_by: req.workspaceUser.email || req.pocketbaseUserId,
	}).catch(() => null);

	req.workspaceSubscription = updated;
	req.workspace.plan_slug = plan.slug;

	const { logBillingAction } = await import('./billing/index.js');
	const oldPlan = previousSlug
		? await pocketbaseClient.collection('plans').getFirstListItem(
			pocketbaseClient.filter('slug = {:slug}', { slug: previousSlug }),
		).catch(() => null)
		: null;
	const oldPrice = Number(oldPlan?.monthly_price) || 0;
	const newPrice = Number(plan.monthly_price) || 0;
	const eventType = isCreate
		? 'plan_assign'
		: (newPrice > oldPrice ? 'upgrade' : (newPrice < oldPrice ? 'downgrade' : 'plan_assign'));
	await logBillingAction({
		action: isCreate ? 'Subscription created' : (eventType === 'upgrade' ? 'Subscription upgraded' : eventType === 'downgrade' ? 'Subscription downgraded' : 'Subscription updated'),
		eventType,
		workspaceKey: req.workspaceKey,
		workspaceName: req.workspace.name,
		actor: req.workspaceUser.email || req.pocketbaseUserId,
		actorUserId: req.pocketbaseUserId,
		fromPlan: previousSlug,
		toPlan: plan.slug,
		credits: Number(plan.credits) || 0,
	}).catch(() => null);

	return getWorkspaceSubscription(req);
}

export async function purchaseWorkspaceCreditPack(req, payload = {}) {
	assertCapability(req, 'workspace.billing.manage');
	const { purchaseCreditPack } = await import('./billing/index.js');
	return purchaseCreditPack({
		workspaceKey: req.workspaceKey,
		workspaceName: req.workspace?.name || '',
		ownerEmail: req.workspaceUser?.email || '',
		packId: payload.packId || payload.id,
		idempotencyKey: payload.idempotencyKey || '',
		actor: req.workspaceUser?.email || req.pocketbaseUserId,
		actorUserId: req.pocketbaseUserId,
		successUrl: payload.successUrl || '',
		cancelUrl: payload.cancelUrl || '',
		allowLocalFulfillment: false,
	});
}
