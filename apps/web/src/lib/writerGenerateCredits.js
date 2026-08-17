/**
 * AI Writer Generate wallet preflight.
 * Cost comes from platform featureCosts.ai_writer (never hardcoded here).
 * Remaining comes from GET /workspace/v1/credits remaining/balance.
 */

export function readWriterCreditCost(source = {}) {
	const nested = source?.credits && typeof source.credits === 'object' ? source.credits : null;
	const raw = source?.featureCosts?.ai_writer ?? nested?.featureCosts?.ai_writer;
	const cost = Number(raw);
	return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function readWriterCreditRemaining(source = {}) {
	if (!source || typeof source !== 'object') return null;
	const nested = source.credits && typeof source.credits === 'object' ? source.credits : null;
	if (source.remaining == null && source.balance == null && source.creditsBalance == null) {
		if (nested) return readWriterCreditRemaining(nested);
		return null;
	}
	const raw = source.remaining ?? source.balance ?? source.creditsBalance;
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

/**
 * Whether Writer Generate/Regenerate/Retry may call /integrated-ai/stream.
 * Unknown remaining → allow (API 402 remains the safety net).
 * Known remaining 0 blocks unless the catalog cost is explicitly 0.
 */
export function canStartWriterGeneration({ remaining, cost } = {}) {
	const remainingKnown = remaining != null && remaining !== '';
	const costKnown = cost != null && cost !== '';
	const have = Number(remaining);
	const required = Number(cost);

	if (remainingKnown && Number.isFinite(have) && have <= 0) {
		if (!costKnown || !Number.isFinite(required) || required > 0) return false;
		return true;
	}

	if (!costKnown || !Number.isFinite(required) || required < 0) return true;
	if (!remainingKnown || !Number.isFinite(have)) return true;
	return have >= required;
}

export function isWriterInsufficientCreditsError(error) {
	const status = Number(error?.status || error?.statusCode || 0);
	const code = String(error?.errorCode || '').toUpperCase();
	if (status === 402 || code === 'INSUFFICIENT_CREDITS') return true;
	return /\bINSUFFICIENT_CREDITS\b/i.test(String(error?.message || ''));
}
