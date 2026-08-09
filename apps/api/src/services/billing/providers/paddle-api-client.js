import { resolvePaddleApiBase } from './paddle-environment.js';

export class PaddleApiError extends Error {
	constructor(message, { status = 0, code = '', body = null } = {}) {
		super(message);
		this.name = 'PaddleApiError';
		this.status = status;
		this.code = code;
		this.body = body;
	}

	get isNotFound() {
		return this.status === 404;
	}

	get isServerError() {
		return this.status >= 500;
	}

	get isTimeout() {
		return this.code === 'paddle_api_timeout';
	}
}

function normalizeApiKey(config = {}) {
	return String(config.apiKey || process.env.PADDLE_API_KEY || '').trim();
}

/**
 * @param {object} options
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} options.method
 * @param {string} options.path - e.g. /transactions/txn_123
 * @param {string} options.environment - sandbox|live
 * @param {object} [options.config]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 */
export async function paddleApiRequest({
	method = 'GET',
	path,
	environment,
	config = {},
	fetchImpl = fetch,
	timeoutMs = 15000,
	body = undefined,
} = {}) {
	const apiKey = normalizeApiKey(config);
	if (!apiKey) {
		throw new PaddleApiError('paddle_api_key_missing', { code: 'paddle_api_key_missing' });
	}

	const base = resolvePaddleApiBase(environment);
	if (!base) {
		throw new PaddleApiError('paddle_api_base_missing', { code: 'paddle_environment_unconfigured' });
	}

	const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
	const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
	const timer = controller
		? setTimeout(() => controller.abort(), timeoutMs)
		: null;

	try {
		const response = await fetchImpl(url, {
			method,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: body != null ? JSON.stringify(body) : undefined,
			signal: controller?.signal,
		});

		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new PaddleApiError(
				data?.error?.detail || data?.error?.code || `Paddle API ${method} ${path} failed (${response.status})`,
				{ status: response.status, code: data?.error?.code || 'paddle_api_error', body: data },
			);
		}

		return data?.data ?? data;
	} catch (error) {
		if (error?.name === 'AbortError') {
			throw new PaddleApiError('Paddle API request timed out', { code: 'paddle_api_timeout' });
		}
		if (error instanceof PaddleApiError) throw error;
		throw new PaddleApiError(error?.message || 'paddle_api_request_failed', { code: 'paddle_api_request_failed' });
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function getPaddleTransaction(transactionId, { environment, config, fetchImpl } = {}) {
	const id = String(transactionId || '').trim();
	if (!id) {
		throw new PaddleApiError('paddle_transaction_id_missing', { code: 'paddle_transaction_id_missing' });
	}
	return paddleApiRequest({
		method: 'GET',
		path: `/transactions/${encodeURIComponent(id)}`,
		environment,
		config,
		fetchImpl,
	});
}

export async function getPaddleSubscription(subscriptionId, { environment, config, fetchImpl } = {}) {
	const id = String(subscriptionId || '').trim();
	if (!id) {
		throw new PaddleApiError('paddle_subscription_id_missing', { code: 'paddle_subscription_id_missing' });
	}
	return paddleApiRequest({
		method: 'GET',
		path: `/subscriptions/${encodeURIComponent(id)}`,
		environment,
		config,
		fetchImpl,
	});
}

export async function getPaddleAdjustment(adjustmentId, { environment, config, fetchImpl } = {}) {
	const id = String(adjustmentId || '').trim();
	if (!id) {
		throw new PaddleApiError('paddle_adjustment_id_missing', { code: 'paddle_adjustment_id_missing' });
	}
	return paddleApiRequest({
		method: 'GET',
		path: `/adjustments/${encodeURIComponent(id)}`,
		environment,
		config,
		fetchImpl,
	});
}

/**
 * Schedule Paddle subscription cancellation at end of current billing period.
 * POST /subscriptions/{id}/cancel with effective_from=next_billing_period
 */
export async function cancelPaddleSubscriptionAtPeriodEnd(subscriptionId, {
	environment,
	config,
	fetchImpl,
	effectiveFrom = 'next_billing_period',
} = {}) {
	const id = String(subscriptionId || '').trim();
	if (!id) {
		throw new PaddleApiError('paddle_subscription_id_missing', { code: 'paddle_subscription_id_missing' });
	}
	const effective = String(effectiveFrom || 'next_billing_period').trim();
	if (effective !== 'next_billing_period') {
		throw new PaddleApiError('paddle_cancel_effective_from_unsupported', {
			code: 'paddle_cancel_effective_from_unsupported',
		});
	}
	return paddleApiRequest({
		method: 'POST',
		path: `/subscriptions/${encodeURIComponent(id)}/cancel`,
		environment,
		config,
		fetchImpl,
		body: { effective_from: effective },
	});
}

/** Verify Paddle cancel-at-period-end API response (scheduled_change.action=cancel, still active). */
export function verifyPaddleCancelAtPeriodEndResponse(subscription = {}) {
	const scheduledChange = subscription?.scheduled_change || subscription?.scheduledChange || null;
	if (!scheduledChange) {
		return { ok: false, error: 'paddle_cancel_scheduled_change_missing' };
	}
	const action = String(scheduledChange?.action || '').trim().toLowerCase();
	if (action !== 'cancel') {
		return { ok: false, error: 'paddle_cancel_action_invalid', action };
	}
	const effectiveAt = scheduledChange?.effective_at || scheduledChange?.effectiveAt || null;
	if (!effectiveAt) {
		return { ok: false, error: 'paddle_cancel_effective_at_missing' };
	}
	const status = String(subscription?.status || '').trim().toLowerCase();
	if (status === 'canceled' || status === 'cancelled') {
		return { ok: false, error: 'paddle_subscription_immediately_canceled', status };
	}
	return {
		ok: true,
		subscriptionId: String(subscription?.id || '').trim(),
		effectiveAt,
		scheduledChange,
	};
}
