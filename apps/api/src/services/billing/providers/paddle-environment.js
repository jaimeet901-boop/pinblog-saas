import { deriveBillingEnvironmentFromPaddleConfig } from '../billing-model.js';

/**
 * Resolve effective Paddle billing environment from control-plane config.
 * Does not trust mode alone when sandbox flag is explicit.
 */
export function deriveEffectivePaddleEnvironment(config = {}) {
	const sandboxFlag = config.sandbox === true || process.env.PADDLE_SANDBOX === '1';
	const sandboxExplicitOff = config.sandbox === false && process.env.PADDLE_SANDBOX !== '1';

	if (sandboxFlag && (config.mode === 'live' || process.env.PADDLE_MODE === 'live')) {
		return { ok: false, error: 'paddle_environment_conflict_sandbox_and_live' };
	}

	if (sandboxFlag) return { ok: true, environment: 'sandbox' };
	if (sandboxExplicitOff || config.mode === 'live') return { ok: true, environment: 'live' };

	const derived = deriveBillingEnvironmentFromPaddleConfig(config);
	if (derived) return { ok: true, environment: derived };

	return { ok: false, error: 'paddle_environment_unconfigured' };
}

export function resolvePaddleApiBase(environment) {
	if (environment === 'sandbox') return 'https://sandbox-api.paddle.com';
	if (environment === 'live') return 'https://api.paddle.com';
	return null;
}

export function assertPaddleEnvironmentMatch(configuredEnvironment, transactionOrigin = '') {
	const normalizedOrigin = String(transactionOrigin || '').trim().toLowerCase();
	if (!normalizedOrigin) return { ok: true };
	if (normalizedOrigin === configuredEnvironment) return { ok: true };
	return { ok: false, error: 'paddle_environment_mismatch', configuredEnvironment, transactionOrigin: normalizedOrigin };
}
