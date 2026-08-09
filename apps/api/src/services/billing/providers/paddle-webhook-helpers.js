import crypto from 'node:crypto';

/** Paid subscription slugs that require explicit Paddle price mapping (Free is app-internal). */
export const PADDLE_PAID_PLAN_SLUGS = Object.freeze(['starter', 'pro', 'business', 'enterprise']);

const DEFAULT_TIMESTAMP_TOLERANCE_SECONDS = 5;

/**
 * Parse Paddle-Signature header: ts=...;h1=... (multiple h1 during secret rotation).
 * @returns {{ ts: string, signatures: string[] } | null}
 */
export function parsePaddleSignatureHeader(signatureHeader) {
	const header = String(signatureHeader || '').trim();
	if (!header) return null;

	let ts = '';
	const signatures = [];
	for (const part of header.split(';')) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		if (key === 'ts') ts = value;
		if (key === 'h1' && value) signatures.push(value);
	}

	if (!ts || signatures.length === 0) return null;
	return { ts, signatures };
}

function timingSafeEqualHex(a, b) {
	const left = Buffer.from(String(a || ''), 'utf8');
	const right = Buffer.from(String(b || ''), 'utf8');
	if (left.length !== right.length) return false;
	return crypto.timingSafeEqual(left, right);
}

/**
 * Verify Paddle Billing webhook signature (HMAC-SHA256 over "{ts}:{rawBody}").
 * @see https://developer.paddle.com/webhooks/signature-verification
 */
export function verifyPaddleWebhookSignature({
	rawBody,
	signatureHeader,
	secret,
	toleranceSeconds = DEFAULT_TIMESTAMP_TOLERANCE_SECONDS,
	now = Date.now(),
} = {}) {
	const body = typeof rawBody === 'string' ? rawBody : '';
	const key = String(secret || '').trim();
	if (!key) return { ok: false, error: 'paddle_webhook_secret_missing' };
	if (!body) return { ok: false, error: 'paddle_webhook_raw_body_missing' };

	const parsed = parsePaddleSignatureHeader(signatureHeader);
	if (!parsed) return { ok: false, error: 'paddle_signature_malformed' };

	const tsNumber = Number(parsed.ts);
	if (!Number.isFinite(tsNumber) || tsNumber <= 0) {
		return { ok: false, error: 'paddle_signature_malformed' };
	}

	const ageSeconds = Math.floor(now / 1000) - tsNumber;
	if (ageSeconds > toleranceSeconds || ageSeconds < -toleranceSeconds) {
		return { ok: false, error: 'paddle_webhook_timestamp_expired' };
	}

	const signedPayload = `${parsed.ts}:${body}`;
	const expected = crypto
		.createHmac('sha256', key)
		.update(signedPayload, 'utf8')
		.digest('hex');

	const matched = parsed.signatures.some((sig) => timingSafeEqualHex(sig, expected));
	if (!matched) {
		return { ok: false, error: 'paddle_signature_invalid' };
	}

	return { ok: true };
}

/**
 * Explicit per-slug price id (config.priceIds or PADDLE_PRICE_{SLUG} env).
 * Never falls back to defaultPriceId — use for checkout and webhook fulfillment safety.
 */
export function resolveExpectedPaddlePriceId(planSlug, config = {}) {
	const slug = String(planSlug || '').toLowerCase();
	const fromConfig = config?.priceIds?.[slug] || config?.prices?.[slug];
	if (fromConfig) return String(fromConfig).trim();
	const envKey = `PADDLE_PRICE_${slug.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`;
	const fromEnv = process.env[envKey];
	if (fromEnv) return String(fromEnv).trim();
	return '';
}

/**
 * Resolve price id with defaultPriceId / PADDLE_DEFAULT_PRICE_ID fallback.
 * For non-checkout callers only — checkout must use resolveCheckoutPaddlePriceId().
 */
export function resolvePaddlePriceId(planSlug, config = {}) {
	const slug = String(planSlug || '').toLowerCase();
	const explicit = resolveExpectedPaddlePriceId(slug, config);
	if (explicit) return explicit;
	return String(config?.defaultPriceId || process.env.PADDLE_DEFAULT_PRICE_ID || '').trim();
}

/**
 * Strict checkout resolution for paid plans — fails closed when explicit mapping is missing.
 * @returns {{ ok: true, priceId: string, planSlug: string } | { ok: false, error: string, planSlug: string }}
 */
export function resolveCheckoutPaddlePriceId(planSlug, config = {}) {
	const slug = String(planSlug || '').trim().toLowerCase();
	if (!PADDLE_PAID_PLAN_SLUGS.includes(slug)) {
		return { ok: false, error: 'paddle_invalid_plan_slug_for_checkout', planSlug: slug };
	}
	const priceId = resolveExpectedPaddlePriceId(slug, config);
	if (!priceId) {
		return { ok: false, error: 'paddle_price_mapping_missing', planSlug: slug };
	}
	return { ok: true, priceId, planSlug: slug };
}

/**
 * Fulfillment safety: require explicit per-slug mapping; never accept defaultPriceId fallback.
 */
export function validatePaddlePriceForPlan(planSlug, priceId, config = {}) {
	const slug = String(planSlug || '').trim().toLowerCase();
	const normalizedPriceId = String(priceId || '').trim();

	if (!PADDLE_PAID_PLAN_SLUGS.includes(slug)) {
		return { ok: false, error: 'paddle_invalid_plan_slug_for_fulfillment' };
	}
	if (!normalizedPriceId) {
		return { ok: false, error: 'paddle_missing_price_id_in_webhook' };
	}

	const expected = resolveExpectedPaddlePriceId(slug, config);
	if (!expected) {
		return { ok: false, error: `paddle_missing_price_mapping_for_${slug}` };
	}
	if (expected !== normalizedPriceId) {
		return {
			ok: false,
			error: 'paddle_price_plan_mismatch',
			expectedPriceId: expected,
			receivedPriceId: normalizedPriceId,
			planSlug: slug,
		};
	}

	return { ok: true, expectedPriceId: expected, planSlug: slug };
}

export function extractPaddlePriceId(data = {}) {
	if (!data || typeof data !== 'object') return '';

	const direct = data.price_id || data.priceId;
	if (direct) return String(direct).trim();

	const items = Array.isArray(data.items) ? data.items : [];
	for (const item of items) {
		const fromItem = item?.price_id
			|| item?.price?.id
			|| item?.price?.price_id;
		if (fromItem) return String(fromItem).trim();
	}

	const lineItems = data.details?.line_items;
	if (Array.isArray(lineItems)) {
		for (const line of lineItems) {
			const fromLine = line?.price_id
				|| line?.price?.id
				|| line?.price?.price_id;
			if (fromLine) return String(fromLine).trim();
		}
	}

	return '';
}

/**
 * Extract workspace/plan metadata from Paddle Billing webhook payloads.
 */
export function extractPaddleWebhookContext(payload = {}) {
	const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
	const customData = data.custom_data && typeof data.custom_data === 'object'
		? data.custom_data
		: {};

	const workspaceKey = String(
		customData.workspaceKey
		|| customData.workspace_key
		|| '',
	).trim();
	const planSlug = String(
		customData.planSlug
		|| customData.plan_slug
		|| '',
	).trim().toLowerCase();
	const planId = String(
		customData.planId
		|| customData.plan_id
		|| '',
	).trim();

	const transactionId = String(
		payload.event_type?.startsWith('transaction.')
			? data.id
			: data.transaction_id
		|| '',
	).trim();
	const subscriptionId = String(
		data.subscription_id
		|| (payload.event_type?.startsWith('subscription.') ? data.id : '')
		|| '',
	).trim();

	const paymentRef = String(
		transactionId
		|| subscriptionId
		|| data.id
		|| payload.event_id
		|| '',
	).slice(0, 180);

	const priceId = extractPaddlePriceId(data);

	return {
		workspaceKey,
		planSlug,
		planId,
		transactionId,
		subscriptionId,
		paymentRef,
		priceId,
		customData,
		data,
	};
}

/**
 * Classify Paddle Billing event types for webhook routing.
 * Initial fulfillment prefers transaction.completed only.
 */
export function classifyPaddleWebhookEvent(eventType) {
	const type = String(eventType || '').trim().toLowerCase();

	if (type === 'transaction.completed') {
		return {
			routing: 'subscription_success',
			routingReason: 'transaction_completed',
		};
	}
	if (type === 'transaction.payment_failed' || type === 'transaction.past_due') {
		return {
			routing: 'payment_failed',
			routingReason: type,
		};
	}
	if (type === 'subscription.canceled' || type === 'subscription.cancelled') {
		return {
			routing: 'cancel',
			routingReason: type,
		};
	}
	if (
		type === 'subscription.activated'
		|| type === 'subscription.created'
		|| type === 'subscription.updated'
	) {
		return {
			routing: 'ignored',
			routingReason: `${type}_not_fulfillment_source`,
		};
	}

	return {
		routing: 'ignored',
		routingReason: type ? `unknown_paddle_event:${type}` : 'unknown_paddle_event',
	};
}

export function buildPaddleWebhookParseResult(body = {}, config = {}) {
	const payload = body && typeof body === 'object' ? body : {};
	const eventType = String(payload.event_type || payload.alert_name || 'paddle.unknown');
	const idempotencyKey = String(
		payload.event_id
		|| payload.notification_id
		|| `paddle-${Date.now()}`,
	).slice(0, 180);

	const context = extractPaddleWebhookContext(payload);
	const classification = classifyPaddleWebhookEvent(eventType);

	let routing = classification.routing;
	let routingReason = classification.routingReason;
	let priceValidation = null;

	if (routing === 'subscription_success') {
		const status = String(context.data?.status || '').toLowerCase();
		if (status && status !== 'completed') {
			routing = 'ignored';
			routingReason = `transaction_status_${status || 'unknown'}`;
		} else if (!context.workspaceKey || !context.planSlug) {
			routing = 'deferred';
			routingReason = 'missing_workspace_or_plan_metadata';
		} else if (!PADDLE_PAID_PLAN_SLUGS.includes(context.planSlug)) {
			routing = 'deferred';
			routingReason = 'invalid_or_unpaid_plan_slug';
		} else {
			priceValidation = validatePaddlePriceForPlan(
				context.planSlug,
				context.priceId,
				config,
			);
		}
	}

	const fulfillmentKey = context.transactionId
		? `paddle-txn:${context.transactionId}`
		: (context.subscriptionId ? `paddle-sub:${context.subscriptionId}` : idempotencyKey);

	return {
		idempotencyKey,
		eventType,
		payload,
		context,
		routing,
		routingReason,
		priceValidation,
		fulfillmentKey,
	};
}
