/**
 * CR-P0-4 — reserve workspace credits before AI analyze / image-prompt provider calls.
 *
 * Features (existing catalog only):
 *   ai_analyze — POST /ai-pins/analyze, and /ai-pins/prompts when analysis is not provided
 *   ai_prompt  — POST /ai-pins/prompts
 *
 * They are separate costs (1 + 1). Prompts that internally analyze take two
 * reservations, both begun before any Gemini/OpenAI call, so a short wallet
 * cannot spend the first provider then 402 on the second.
 *
 * Heuristic / template sources are not billable: reservation is released.
 * Wallet identity is an explicit workspace key. Never owner/user id.
 */

import { isBillableAiResultSource } from './ai-billing-policy.js';

export const ANALYZE_CREDIT_FEATURE = 'ai_analyze';
export const PROMPT_CREDIT_FEATURE = 'ai_prompt';
export const PIN_TEXT_CREDIT_FEATURES = Object.freeze([
	ANALYZE_CREDIT_FEATURE,
	PROMPT_CREDIT_FEATURE,
]);

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function trimStr(value) {
	return String(value || '').trim();
}

export function requirePinTextWorkspaceKey(workspaceKey) {
	const key = trimStr(workspaceKey);
	if (!key) {
		throw httpError(422, 'workspaceKey is required', 'WORKSPACE_KEY_REQUIRED');
	}
	return key;
}

export function requirePinTextCreditFeature(feature) {
	const key = trimStr(feature).toLowerCase();
	if (!PIN_TEXT_CREDIT_FEATURES.includes(key)) {
		throw httpError(
			422,
			'creditFeature is not a registered pin-text credit feature',
			'CREDIT_FEATURE_UNKNOWN',
		);
	}
	return key;
}

export function pinTextCreditIdempotencyKey({
	feature,
	idempotencyKey = '',
	referenceId = '',
} = {}) {
	const provided = trimStr(idempotencyKey).slice(0, 120);
	if (provided) return provided;
	const feat = trimStr(feature).toLowerCase() || 'pin-text';
	const ref = trimStr(referenceId) || 'noref';
	return `${feat}:${ref}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`.slice(0, 120);
}

async function loadEngineFns(deps = {}) {
	const begin = deps.beginFeatureReservation
		|| (await import('./credits-engine.js')).beginFeatureReservation;
	const settle = deps.settleFeatureReservation
		|| (await import('./credits-engine.js')).settleFeatureReservation;
	return { begin, settle };
}

/**
 * Begin a reservation. Does not call a provider.
 * Caller must settle (commit on billable success, release otherwise).
 */
export async function reservePinTextFeatureCredits(input = {}, deps = {}) {
	const feature = requirePinTextCreditFeature(input.feature);
	const workspaceKey = requirePinTextWorkspaceKey(input.workspaceKey);
	const { begin, settle } = await loadEngineFns(deps);
	const actor = trimStr(input.actorUserId) || 'system';
	const idempotencyKey = pinTextCreditIdempotencyKey({
		feature,
		idempotencyKey: input.idempotencyKey,
		referenceId: input.referenceId,
	});

	const reservation = await begin({
		workspaceKey,
		feature,
		units: 1,
		reason: input.reason || (feature === PROMPT_CREDIT_FEATURE
			? 'AI image prompt generation'
			: 'AI pin analysis'),
		actorUserId: actor,
		referenceId: trimStr(input.referenceId).slice(0, 120),
		idempotencyKey,
		ttlMs: input.ttlMs || 15 * 60 * 1000,
		metadata: {
			source: 'ai-pins/text',
			creditFeature: feature,
			...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
		},
		wallet: input.wallet || null,
	});

	if (reservation?.noop) {
		return {
			feature,
			reservation,
			settle: async () => ({ settled: 'noop', reservation }),
		};
	}

	const status = trimStr(reservation?.status).toLowerCase();
	if (status === 'committed') {
		throw httpError(
			409,
			'Reservation already committed for this pin-text attempt',
			'CREDIT_RESERVATION_COMMITTED',
		);
	}
	if (status !== 'reserved') {
		throw httpError(
			409,
			'Reservation is not active for this pin-text attempt',
			'CREDIT_RESERVATION_INACTIVE',
		);
	}

	const reservationId = trimStr(reservation?.id);
	if (!reservationId) {
		throw httpError(500, 'Pin-text credit reservation is missing an id', 'CREDIT_RESERVATION_INVALID');
	}

	return {
		feature,
		reservation,
		settle: async ({ success } = {}) => settle(reservationId, {
			success: Boolean(success),
			actor,
			metadata: {
				source: 'ai-pins/text',
				feature,
			},
		}),
	};
}

export async function settlePinTextBySource(gate, source) {
	if (!gate?.settle) return { settled: 'noop', reservation: null };
	if (gate.reservation?.noop) {
		return gate.settle();
	}
	return gate.settle({ success: isBillableAiResultSource(source) });
}

/**
 * Reserve → run provider-backed work → commit if source is billable, else release.
 */
export async function withPinTextFeatureCredits(input, execute, deps = {}) {
	if (typeof execute !== 'function') {
		throw httpError(422, 'execute callback is required', 'VALIDATION_ERROR');
	}
	const gate = await reservePinTextFeatureCredits(input, deps);
	try {
		const result = await execute(gate);
		await settlePinTextBySource(gate, result?.source);
		return result;
	} catch (error) {
		await gate.settle({ success: false }).catch(() => null);
		throw error;
	}
}

/**
 * Prompts route helper: reserve ai_analyze (when needed) and ai_prompt
 * BEFORE any provider call, then run analyze/prompt and settle each by source.
 */
export async function withAnalyzeAndPromptCredits({
	analysisProvided = false,
	workspaceKey,
	actorUserId = '',
	referenceId = '',
	analyzeIdempotencyKey = '',
	promptIdempotencyKey = '',
	analyzeMetadata = {},
	promptMetadata = {},
	wallet = null,
	runAnalyze,
	runPrompt,
} = {}, deps = {}) {
	if (typeof runPrompt !== 'function') {
		throw httpError(422, 'runPrompt is required', 'VALIDATION_ERROR');
	}
	if (!analysisProvided && typeof runAnalyze !== 'function') {
		throw httpError(422, 'runAnalyze is required', 'VALIDATION_ERROR');
	}

	const shared = {
		workspaceKey,
		actorUserId,
		referenceId,
		wallet,
	};

	let analyzeGate = null;
	let promptGate = null;
	try {
		if (!analysisProvided) {
			analyzeGate = await reservePinTextFeatureCredits({
				...shared,
				feature: ANALYZE_CREDIT_FEATURE,
				idempotencyKey: analyzeIdempotencyKey,
				reason: 'AI pin analysis (during prompt)',
				metadata: analyzeMetadata,
			}, deps);
		}
		promptGate = await reservePinTextFeatureCredits({
			...shared,
			feature: PROMPT_CREDIT_FEATURE,
			idempotencyKey: promptIdempotencyKey,
			reason: 'AI image prompt generation',
			metadata: promptMetadata,
		}, deps);
	} catch (error) {
		if (analyzeGate) await analyzeGate.settle({ success: false }).catch(() => null);
		throw error;
	}

	try {
		let resolvedAnalysis = null;
		if (!analysisProvided) {
			resolvedAnalysis = await runAnalyze(analyzeGate);
			await settlePinTextBySource(analyzeGate, resolvedAnalysis?.source);
			analyzeGate = null;
		}
		const promptResult = await runPrompt(resolvedAnalysis, promptGate);
		await settlePinTextBySource(promptGate, promptResult?.source);
		promptGate = null;
		return { resolvedAnalysis, promptResult };
	} catch (error) {
		if (analyzeGate) await analyzeGate.settle({ success: false }).catch(() => null);
		if (promptGate) await promptGate.settle({ success: false }).catch(() => null);
		throw error;
	}
}
