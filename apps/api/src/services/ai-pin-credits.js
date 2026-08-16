/**
 * AI Pins credit adapter — thin wrapper over the platform Credits Engine.
 * Costs always come from resolveFeatureCost(feature). Do not add feature-specific pricing here.
 *
 * Customer-facing remaining / used / limit come ONLY from the credits-engine wallet
 * for the explicit workspace key. Do not use PLAN_CREDITS or users.*_credits_used.
 */
import {
	consumeWorkspaceCredits,
	resolveFeatureCost,
	getWallet,
	ensureWorkspaceWallet,
} from './credits-engine.js';
import { isBillableAiResultSource } from './ai-billing-policy.js';
import {
	consumeBillableAiFeature as consumeBillableAiFeatureCore,
	consumeCredits as consumeCreditsCore,
	creditUsageFromWallet,
	readWorkspaceCreditUsage,
	requireExplicitWorkspaceKey,
} from './ai-pin-credit-usage.js';

export { isBillableAiResultSource } from './ai-billing-policy.js';
export { creditUsageFromWallet, requireExplicitWorkspaceKey } from './ai-pin-credit-usage.js';

export async function getUserCreditUsage(pocketbaseClient, userId, workspaceKeyOverride = '', deps = {}) {
	return readWorkspaceCreditUsage(workspaceKeyOverride, deps.getWallet || getWallet);
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
	const workspaceKey = requireExplicitWorkspaceKey(workspaceKeyInput);
	const pb = pocketbaseClientArg || (await import('../utils/pocketbaseClient.js')).default;
	const user = await pb.collection('users').getOne(userId).catch(() => null);
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
export async function consumeBillableAiFeature(pocketbaseClient, options = {}, deps = {}) {
	return consumeBillableAiFeatureCore(pocketbaseClient, options, {
		consumeFeatureCredits: deps.consumeFeatureCredits || consumeFeatureCredits,
	});
}

export async function consumeCredits(pocketbaseClient, options = {}, deps = {}) {
	return consumeCreditsCore(pocketbaseClient, options, {
		consumeFeatureCredits: deps.consumeFeatureCredits || consumeFeatureCredits,
		getUserCreditUsage: deps.getUserCreditUsage || getUserCreditUsage,
	});
}

export async function recordGenerationHistory(pocketbaseClient, payload) {
	try {
		return await pocketbaseClient.collection('ai_pin_generation_history').create(payload);
	} catch {
		return null;
	}
}
