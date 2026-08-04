/**
 * In-process runtime health + usage counters for the Universal AI Runtime.
 * Complements ai_providers.last_* fields; survives for the API process lifetime.
 */

/** @type {Map<string, object>} */
const stateByCode = new Map();

function emptyState(code) {
	return {
		code: String(code || '').toLowerCase(),
		available: false,
		enabled: false,
		configured: false,
		healthy: false,
		lastSuccessfulRequest: null,
		lastFailure: null,
		latencyMs: null,
		requestCount: 0,
		successCount: 0,
		failureCount: 0,
		fallbackCount: 0,
		tokensPrompt: 0,
		tokensCompletion: 0,
		estimatedCostUsd: 0,
		updatedAt: null,
	};
}

export function getRuntimeHealthState(code) {
	const normalized = String(code || '').trim().toLowerCase();
	if (!normalized) return emptyState('');
	if (!stateByCode.has(normalized)) {
		stateByCode.set(normalized, emptyState(normalized));
	}
	return { ...stateByCode.get(normalized) };
}

export function listRuntimeHealthStates() {
	return [...stateByCode.values()].map((item) => ({ ...item }));
}

/**
 * Merge Admin provider row flags into runtime health snapshot (non-destructive to counters).
 */
export function syncRuntimeHealthFromProvider(provider, { available = false } = {}) {
	const code = String(provider?.code || '').trim().toLowerCase();
	if (!code) return getRuntimeHealthState('');

	const current = getRuntimeHealthState(code);
	const health = String(provider?.health || '').toLowerCase();
	const healthy = health === 'healthy' || current.healthy;

	const next = {
		...current,
		code,
		available: Boolean(available),
		enabled: Boolean(provider?.enabled),
		configured: Boolean(
			provider?.configured
			?? (provider?.config?.hasApiKey || provider?.config?.hasSecretKey),
		),
		healthy: Boolean(provider?.enabled) && Boolean(
			provider?.configured
			?? (provider?.config?.hasApiKey || provider?.config?.hasSecretKey),
		) && healthy,
		latencyMs: provider?.lastLatencyMs != null ? Number(provider.lastLatencyMs) : current.latencyMs,
		lastSuccessfulRequest: provider?.lastSuccess && provider.lastSuccess !== '—'
			? provider.lastSuccess
			: current.lastSuccessfulRequest,
		lastFailure: provider?.lastError && provider.lastError !== '—'
			? { at: provider.lastChecked || current.lastFailure?.at || null, message: provider.lastError }
			: current.lastFailure,
		updatedAt: new Date().toISOString(),
	};
	stateByCode.set(code, next);
	return { ...next };
}

/**
 * @param {string} code
 * @param {{
 *   ok: boolean,
 *   latencyMs?: number,
 *   errorMessage?: string,
 *   tokensPrompt?: number,
 *   tokensCompletion?: number,
 *   estimatedCostUsd?: number,
 *   fallback?: boolean,
 * }} outcome
 */
export function recordRuntimeRequestOutcome(code, outcome = {}) {
	const normalized = String(code || '').trim().toLowerCase();
	if (!normalized) return emptyState('');

	const current = getRuntimeHealthState(normalized);
	const now = new Date().toISOString();
	const latencyMs = Number(outcome.latencyMs);
	const tokensPrompt = Math.max(0, Number(outcome.tokensPrompt) || 0);
	const tokensCompletion = Math.max(0, Number(outcome.tokensCompletion) || 0);
	const estimatedCostUsd = Math.max(0, Number(outcome.estimatedCostUsd) || 0);

	const next = {
		...current,
		code: normalized,
		requestCount: current.requestCount + 1,
		tokensPrompt: current.tokensPrompt + tokensPrompt,
		tokensCompletion: current.tokensCompletion + tokensCompletion,
		estimatedCostUsd: Number((current.estimatedCostUsd + estimatedCostUsd).toFixed(8)),
		updatedAt: now,
	};

	if (outcome.fallback) {
		next.fallbackCount = current.fallbackCount + 1;
	}

	if (outcome.ok) {
		next.successCount = current.successCount + 1;
		next.healthy = true;
		next.lastSuccessfulRequest = now;
		if (Number.isFinite(latencyMs)) next.latencyMs = latencyMs;
	} else {
		next.failureCount = current.failureCount + 1;
		next.healthy = false;
		next.lastFailure = {
			at: now,
			message: String(outcome.errorMessage || 'request failed').slice(0, 500),
		};
		if (Number.isFinite(latencyMs)) next.latencyMs = latencyMs;
	}

	stateByCode.set(normalized, next);
	return { ...next };
}

/** Test helper */
export function resetRuntimeHealthStateForTests() {
	stateByCode.clear();
}
