/**
 * AI Pins credit adapter — thin wrapper over the platform Credits Engine.
 * Costs always come from resolveFeatureCost(feature). Do not add feature-specific pricing here.
 */
import { workspaceKeyForUser } from './workspace-context.js';
import {
	consumeWorkspaceCredits,
	resolveFeatureCost,
	getWallet,
	ensureWorkspaceWallet,
} from './credits-engine.js';
import { isBillableAiResultSource } from './ai-billing-policy.js';

export { isBillableAiResultSource } from './ai-billing-policy.js';

const PLAN_CREDITS = {
	free: { ai: 50, image: 20 },
	starter: { ai: 300, image: 100 },
	pro: { ai: 1000, image: 400 },
	agency: { ai: 5000, image: 2000 },
	business: { ai: 2500, image: 1000 },
	enterprise: { ai: 10000, image: 5000 },
};

export function getPlanCreditLimits(plan) {
	const key = String(plan || 'free').toLowerCase();
	if (key === 'agency') return PLAN_CREDITS.business;
	return PLAN_CREDITS[key] || PLAN_CREDITS.free;
}

export async function getUserCreditUsage(pocketbaseClient, userId, workspaceKeyOverride = '') {
	const user = await pocketbaseClient.collection('users').getOne(userId).catch(() => null);
	const plan = user?.plan || 'free';
	const limits = getPlanCreditLimits(plan);
	const aiUsed = Number(user?.ai_credits_used || 0);
	const imageUsed = Number(user?.image_credits_used || 0);

	const workspaceKey = workspaceKeyOverride || workspaceKeyForUser(userId);
	await ensureWorkspaceWallet(workspaceKey, {
		workspaceName: user?.name || user?.email || workspaceKey,
		ownerEmail: user?.email || '',
		planSlug: plan,
	}).catch(() => null);

	let wallet = null;
	try {
		wallet = await getWallet(workspaceKey);
	} catch {
		wallet = null;
	}

	const remainingFromWallet = wallet ? Number(wallet.remaining) || 0 : null;

	return {
		plan: wallet?.planSlug || plan,
		ai: {
			used: aiUsed,
			limit: limits.ai,
			remaining: remainingFromWallet != null
				? remainingFromWallet
				: Math.max(0, limits.ai - aiUsed),
		},
		image: {
			used: imageUsed,
			limit: limits.image,
			remaining: remainingFromWallet != null
				? remainingFromWallet
				: Math.max(0, limits.image - imageUsed),
		},
		wallet,
	};
}

export async function consumeFeatureCredits(pocketbaseClientArg, {
	userId,
	workspaceKey: workspaceKeyInput = '',
	feature,
	units = 1,
	reason = '',
	referenceId = '',
	idempotencyKey = '',
	metadata = {},
} = {}) {
	const pb = pocketbaseClientArg || (await import('../utils/pocketbaseClient.js')).default;
	const user = await pb.collection('users').getOne(userId).catch(() => null);
	const workspaceKey = String(workspaceKeyInput || '').trim() || workspaceKeyForUser(userId);
	await ensureWorkspaceWallet(workspaceKey, {
		workspaceName: user?.name || user?.email || workspaceKey,
		ownerEmail: user?.email || '',
		planSlug: user?.plan || 'free',
	});
	const unitCost = await resolveFeatureCost(feature);
	const amount = unitCost * Math.max(1, Number(units) || 1);
	return consumeWorkspaceCredits({
		workspaceKey,
		amount,
		feature,
		reason: reason || `Consume ${feature}`,
		actor: userId,
		referenceId,
		idempotencyKey,
		metadata,
	});
}

/**
 * Charge a specific AI feature only after successful provider generation.
 * No-op for heuristic/template-only fallbacks.
 */
export async function consumeBillableAiFeature(pocketbaseClient, {
	userId,
	workspaceKey = '',
	feature,
	source,
	units = 1,
	reason = '',
	referenceId = '',
	idempotencyKey = '',
	metadata = {},
} = {}) {
	if (!isBillableAiResultSource(source)) {
		return null;
	}
	const key = String(workspaceKey || '').trim() || workspaceKeyForUser(userId);
	const result = await consumeFeatureCredits(pocketbaseClient, {
		userId,
		workspaceKey: key,
		feature,
		units,
		reason: reason || `Consume ${feature}`,
		referenceId,
		idempotencyKey,
		metadata: { ...metadata, resultSource: source },
	});

	const user = await pocketbaseClient.collection('users').getOne(userId).catch(() => null);
	if (user) {
		const aiBump = feature === 'ai_image' ? 0 : Math.max(1, Number(units) || 1);
		const imageBump = feature === 'ai_image' ? Math.max(1, Number(units) || 1) : 0;
		await pocketbaseClient.collection('users').update(userId, {
			ai_credits_used: Number(user.ai_credits_used || 0) + aiBump,
			image_credits_used: Number(user.image_credits_used || 0) + imageBump,
		}).catch(() => null);
	}

	return result;
}

export async function consumeCredits(pocketbaseClient, {
	userId,
	workspaceKey = '',
	ai = 0,
	image = 0,
}) {
	const aiCount = Number(ai) || 0;
	const imageCount = Number(image) || 0;
	const key = String(workspaceKey || '').trim() || workspaceKeyForUser(userId);

	if (aiCount > 0) {
		await consumeFeatureCredits(pocketbaseClient, {
			userId,
			workspaceKey: key,
			feature: aiCount > 1 ? 'ai_writer' : 'ai_analyze',
			units: aiCount,
			reason: `AI credits ×${aiCount}`,
			metadata: { legacyAiUnits: aiCount },
		});
	}
	if (imageCount > 0) {
		await consumeFeatureCredits(pocketbaseClient, {
			userId,
			workspaceKey: key,
			feature: 'ai_image',
			units: imageCount,
			reason: `Image credits ×${imageCount}`,
			metadata: { legacyImageUnits: imageCount },
		});
	}

	// Keep legacy counters for dashboards that still read users.* fields.
	const user = await pocketbaseClient.collection('users').getOne(userId).catch(() => null);
	if (user) {
		await pocketbaseClient.collection('users').update(userId, {
			ai_credits_used: Number(user.ai_credits_used || 0) + aiCount,
			image_credits_used: Number(user.image_credits_used || 0) + imageCount,
		}).catch(() => null);
	}

	return getUserCreditUsage(pocketbaseClient, userId);
}

export async function recordGenerationHistory(pocketbaseClient, payload) {
	try {
		return await pocketbaseClient.collection('ai_pin_generation_history').create(payload);
	} catch {
		return null;
	}
}
