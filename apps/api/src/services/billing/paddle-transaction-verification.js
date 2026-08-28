import { resolveBillingTypeFromPlan } from './billing-model.js';
import { extractPaddlePriceId } from './providers/paddle-webhook-helpers.js';
import { resolveRegistryEntryByPriceId } from './price-registry.js';

export const PAID_PADDLE_TRANSACTION_STATUSES = Object.freeze(['completed', 'paid', 'billed']);

export function extractPriceIdFromPaddleTransaction(transaction = {}) {
	const direct = extractPaddlePriceId(transaction);
	if (direct) return direct;

	const detailsItems = transaction?.details?.line_items;
	if (Array.isArray(detailsItems)) {
		for (const line of detailsItems) {
			const fromLine = line?.price_id || line?.price?.id;
			if (fromLine) return String(fromLine).trim();
		}
	}

	return '';
}

export function extractCustomDataFromPaddleTransaction(transaction = {}) {
	const customData = transaction?.custom_data && typeof transaction.custom_data === 'object'
		? transaction.custom_data
		: {};
	return {
		workspaceKey: String(customData.workspaceKey || customData.workspace_key || '').trim(),
		planSlug: String(customData.planSlug || customData.plan_slug || '').trim().toLowerCase(),
		planId: String(customData.planId || customData.plan_id || '').trim(),
		packId: String(customData.packId || customData.pack_id || '').trim(),
	};
}

export function verifyPaddleTransactionPaidStatus(transaction = {}) {
	const status = String(transaction?.status || '').trim().toLowerCase();
	if (!status) return { ok: false, error: 'paddle_transaction_status_missing' };
	if (!PAID_PADDLE_TRANSACTION_STATUSES.includes(status)) {
		return { ok: false, error: 'paddle_transaction_not_paid', status };
	}
	return { ok: true, status };
}

/**
 * Verify authoritative Paddle transaction against trusted server-side expectations.
 * Pure function — PocketBase lookups happen in caller.
 */
export function verifyPaddleTransactionForFulfillment({
	transaction,
	webhookContext = {},
	registryEntries = [],
	environment = '',
	planRecord = null,
	workspaceExists = false,
	subscriptionRecord = null,
} = {}) {
	if (!transaction || typeof transaction !== 'object') {
		return { ok: false, error: 'paddle_transaction_missing' };
	}

	const statusCheck = verifyPaddleTransactionPaidStatus(transaction);
	if (!statusCheck.ok) return statusCheck;

	const transactionId = String(transaction.id || webhookContext.transactionId || '').trim();
	if (!transactionId) return { ok: false, error: 'paddle_transaction_id_missing' };

	const apiCustomData = extractCustomDataFromPaddleTransaction(transaction);
	const workspaceKey = apiCustomData.workspaceKey || String(webhookContext.workspaceKey || '').trim();
	const webhookPlanSlug = String(webhookContext.planSlug || '').trim().toLowerCase();

	if (!workspaceKey) return { ok: false, error: 'paddle_workspace_missing' };
	if (!workspaceExists) return { ok: false, error: 'paddle_workspace_not_found' };

	if (apiCustomData.workspaceKey && webhookContext.workspaceKey
		&& apiCustomData.workspaceKey !== webhookContext.workspaceKey) {
		return { ok: false, error: 'paddle_workspace_metadata_mismatch' };
	}

	const priceId = extractPriceIdFromPaddleTransaction(transaction);
	if (!priceId) return { ok: false, error: 'paddle_price_missing_in_transaction' };

	const registryEntry = resolveRegistryEntryByPriceId(registryEntries, {
		provider: 'paddle',
		environment,
		priceId,
	});
	if (!registryEntry) {
		return { ok: false, error: 'paddle_price_not_in_registry', priceId, environment };
	}

	const planSlug = registryEntry.planSlug;
	if (!planSlug) return { ok: false, error: 'paddle_registry_missing_plan_slug', priceId };

	if (webhookPlanSlug && webhookPlanSlug !== planSlug) {
		return { ok: false, error: 'paddle_plan_metadata_mismatch', expectedPlanSlug: planSlug, webhookPlanSlug };
	}
	if (apiCustomData.planSlug && apiCustomData.planSlug !== planSlug) {
		return { ok: false, error: 'paddle_plan_custom_data_mismatch', expectedPlanSlug: planSlug, customDataPlanSlug: apiCustomData.planSlug };
	}

	if (!planRecord) return { ok: false, error: 'paddle_plan_not_found', planSlug };

	const billingType = String(planRecord.billing_type || resolveBillingTypeFromPlan(planRecord)).trim();
	if (billingType !== 'paid') {
		return { ok: false, error: 'paddle_plan_not_paid', planSlug, billingType };
	}

	const subscriptionId = String(
		transaction.subscription_id
		|| webhookContext.subscriptionId
		|| '',
	).trim();

	const customerId = String(transaction.customer_id || '').trim();
	const storedSubscriptionId = String(subscriptionRecord?.paddle_subscription_id || '').trim();
	const storedCustomerId = String(subscriptionRecord?.paddle_customer_id || '').trim();
	const recordWorkspaceKey = String(subscriptionRecord?.workspace_key || '').trim();
	let subscriptionIdRotated = false;
	let previousSubscriptionId = '';

	if (recordWorkspaceKey && recordWorkspaceKey !== workspaceKey) {
		return { ok: false, error: 'paddle_workspace_subscription_mismatch' };
	}

	if (storedSubscriptionId && subscriptionId && storedSubscriptionId !== subscriptionId) {
		// Same-workspace upgrade/plan-change may create a new Paddle subscription_id.
		// Allow rotation only when the Paddle customer is present and identical.
		if (!storedCustomerId || !customerId) {
			return { ok: false, error: 'paddle_subscription_customer_missing' };
		}
		if (storedCustomerId !== customerId) {
			return { ok: false, error: 'paddle_subscription_customer_mismatch' };
		}
		subscriptionIdRotated = true;
		previousSubscriptionId = storedSubscriptionId;
	}

	return {
		ok: true,
		transactionId,
		subscriptionId,
		customerId,
		priceId,
		planSlug,
		planId: planRecord.id,
		interval: registryEntry.interval,
		environment,
		workspaceKey,
		registryEntry,
		subscriptionIdRotated,
		previousSubscriptionId,
	};
}

/**
 * Verify authoritative Paddle one_time (credit pack) transaction against trusted expectations.
 * Pure function — PocketBase lookups happen in caller.
 */
export function verifyPaddleTransactionForCreditPack({
	transaction,
	webhookContext = {},
	registryEntries = [],
	environment = '',
	workspaceExists = false,
	packCatalogItem = null,
} = {}) {
	if (!transaction || typeof transaction !== 'object') {
		return { ok: false, error: 'paddle_transaction_missing' };
	}

	const statusCheck = verifyPaddleTransactionPaidStatus(transaction);
	if (!statusCheck.ok) return statusCheck;

	const transactionId = String(transaction.id || webhookContext.transactionId || '').trim();
	if (!transactionId) return { ok: false, error: 'paddle_transaction_id_missing' };

	const apiCustomData = extractCustomDataFromPaddleTransaction(transaction);
	const workspaceKey = apiCustomData.workspaceKey || String(webhookContext.workspaceKey || '').trim();
	const webhookPackId = String(webhookContext.packId || '').trim();

	if (!workspaceKey) return { ok: false, error: 'paddle_workspace_missing' };
	if (!workspaceExists) return { ok: false, error: 'paddle_workspace_not_found' };

	if (apiCustomData.workspaceKey && webhookContext.workspaceKey
		&& apiCustomData.workspaceKey !== webhookContext.workspaceKey) {
		return { ok: false, error: 'paddle_workspace_metadata_mismatch' };
	}

	const packId = apiCustomData.packId || webhookPackId;
	if (!packId) return { ok: false, error: 'paddle_pack_missing' };

	if (webhookPackId && apiCustomData.packId && webhookPackId !== apiCustomData.packId) {
		return { ok: false, error: 'paddle_pack_metadata_mismatch' };
	}

	const priceId = extractPriceIdFromPaddleTransaction(transaction);
	if (!priceId) return { ok: false, error: 'paddle_price_missing_in_transaction' };

	const registryEntry = resolveRegistryEntryByPriceId(registryEntries, {
		provider: 'paddle',
		environment,
		priceId,
	});
	if (!registryEntry) {
		return { ok: false, error: 'paddle_price_not_in_registry', priceId, environment };
	}

	if (registryEntry.interval !== 'one_time') {
		return { ok: false, error: 'paddle_registry_not_one_time', priceId };
	}

	if (!registryEntry.packId) {
		return { ok: false, error: 'paddle_registry_missing_pack_id', priceId };
	}

	if (registryEntry.packId !== packId) {
		return {
			ok: false,
			error: 'paddle_pack_registry_mismatch',
			expectedPackId: registryEntry.packId,
			receivedPackId: packId,
		};
	}

	if (!packCatalogItem) {
		return { ok: false, error: 'paddle_pack_not_found', packId };
	}

	if (packCatalogItem.active === false) {
		return { ok: false, error: 'paddle_pack_inactive', packId };
	}

	const credits = Math.max(0, Number(packCatalogItem.credits) || 0);
	if (!credits) {
		return { ok: false, error: 'paddle_pack_invalid_credits', packId };
	}

	return {
		ok: true,
		transactionId,
		customerId: String(transaction.customer_id || '').trim(),
		priceId,
		packId,
		pack: packCatalogItem,
		credits,
		interval: registryEntry.interval,
		environment,
		workspaceKey,
		registryEntry,
	};
}

export function buildPaddleCreditPackIdempotencyKey(transactionId) {
	const id = String(transactionId || '').trim();
	if (!id) return '';
	return `paddle-pack-txn:${id}`.slice(0, 180);
}

export function classifyPaddleCreditPackFulfillment({ verified, existingFulfillment = null }) {
	if (existingFulfillment?.duplicate) {
		return { kind: 'duplicate', reason: 'transaction_already_fulfilled' };
	}
	if (!verified?.transactionId) {
		return { kind: 'blocked', reason: 'missing_transaction_id' };
	}
	return { kind: 'fulfill', reason: 'verified_credit_pack_transaction' };
}

export function classifyPaddleTransactionFulfillment({ subscriptionRecord, verified }) {
	if (!subscriptionRecord) {
		return { kind: 'activation', reason: 'no_existing_subscription' };
	}

	const status = String(subscriptionRecord.status || '').trim();
	const billingSource = String(subscriptionRecord.billing_source || '').trim();
	const existingSubId = String(subscriptionRecord.paddle_subscription_id || '').trim();
	const existingTxnId = String(subscriptionRecord.paddle_transaction_id || '').trim();
	const verifiedSubId = String(verified.subscriptionId || '').trim();
	const verifiedTxnId = String(verified.transactionId || '').trim();

	const hasActivePaid = status === 'active' && billingSource === 'paddle' && existingSubId;

	if (hasActivePaid && verifiedSubId && existingSubId === verifiedSubId) {
		if (existingTxnId && verifiedTxnId && existingTxnId !== verifiedTxnId) {
			return { kind: 'renewal', reason: 'matching_subscription_new_transaction' };
		}
		if (existingTxnId && verifiedTxnId && existingTxnId === verifiedTxnId) {
			return { kind: 'duplicate', reason: 'same_transaction_already_linked' };
		}
	}

	if (hasActivePaid && verifiedSubId && existingSubId === verifiedSubId && !existingTxnId) {
		return { kind: 'activation', reason: 'first_transaction_for_subscription' };
	}

	// Verified same-customer subscription rotation (Starter→Pro new sub id, etc.).
	if (
		hasActivePaid
		&& verifiedSubId
		&& existingSubId
		&& existingSubId !== verifiedSubId
		&& verified?.subscriptionIdRotated
	) {
		return { kind: 'plan_change', reason: 'subscription_id_rotated_same_customer' };
	}

	if (hasActivePaid) {
		return { kind: 'blocked', reason: 'renewal_not_safe_to_identify' };
	}

	return { kind: 'activation', reason: 'inactive_or_new_subscription' };
}

export function verifyPaddleSubscriptionForCancellation(subscription = {}) {
	const status = String(subscription?.status || '').trim().toLowerCase();
	if (!status) return { ok: false, error: 'paddle_subscription_status_missing' };

	const scheduledChange = subscription?.scheduled_change || subscription?.scheduledChange || null;
	const action = String(scheduledChange?.action || '').trim().toLowerCase();
	const effectiveAt = scheduledChange?.effective_at || scheduledChange?.effectiveAt || null;

	return {
		ok: true,
		status,
		cancelAtPeriodEnd: action === 'cancel' && Boolean(effectiveAt),
		immediate: status === 'canceled' || status === 'cancelled',
		effectiveAt,
	};
}
