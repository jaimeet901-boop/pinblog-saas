import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { assertCapability } from './workspace-rbac.js';
import { ensurePlansSeeded, listPlans, mapPlanDto } from './plans.js';
import { getSubscriptionPlan } from './workspace-context.js';
import { getBillingProvider, resolveBillingConfig } from './billing/providers/index.js';
import { syncEntitlementMirrors } from './billing/entitlement-sync.js';
import {
	validateBillingSource,
	validateBillingInterval,
	resolveAuthoritativePlanBillingType,
} from './billing/billing-model.js';
import { getCreditCosts } from './credits-engine.js';

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
		/** Platform Credit Engine catalog — clients must not invent feature costs. */
		featureCosts: await getCreditCosts(),
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
				? 'No payment provider selected. Plan changes update workspace metadata; connect Stripe, Paddle, or Lemon Squeezy in Billing Providers for checkout.'
				: `${billingConfig.provider} interface active${billingConfig.checkoutEnabled ? '' : ' (checkout disabled)'}.`,
		},
	};
}

async function resolvePlanFromPayload(payload = {}) {
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
	return plan;
}

function resolvePlanBillingTypeOrThrow(plan) {
	const result = resolveAuthoritativePlanBillingType(plan);
	if (!result.ok) {
		const errorCode = result.error === 'missing_plan_billing_type'
			? 'MISSING_PLAN_BILLING_TYPE'
			: 'INVALID_PLAN_BILLING_TYPE';
		throw httpError(422, 'Plan billing type is missing or invalid', errorCode);
	}
	return result.value;
}

/** Phase 4.1 — authoritative plans.billing_type; never price/slug heuristics. */
function planIsPaid(plan) {
	return resolvePlanBillingTypeOrThrow(plan) === 'paid';
}

function billingUnavailableResult(plan, providerCode = 'none') {
	return {
		status: 'billing_unavailable',
		provider: providerCode || 'none',
		message: 'The administrator has not configured a payment provider yet. Please try again later.',
		plan: mapPlanDto(plan),
		checkoutUrl: null,
	};
}

/**
 * Apply a plan change server-side. Used for free activations and post-payment webhook fulfillment only.
 * Never call this from user-controlled HTTP payloads for paid plans without a verified payment path.
 */
async function applyWorkspacePlanChange(req, plan, {
	actor = '',
	actorUserId = '',
	provider = '',
	paymentRef = '',
	reason = '',
} = {}) {
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
		owner_email: req.workspaceUser?.email || '',
		plan: plan.id,
		status: 'active',
		billing_status: 'active',
		seats: Number(req.workspaceSubscription?.seats) || 1,
		current_period_start: now.toISOString(),
		current_period_end: end.toISOString(),
		credits_balance: Number(plan.credits) || 0,
		owner_user: req.pocketbaseUserId || req.workspaceOwnerId || '',
		provider: provider || req.workspaceSubscription?.provider || 'none',
	};
	if (paymentRef) {
		body.provider_subscription_id = String(paymentRef).slice(0, 180);
	}

	const updated = req.workspaceSubscription?.id
		? await pocketbaseClient.collection('workspace_subscriptions').update(req.workspaceSubscription.id, body)
		: await pocketbaseClient.collection('workspace_subscriptions').create(body);

	const syncSource = provider === 'none' || !provider
		? 'free'
		: (validateBillingSource(provider).ok ? provider : 'system');
	await syncEntitlementMirrors({
		workspaceKey: req.workspaceKey,
		plan,
		subscriptionId: updated.id,
		subscriptionRecord: updated,
		actor: actor || req.workspaceUser?.email || req.pocketbaseUserId || 'system',
		source: syncSource,
	});

	req.workspaceSubscription = updated;
	req.workspace.plan_slug = plan.slug;

	await pocketbaseClient.collection('credit_transactions').create({
		workspace_key: req.workspaceKey,
		workspace_name: req.workspace.name,
		amount: Number(plan.credits) || 0,
		type: 'grant',
		reason: reason || `Plan change to ${plan.name}`,
		balance: Number(plan.credits) || 0,
		created_by: actor || req.workspaceUser?.email || req.pocketbaseUserId || 'system',
		reference_id: paymentRef || '',
	}).catch(() => null);

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
		actor: actor || req.workspaceUser?.email || req.pocketbaseUserId,
		actorUserId: actorUserId || req.pocketbaseUserId,
		fromPlan: previousSlug,
		toPlan: plan.slug,
		credits: Number(plan.credits) || 0,
		provider: provider || '',
		metadata: paymentRef ? { paymentRef } : {},
	}).catch(() => null);

	return getWorkspaceSubscription(req);
}

/**
 * Start subscription checkout for a paid plan.
 * Never activates a paid plan — activation happens only after provider webhook confirmation.
 */
export async function startWorkspaceSubscriptionCheckout(req, payload = {}) {
	assertCapability(req, 'workspace.billing.manage');

	const plan = await resolvePlanFromPayload(payload);
	const currentSlug = req.workspace.plan_slug
		|| req.workspaceSubscription?.expand?.plan?.slug
		|| '';
	if (plan.slug === currentSlug) {
		throw httpError(409, 'Already on this plan', 'PLAN_UNCHANGED');
	}

	// billing_type=free plans do not require a payment provider.
	if (!planIsPaid(plan)) {
		const activated = await applyWorkspacePlanChange(req, plan, {
			actor: req.workspaceUser?.email || req.pocketbaseUserId,
			actorUserId: req.pocketbaseUserId,
			provider: 'none',
			reason: `Free plan activation (${plan.name})`,
		});
		return {
			status: 'activated',
			provider: 'none',
			checkoutUrl: null,
			...activated,
		};
	}

	const billingConfig = await resolveBillingConfig();
	const provider = await getBillingProvider();
	const providerCode = billingConfig.provider || provider.code || 'none';

	if (
		providerCode === 'none'
		|| provider.code === 'none'
		|| !billingConfig.checkoutEnabled
		|| !provider.ready
	) {
		return billingUnavailableResult(plan, providerCode);
	}

	const successUrl = String(payload.successUrl || '').trim();
	const cancelUrl = String(payload.cancelUrl || '').trim();
	const rawBillingInterval = payload.billingInterval ?? payload.billing_interval ?? '';
	const billingIntervalResult = validateBillingInterval(
		rawBillingInterval === '' ? 'monthly' : rawBillingInterval,
		{ allowEmpty: false },
	);
	if (!billingIntervalResult.ok) {
		throw httpError(422, 'Invalid billing interval', 'INVALID_BILLING_INTERVAL');
	}
	const billingInterval = billingIntervalResult.value || 'monthly';
	const idempotencyKey = String(
		payload.idempotencyKey
		|| `sub:${req.workspaceKey}:${plan.slug}:${Date.now()}`,
	).slice(0, 180);

	let checkout;
	try {
		checkout = await provider.createSubscriptionCheckout({
			workspaceKey: req.workspaceKey,
			planId: plan.id,
			planSlug: plan.slug,
			planName: plan.name,
			monthlyPrice: Number(plan.monthly_price) || 0,
			billingInterval,
			currency: plan.currency || 'USD',
			customerEmail: req.workspaceUser?.email || '',
			successUrl,
			cancelUrl,
			idempotencyKey,
			metadata: {
				workspaceKey: req.workspaceKey,
				workspaceId: req.workspace?.id,
				planSlug: plan.slug,
				planId: plan.id,
				planName: plan.name,
				monthlyPrice: Number(plan.monthly_price) || 0,
			},
		});
	} catch (error) {
		if (error?.code === 'PROVIDER_NOT_IMPLEMENTED' || error?.status === 501) {
			return billingUnavailableResult(plan, providerCode);
		}
		throw error;
	}

	const checkoutUrl = checkout?.checkoutUrl || null;
	if (!checkoutUrl) {
		return {
			status: 'checkout_unavailable',
			provider: provider.code,
			message: checkout?.message
				|| 'Checkout session could not be created for the active payment provider.',
			plan: mapPlanDto(plan),
			checkout,
			checkoutUrl: null,
		};
	}

	const { logBillingAction } = await import('./billing/index.js');
	await logBillingAction({
		action: 'Subscription checkout started',
		eventType: 'checkout_started',
		workspaceKey: req.workspaceKey,
		workspaceName: req.workspace?.name || '',
		actor: req.workspaceUser?.email || req.pocketbaseUserId,
		actorUserId: req.pocketbaseUserId,
		provider: provider.code,
		toPlan: plan.slug,
		idempotencyKey,
		metadata: {
			checkoutUrl,
			sessionId: checkout?.sessionId || null,
			ready: Boolean(checkout?.ready),
		},
	}).catch(() => null);

	return {
		status: 'checkout_pending',
		provider: provider.code,
		message: checkout?.message || '',
		plan: mapPlanDto(plan),
		checkout,
		checkoutUrl,
		sessionId: checkout?.sessionId || null,
	};
}

/**
 * Public plan-change endpoint: billing_type=free plans only.
 * Paid activations require verified webhook fulfillment — client flags are ignored.
 */
export async function changeWorkspacePlan(req, payload = {}) {
	assertCapability(req, 'workspace.billing.manage');

	const plan = await resolvePlanFromPayload(payload);

	if (planIsPaid(plan)) {
		throw httpError(
			402,
			'Paid plan changes require a completed checkout. Use subscription checkout instead.',
			'CHECKOUT_REQUIRED',
		);
	}

	return applyWorkspacePlanChange(req, plan, {
		actor: req.workspaceUser?.email || req.pocketbaseUserId,
		actorUserId: req.pocketbaseUserId,
		provider: 'none',
		reason: `Plan change to ${plan.name}`,
	});
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

export { cancelWorkspaceSubscription } from './workspace-subscription-cancel.js';
