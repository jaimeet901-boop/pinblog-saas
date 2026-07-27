/**
 * AI Pins credit adapter — burns through the centralized Credits Engine.
 * Keeps legacy user.ai_credits_used / image_credits_used counters for UI compatibility.
 */
import { workspaceKeyForUser } from './workspace-context.js';
import {
	consumeWorkspaceCredits,
	resolveFeatureCost,
	getWallet,
	ensureWorkspaceWallet,
} from './credits-engine.js';

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

export async function getUserCreditUsage(pocketbaseClient, userId) {
	const user = await pocketbaseClient.collection('users').getOne(userId).catch(() => null);
	const plan = user?.plan || 'free';
	const limits = getPlanCreditLimits(plan);
	const aiUsed = Number(user?.ai_credits_used || 0);
	const imageUsed = Number(user?.image_credits_used || 0);

	const workspaceKey = workspaceKeyForUser(userId);
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
	feature,
	units = 1,
	reason = '',
	referenceId = '',
	idempotencyKey = '',
	metadata = {},
} = {}) {
	const pb = pocketbaseClientArg || (await import('../utils/pocketbaseClient.js')).default;
	const user = await pb.collection('users').getOne(userId).catch(() => null);
	const workspaceKey = workspaceKeyForUser(userId);
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

export async function consumeCredits(pocketbaseClient, { userId, ai = 0, image = 0 }) {
	const aiCount = Number(ai) || 0;
	const imageCount = Number(image) || 0;

	if (aiCount > 0) {
		await consumeFeatureCredits(pocketbaseClient, {
			userId,
			feature: aiCount > 1 ? 'ai_writer' : 'ai_analyze',
			units: aiCount,
			reason: `AI credits ×${aiCount}`,
			metadata: { legacyAiUnits: aiCount },
		});
	}
	if (imageCount > 0) {
		await consumeFeatureCredits(pocketbaseClient, {
			userId,
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
