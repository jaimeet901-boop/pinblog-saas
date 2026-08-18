import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { httpError } from '../../middleware/require-admin.js';
import { ensureWorkspaceWallet } from '../credits-engine.js';
import { getPlatformSettings } from '../platform-settings.js';
import { getBillingProvider, resolveBillingConfig } from './providers/index.js';
import { claimIdempotencyKey, completeIdempotency, failIdempotency } from './idempotency.js';
import { logBillingAction } from './audit.js';
import { clearCreditThresholdFlags } from './notifications.js';

/**
 * Resolve credit packs from plan.topup_packs and platform PAYG defaults.
 */
export async function listCreditPacks({ planId = '', planSlug = '' } = {}) {
	const { settings } = await getPlatformSettings().catch(() => ({ settings: null }));
	const payg = settings?.credits?.payAsYouGo || {};
	const globalPacks = Array.isArray(settings?.credits?.creditPacks) ? settings.credits.creditPacks : [];

	let planPacks = [];
	let plan = null;
	if (planId || planSlug) {
		plan = planId
			? await pocketbaseClient.collection('plans').getOne(planId).catch(() => null)
			: await pocketbaseClient.collection('plans').getFirstListItem(
				pocketbaseClient.filter('slug = {:slug}', { slug: planSlug }),
				{ requestKey: null },
			).catch(() => null);
		if (Array.isArray(plan?.topup_packs)) planPacks = plan.topup_packs;
	}

	const packs = [...planPacks, ...globalPacks]
		.map((pack, index) => ({
			id: String(pack.id || `pack-${index + 1}`).slice(0, 64),
			name: String(pack.name || `Pack ${index + 1}`).slice(0, 120),
			credits: Math.max(0, Number(pack.credits) || 0),
			price: Math.max(0, Number(pack.price) || 0),
			currency: String(pack.currency || 'USD').slice(0, 8),
			active: pack.active !== false,
		}))
		.filter((pack) => pack.credits > 0 && pack.active);

	const minCredits = Math.max(0, Number(payg.minPackCredits) || 0);
	return {
		enabled: Boolean(payg.enabled) || packs.length > 0,
		minPackCredits: minCredits,
		autoTopupThreshold: Number(payg.autoTopupThreshold) || 0,
		autoTopupPackCredits: Number(payg.autoTopupPackCredits) || 0,
		items: packs.filter((pack) => pack.credits >= minCredits),
		planSlug: plan?.slug || planSlug || '',
	};
}

/**
 * Start provider checkout for a credit pack (interface). Falls back to local grant only when provider is none and allowLocalDemo is true.
 */
export async function purchaseCreditPack({
	workspaceKey,
	workspaceName = '',
	ownerEmail = '',
	packId,
	idempotencyKey = '',
	actor = 'user',
	actorUserId = '',
	successUrl = '',
	cancelUrl = '',
	allowLocalFulfillment = false,
} = {}) {
	if (!workspaceKey) throw httpError(422, 'workspaceKey is required', 'VALIDATION_ERROR');
	if (!packId) throw httpError(422, 'packId is required', 'VALIDATION_ERROR');

	const subscription = await ensureWorkspaceWallet(workspaceKey, {
		workspaceName,
		ownerEmail,
	});
	const packs = await listCreditPacks({ planId: subscription.plan });
	const pack = packs.items.find((item) => item.id === packId || item.name === packId);
	if (!pack) throw httpError(404, 'Credit pack not found', 'PACK_NOT_FOUND');
	if (!packs.enabled) throw httpError(403, 'Pay-as-you-go is disabled', 'PAYG_DISABLED');

	const key = String(idempotencyKey || `topup:${workspaceKey}:${pack.id}:${pack.credits}:${pack.price}`).slice(0, 180);
	const idem = await claimIdempotencyKey({
		idempotencyKey: key,
		scope: 'credit_purchase',
		workspaceKey,
		eventType: 'credits_purchased',
		payload: { packId: pack.id, credits: pack.credits, price: pack.price },
	});
	if (idem.duplicate) {
		return {
			...idem.result,
			duplicate: true,
			idempotent: true,
		};
	}

	try {
		const config = await resolveBillingConfig();
		const provider = await getBillingProvider();

		if (config.checkoutEnabled && provider.code !== 'none') {
			const checkout = await provider.createCreditPackCheckout({
				workspaceKey,
				packId: pack.id,
				credits: pack.credits,
				price: pack.price,
				currency: pack.currency,
				customerEmail: ownerEmail,
				successUrl,
				cancelUrl,
				idempotencyKey: key,
				metadata: { pack },
			});
			const result = {
				status: 'checkout_pending',
				provider: provider.code,
				checkout,
				pack,
			};
			await completeIdempotency(idem.record.id, result);
			await logBillingAction({
				action: 'Credit pack checkout started',
				eventType: 'topup',
				workspaceKey,
				workspaceName: subscription.workspace_name || workspaceName,
				actor,
				actorUserId,
				provider: provider.code,
				idempotencyKey: key,
				metadata: result,
			});
			return result;
		}

		if (!allowLocalFulfillment) {
			const result = {
				status: 'provider_required',
				provider: provider.code,
				message: 'Connect a payment provider and enable checkout to sell credit packs.',
				pack,
			};
			await completeIdempotency(idem.record.id, result);
			return result;
		}

		// Local fulfillment path (admin/dev) — still idempotent & audited.
		const purchased = (Number(subscription.purchased_credits) || 0) + pack.credits;
		const balance = (Number(subscription.credits_balance) || 0) + pack.credits;
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			purchased_credits: purchased,
			credits_balance: balance,
		});
		await pocketbaseClient.collection('credit_transactions').create({
			workspace_key: workspaceKey,
			workspace_name: subscription.workspace_name || workspaceName || workspaceKey,
			amount: pack.credits,
			type: 'topup',
			feature: 'payg',
			reason: `Purchased ${pack.name}`,
			balance,
			created_by: actor,
			idempotency_key: key,
			reference_id: pack.id,
			metadata: { pack, price: pack.price, currency: pack.currency },
		});
		await clearCreditThresholdFlags(subscription.id);

		const result = {
			status: 'fulfilled',
			provider: 'none',
			pack,
			balance,
			purchasedCredits: purchased,
		};
		await logBillingAction({
			action: 'Credits purchased',
			eventType: 'credits_purchased',
			workspaceKey,
			workspaceName: subscription.workspace_name || workspaceName,
			actor,
			actorUserId,
			credits: pack.credits,
			idempotencyKey: key,
			provider: 'none',
			metadata: result,
		});
		await completeIdempotency(idem.record.id, result);
		return result;
	} catch (error) {
		await failIdempotency(idem.record.id, error?.message || String(error));
		throw error;
	}
}

/**
 * Fulfill a paid credit pack after webhook confirmation (idempotent).
 */
export async function fulfillCreditPackPurchase({
	workspaceKey,
	pack,
	idempotencyKey,
	provider = '',
	actor = 'webhook',
	paymentRef = '',
} = {}) {
	const key = String(idempotencyKey || '').slice(0, 180);
	if (!key) throw httpError(422, 'idempotencyKey required', 'VALIDATION_ERROR');

	const idem = await claimIdempotencyKey({
		idempotencyKey: key,
		scope: 'credit_purchase_fulfill',
		workspaceKey,
		provider,
		eventType: 'credits_purchased',
		payload: { pack, paymentRef },
	});
	if (idem.duplicate) return { duplicate: true, result: idem.result };

	try {
		const subscription = await ensureWorkspaceWallet(workspaceKey);
		const credits = Math.max(0, Number(pack?.credits) || 0);
		if (!credits) throw httpError(422, 'pack.credits required', 'VALIDATION_ERROR');

		const purchased = (Number(subscription.purchased_credits) || 0) + credits;
		const balance = (Number(subscription.credits_balance) || 0) + credits;
		await pocketbaseClient.collection('workspace_subscriptions').update(subscription.id, {
			purchased_credits: purchased,
			credits_balance: balance,
		});
		await pocketbaseClient.collection('credit_transactions').create({
			workspace_key: workspaceKey,
			workspace_name: subscription.workspace_name || workspaceKey,
			amount: credits,
			type: 'topup',
			feature: 'payg',
			reason: `Purchased ${pack?.name || 'credit pack'}`,
			balance,
			created_by: actor,
			idempotency_key: `${key}:tx`,
			reference_id: paymentRef || pack?.id || '',
			metadata: { pack, provider, paymentRef },
		}).catch(() => null);

		await clearCreditThresholdFlags(subscription.id);
		const result = { fulfilled: true, balance, purchasedCredits: purchased, credits };
		await logBillingAction({
			action: 'Credits purchased',
			eventType: 'credits_purchased',
			workspaceKey,
			workspaceName: subscription.workspace_name,
			actor,
			provider,
			credits,
			idempotencyKey: key,
			metadata: result,
		});
		await completeIdempotency(idem.record.id, result);
		return result;
	} catch (error) {
		await failIdempotency(idem.record.id, error?.message || String(error));
		throw error;
	}
}
