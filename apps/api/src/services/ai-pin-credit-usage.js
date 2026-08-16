/**
 * Customer-facing AI/image credit remaining, used, and limit.
 * Source of truth: the credits-engine workspace wallet for an explicit workspace key.
 *
 * Consume helpers here never write users.ai_credits_used / image_credits_used.
 * Wallet burn still happens in credits-engine via injected consumeFeatureCredits.
 */
import { isBillableAiResultSource } from './ai-billing-policy.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function consumeWorkspaceKey(workspaceKey, userId) {
	return String(workspaceKey || '').trim() || String(userId || '').trim();
}

export function requireExplicitWorkspaceKey(workspaceKey) {
	const key = String(workspaceKey || '').trim();
	if (!key) {
		throw httpError(422, 'workspaceKey is required', 'VALIDATION_ERROR');
	}
	return key;
}

/**
 * Map a credits-engine wallet onto the existing AI/image usage DTO.
 * Single workspace wallet — both buckets share remaining / used / limit.
 */
export function creditUsageFromWallet(wallet) {
	if (!wallet || typeof wallet !== 'object') {
		throw httpError(404, 'Workspace wallet not found', 'NOT_FOUND');
	}
	const remaining = Number(wallet.remaining);
	const used = Number(wallet.usedTotal);
	const limit = Number(wallet.monthlyQuota);
	const bucket = {
		used: Number.isFinite(used) ? used : 0,
		limit: Number.isFinite(limit) ? limit : 0,
		remaining: Number.isFinite(remaining) ? remaining : 0,
	};
	return {
		plan: wallet.planSlug || '',
		ai: { ...bucket },
		image: { ...bucket },
		wallet,
	};
}

export async function readWorkspaceCreditUsage(workspaceKeyOverride, getWalletFn) {
	const workspaceKey = requireExplicitWorkspaceKey(workspaceKeyOverride);
	const wallet = await getWalletFn(workspaceKey);
	return creditUsageFromWallet(wallet);
}

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
} = {}, deps = {}) {
	if (!isBillableAiResultSource(source)) {
		return null;
	}
	const consume = deps.consumeFeatureCredits;
	if (typeof consume !== 'function') {
		throw httpError(500, 'consumeFeatureCredits is required', 'INTERNAL_ERROR');
	}
	const key = consumeWorkspaceKey(workspaceKey, userId);
	return consume(pocketbaseClient, {
		userId,
		workspaceKey: key,
		feature,
		units,
		reason: reason || `Consume ${feature}`,
		referenceId,
		idempotencyKey,
		metadata: { ...metadata, resultSource: source },
	});
}

export async function consumeCredits(pocketbaseClient, {
	userId,
	workspaceKey = '',
	ai = 0,
	image = 0,
} = {}, deps = {}) {
	const aiCount = Number(ai) || 0;
	const imageCount = Number(image) || 0;
	const key = consumeWorkspaceKey(workspaceKey, userId);
	const consume = deps.consumeFeatureCredits;
	const usageFn = deps.getUserCreditUsage;
	if (typeof consume !== 'function' || typeof usageFn !== 'function') {
		throw httpError(500, 'consume helpers are required', 'INTERNAL_ERROR');
	}

	if (aiCount > 0) {
		await consume(pocketbaseClient, {
			userId,
			workspaceKey: key,
			feature: aiCount > 1 ? 'ai_writer' : 'ai_analyze',
			units: aiCount,
			reason: `AI credits ×${aiCount}`,
			metadata: { legacyAiUnits: aiCount },
		});
	}
	if (imageCount > 0) {
		await consume(pocketbaseClient, {
			userId,
			workspaceKey: key,
			feature: 'ai_image',
			units: imageCount,
			reason: `Image credits ×${imageCount}`,
			metadata: { legacyImageUnits: imageCount },
		});
	}

	return usageFn(pocketbaseClient, userId, key);
}
