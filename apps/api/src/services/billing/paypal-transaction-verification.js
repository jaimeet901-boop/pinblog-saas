import { resolveBillingTypeFromPlan } from './billing-model.js';
import { decodePayPalCustomId, PayPalApiError } from './providers/paypal.js';
import { resolvePlanSlugFromPayPalPlanId } from './providers/paypal-webhook-helpers.js';

export { PayPalApiError };

export const PAYPAL_ACTIVE_SUBSCRIPTION_STATUSES = Object.freeze(['ACTIVE']);
export const PAYPAL_COMPLETED_SALE_STATES = Object.freeze(['COMPLETED']);
export const PAYPAL_CANCELLED_SUBSCRIPTION_STATUSES = Object.freeze(['CANCELLED', 'SUSPENDED', 'EXPIRED']);

export function buildPayPalActivationIdempotencyKey(subscriptionId = '') {
	const id = String(subscriptionId || '').trim();
	if (!id) return '';
	return `sub-fulfill:paypal-sub:${id}`.slice(0, 180);
}

export function buildPayPalRenewalIdempotencyKey(saleId = '') {
	const id = String(String(saleId || '').trim());
	if (!id) return '';
	return `paypal-renew:sale:${id}`.slice(0, 180);
}

export function verifyPayPalSubscriptionActiveStatus(subscription = {}) {
	const status = String(subscription?.status || '').trim().toUpperCase();
	if (!status) return { ok: false, error: 'paypal_subscription_status_missing' };
	if (!PAYPAL_ACTIVE_SUBSCRIPTION_STATUSES.includes(status)) {
		return { ok: false, error: 'paypal_subscription_not_active', status };
	}
	return { ok: true, status };
}

export function verifyPayPalSaleCompletedState(sale = {}) {
	const state = String(sale?.state || sale?.status || '').trim().toUpperCase();
	if (!state) return { ok: false, error: 'paypal_sale_state_missing' };
	if (!PAYPAL_COMPLETED_SALE_STATES.includes(state)) {
		return { ok: false, error: 'paypal_sale_not_completed', state };
	}
	return { ok: true, state };
}

/**
 * Verify authoritative PayPal subscription against webhook expectations (activation path).
 */
export function verifyPayPalSubscriptionForActivation({
	subscription,
	webhookContext = {},
	planIds = {},
	planRecord = null,
	workspaceExists = false,
	subscriptionRecord = null,
} = {}) {
	if (!subscription || typeof subscription !== 'object') {
		return { ok: false, error: 'paypal_subscription_missing' };
	}

	const statusCheck = verifyPayPalSubscriptionActiveStatus(subscription);
	if (!statusCheck.ok) return statusCheck;

	const subscriptionId = String(subscription.id || subscription.subscriptionId || webhookContext.subscriptionId || '').trim();
	if (!subscriptionId) return { ok: false, error: 'paypal_subscription_id_missing' };

	const apiCustom = decodePayPalCustomId(subscription.customId || subscription.custom_id || '');
	const workspaceKey = apiCustom.workspaceKey || String(webhookContext.workspaceKey || '').trim();
	const webhookPlanSlug = String(webhookContext.planSlug || '').trim().toLowerCase();
	const apiPlanSlug = String(apiCustom.planSlug || '').trim().toLowerCase();

	if (!workspaceKey) return { ok: false, error: 'paypal_workspace_missing' };
	if (!workspaceExists) return { ok: false, error: 'paypal_workspace_not_found' };

	if (apiCustom.workspaceKey && webhookContext.workspaceKey
		&& apiCustom.workspaceKey !== webhookContext.workspaceKey) {
		return { ok: false, error: 'paypal_workspace_metadata_mismatch' };
	}

	const planId = String(subscription.planId || subscription.plan_id || '').trim();
	if (!planId) return { ok: false, error: 'paypal_plan_id_missing' };

	const mappedPlanSlug = resolvePlanSlugFromPayPalPlanId(planId, planIds);
	if (!mappedPlanSlug) return { ok: false, error: 'paypal_plan_not_mapped', planId };

	if (apiPlanSlug && apiPlanSlug !== mappedPlanSlug) {
		return { ok: false, error: 'paypal_plan_custom_data_mismatch', expectedPlanSlug: mappedPlanSlug, customDataPlanSlug: apiPlanSlug };
	}
	if (webhookPlanSlug && webhookPlanSlug !== mappedPlanSlug) {
		return { ok: false, error: 'paypal_plan_metadata_mismatch', expectedPlanSlug: mappedPlanSlug, webhookPlanSlug };
	}

	if (!planRecord) return { ok: false, error: 'paypal_plan_not_found', planSlug: mappedPlanSlug };

	const billingType = String(planRecord.billing_type || resolveBillingTypeFromPlan(planRecord)).trim();
	if (billingType !== 'paid') {
		return { ok: false, error: 'paypal_plan_not_paid', planSlug: mappedPlanSlug, billingType };
	}

	if (subscriptionRecord?.provider === 'paypal'
		&& subscriptionRecord?.provider_subscription_id
		&& subscriptionRecord.provider_subscription_id !== subscriptionId) {
		return { ok: false, error: 'paypal_subscription_identity_mismatch' };
	}

	return {
		ok: true,
		subscriptionId,
		planId,
		planSlug: mappedPlanSlug,
		planIdRecord: planRecord.id,
		workspaceKey,
		saleId: '',
	};
}

/**
 * Verify authoritative PayPal sale + subscription for renewal path.
 */
export function verifyPayPalSaleForRenewal({
	sale,
	subscription,
	webhookContext = {},
	planIds = {},
	planRecord = null,
	workspaceExists = false,
	subscriptionRecord = null,
} = {}) {
	if (!sale || typeof sale !== 'object') {
		return { ok: false, error: 'paypal_sale_missing' };
	}

	const saleStateCheck = verifyPayPalSaleCompletedState(sale);
	if (!saleStateCheck.ok) return saleStateCheck;

	const saleId = String(sale.id || sale.saleId || webhookContext.saleId || '').trim();
	if (!saleId) return { ok: false, error: 'paypal_sale_id_missing' };

	if (!subscription || typeof subscription !== 'object') {
		return { ok: false, error: 'paypal_subscription_missing' };
	}

	const subscriptionId = String(
		subscription.id
		|| subscription.subscriptionId
		|| sale.billingAgreementId
		|| sale.billing_agreement_id
		|| webhookContext.subscriptionId
		|| '',
	).trim();
	if (!subscriptionId) return { ok: false, error: 'paypal_subscription_id_missing' };

	const webhookSubscriptionId = String(webhookContext.subscriptionId || '').trim();
	if (webhookSubscriptionId && webhookSubscriptionId !== subscriptionId) {
		return { ok: false, error: 'paypal_subscription_identity_mismatch' };
	}

	const saleBillingAgreement = String(sale.billingAgreementId || sale.billing_agreement_id || '').trim();
	if (saleBillingAgreement && saleBillingAgreement !== subscriptionId) {
		return { ok: false, error: 'paypal_sale_subscription_mismatch' };
	}

	const statusCheck = verifyPayPalSubscriptionActiveStatus(subscription);
	if (!statusCheck.ok) return statusCheck;

	const apiCustom = decodePayPalCustomId(subscription.customId || subscription.custom_id || '');
	const workspaceKey = apiCustom.workspaceKey || String(webhookContext.workspaceKey || '').trim();

	if (!workspaceKey) return { ok: false, error: 'paypal_workspace_missing' };
	if (!workspaceExists) return { ok: false, error: 'paypal_workspace_not_found' };

	if (apiCustom.workspaceKey && webhookContext.workspaceKey
		&& apiCustom.workspaceKey !== webhookContext.workspaceKey) {
		return { ok: false, error: 'paypal_workspace_metadata_mismatch' };
	}

	const planId = String(subscription.planId || subscription.plan_id || '').trim();
	if (!planId) return { ok: false, error: 'paypal_plan_id_missing' };

	const mappedPlanSlug = resolvePlanSlugFromPayPalPlanId(planId, planIds);
	if (!mappedPlanSlug) return { ok: false, error: 'paypal_plan_not_mapped', planId };
	if (!planRecord) return { ok: false, error: 'paypal_plan_not_found', planSlug: mappedPlanSlug };

	if (subscriptionRecord?.provider === 'paypal'
		&& subscriptionRecord?.provider_subscription_id
		&& subscriptionRecord.provider_subscription_id !== subscriptionId) {
		return { ok: false, error: 'paypal_subscription_identity_mismatch' };
	}

	return {
		ok: true,
		subscriptionId,
		saleId,
		planId,
		planSlug: mappedPlanSlug,
		planIdRecord: planRecord.id,
		workspaceKey,
	};
}

export function verifyPayPalSubscriptionForCancellation(subscription = {}) {
	const status = String(subscription?.status || '').trim().toUpperCase();
	if (!status) return { ok: false, error: 'paypal_subscription_status_missing' };

	const cancelled = PAYPAL_CANCELLED_SUBSCRIPTION_STATUSES.includes(status);
	if (!cancelled) {
		return { ok: false, error: 'paypal_subscription_not_cancelled', status };
	}

	return {
		ok: true,
		status,
		immediate: status === 'CANCELLED' || status === 'EXPIRED',
		cancelAtPeriodEnd: status === 'SUSPENDED',
	};
}

export function classifyPayPalActivationFulfillment({ subscriptionRecord, verified }) {
	const existingSubId = String(subscriptionRecord?.provider_subscription_id || '').trim();
	const verifiedSubId = String(verified?.subscriptionId || '').trim();
	const billingSource = String(subscriptionRecord?.billing_source || '').trim();
	const provider = String(subscriptionRecord?.provider || '').trim();
	const status = String(subscriptionRecord?.status || '').trim();

	const hasActivePayPal = status === 'active'
		&& provider === 'paypal'
		&& existingSubId
		&& (billingSource === 'system' || billingSource === 'paypal' || !billingSource);

	if (hasActivePayPal && existingSubId === verifiedSubId) {
		return { kind: 'duplicate', reason: 'paypal_subscription_already_active' };
	}

	if (hasActivePayPal && existingSubId && existingSubId !== verifiedSubId) {
		return { kind: 'blocked', reason: 'paypal_subscription_identity_conflict' };
	}

	return { kind: 'activation', reason: 'verified_paypal_subscription_activation' };
}

export function classifyPayPalRenewalFulfillment({ subscriptionRecord, verified, existingRenewal = null }) {
	if (existingRenewal?.duplicate) {
		return { kind: 'duplicate', reason: 'paypal_sale_already_processed' };
	}

	const existingSubId = String(subscriptionRecord?.provider_subscription_id || '').trim();
	const verifiedSubId = String(verified?.subscriptionId || '').trim();

	if (!subscriptionRecord) {
		return { kind: 'blocked', reason: 'paypal_renewal_without_local_subscription' };
	}

	if (subscriptionRecord.provider !== 'paypal' || !existingSubId) {
		return { kind: 'blocked', reason: 'paypal_renewal_subscription_not_linked' };
	}

	if (existingSubId !== verifiedSubId) {
		return { kind: 'blocked', reason: 'paypal_subscription_identity_mismatch' };
	}

	return { kind: 'renewal', reason: 'verified_paypal_sale_renewal' };
}
