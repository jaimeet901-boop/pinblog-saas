import {
	buildPaddleCreditPackIdempotencyKey,
	extractCustomDataFromPaddleTransaction,
	extractPriceIdFromPaddleTransaction,
} from './paddle-transaction-verification.js';
import { resolveRegistryEntryByPriceId } from './price-registry.js';

/** Paddle adjustment actions that represent entitlement-affecting refunds (Phase 4.2). */
export const PADDLE_REFUND_ADJUSTMENT_ACTIONS = Object.freeze(['refund', 'chargeback']);

/** Transaction statuses indicating refund on authoritative Paddle transaction API state. */
export const PADDLE_REFUNDED_TRANSACTION_STATUSES = Object.freeze([
	'refunded',
	'partially_refunded',
	'charged_back',
]);

export function normalizePaddleAdjustmentAction(action = '') {
	return String(action || '').trim().toLowerCase();
}

export function isPaddleRefundAdjustmentAction(action = '') {
	return PADDLE_REFUND_ADJUSTMENT_ACTIONS.includes(normalizePaddleAdjustmentAction(action));
}

export function extractPaddleAdjustmentFromWebhook(payload = {}) {
	const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
	return {
		adjustmentId: String(data.id || '').trim(),
		action: normalizePaddleAdjustmentAction(data.action),
		transactionId: String(data.transaction_id || '').trim(),
		subscriptionId: String(data.subscription_id || '').trim(),
	};
}

export function verifyPaddleAdjustmentForRefund({ adjustment, webhookAdjustment = {} } = {}) {
	if (!adjustment || typeof adjustment !== 'object') {
		return { ok: false, error: 'paddle_adjustment_missing' };
	}

	const adjustmentId = String(adjustment.id || webhookAdjustment.adjustmentId || '').trim();
	if (!adjustmentId) return { ok: false, error: 'paddle_adjustment_id_missing' };

	const action = normalizePaddleAdjustmentAction(adjustment.action || webhookAdjustment.action);
	if (!isPaddleRefundAdjustmentAction(action)) {
		return { ok: false, error: 'paddle_adjustment_not_refund', action };
	}

	const transactionId = String(
		adjustment.transaction_id
		|| webhookAdjustment.transactionId
		|| '',
	).trim();
	if (!transactionId) return { ok: false, error: 'paddle_refund_transaction_id_missing' };

	const subscriptionId = String(
		adjustment.subscription_id
		|| webhookAdjustment.subscriptionId
		|| '',
	).trim();

	return {
		ok: true,
		adjustmentId,
		action,
		transactionId,
		subscriptionId,
	};
}

export function verifyPaddleTransactionRefundState(transaction = {}) {
	const status = String(transaction?.status || '').trim().toLowerCase();
	if (!status) return { ok: false, error: 'paddle_transaction_status_missing' };
	if (!PADDLE_REFUNDED_TRANSACTION_STATUSES.includes(status)) {
		return { ok: false, error: 'paddle_transaction_not_refunded', status };
	}
	return { ok: true, status };
}

/**
 * Classify a refunded Paddle transaction as subscription vs credit pack using registry metadata.
 */
export function classifyPaddleRefundPurchaseKind({
	transaction,
	registryEntries = [],
	environment = '',
} = {}) {
	const priceId = extractPriceIdFromPaddleTransaction(transaction);
	if (!priceId) return { ok: false, error: 'paddle_refund_price_missing' };

	const registryEntry = resolveRegistryEntryByPriceId(registryEntries, {
		provider: 'paddle',
		environment,
		priceId,
	});
	if (!registryEntry) {
		return { ok: false, error: 'paddle_refund_price_not_in_registry', priceId };
	}

	if (registryEntry.interval === 'one_time' && registryEntry.packId) {
		return {
			ok: true,
			kind: 'credit_pack',
			packId: registryEntry.packId,
			priceId,
			registryEntry,
		};
	}

	if (registryEntry.planSlug) {
		return {
			ok: true,
			kind: 'subscription',
			planSlug: registryEntry.planSlug,
			priceId,
			registryEntry,
			subscriptionId: String(transaction.subscription_id || '').trim(),
		};
	}

	return { ok: false, error: 'paddle_refund_registry_unclassified', priceId };
}

export function verifyPaddleRefundWorkspaceIdentity({
	transaction,
	webhookContext = {},
	subscriptionRecord = null,
	kind = '',
	subscriptionId = '',
} = {}) {
	const apiCustom = extractCustomDataFromPaddleTransaction(transaction);
	const workspaceKey = apiCustom.workspaceKey || String(webhookContext.workspaceKey || '').trim();
	if (!workspaceKey) return { ok: false, error: 'paddle_refund_workspace_missing' };

	if (apiCustom.workspaceKey && webhookContext.workspaceKey
		&& apiCustom.workspaceKey !== webhookContext.workspaceKey) {
		return { ok: false, error: 'paddle_refund_workspace_metadata_mismatch' };
	}

	if (kind === 'subscription' && subscriptionRecord) {
		const expectedSubId = String(subscriptionRecord.paddle_subscription_id || '').trim();
		const verifiedSubId = String(subscriptionId || transaction.subscription_id || '').trim();
		if (expectedSubId && verifiedSubId && expectedSubId !== verifiedSubId) {
			return { ok: false, error: 'paddle_refund_subscription_identity_mismatch' };
		}
		if (subscriptionRecord.workspace_key && subscriptionRecord.workspace_key !== workspaceKey) {
			return { ok: false, error: 'paddle_refund_workspace_subscription_mismatch' };
		}
	}

	return { ok: true, workspaceKey, customData: apiCustom };
}

export function buildPaddleRefundIdempotencyKey({ adjustmentId = '', transactionId = '' } = {}) {
	const adjustment = String(adjustmentId || '').trim();
	if (adjustment) return `paddle-refund:adj:${adjustment}`.slice(0, 180);
	const txn = String(transactionId || '').trim();
	if (txn) return `paddle-refund:txn:${txn}`.slice(0, 180);
	return '';
}

export function buildPaddleCreditPackPurchaseLookupKey(transactionId = '') {
	return buildPaddleCreditPackIdempotencyKey(transactionId);
}
