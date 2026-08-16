/**
 * PR-08 — Paddle-first subscription cancel helpers.
 * Gate on the workspace subscription DTO only. Never use global billing.provider.
 */

export const SUBSCRIPTION_CANCEL_PATH = '/workspace/v1/subscription/cancel';

export const SUBSCRIPTION_CANCEL_BODY = Object.freeze({ atPeriodEnd: true });

export const CHECKOUT_CANCEL_PATH = '/app/subscription?checkout=cancel';

function normalize(value) {
	return String(value || '').trim().toLowerCase();
}

export function resolveSubscriptionProvider(subscription) {
	return normalize(subscription?.provider);
}

export function isCancelScheduled(subscription) {
	if (!subscription || typeof subscription !== 'object') return false;
	if (subscription.cancelAtPeriodEnd === true) return true;
	return normalize(subscription.billingStatus) === 'cancel_scheduled';
}

export function isSubscriptionCanceled(subscription) {
	if (!subscription || typeof subscription !== 'object') return false;
	const status = normalize(subscription.status);
	const billingStatus = normalize(subscription.billingStatus);
	if (status === 'canceled' || status === 'cancelled') return true;
	return ['expired', 'refunded', 'trial_expired', 'canceled', 'cancelled'].includes(billingStatus);
}

export function canShowSubscriptionCancel(subscription) {
	if (resolveSubscriptionProvider(subscription) !== 'paddle') return false;
	if (isSubscriptionCanceled(subscription)) return false;
	if (isCancelScheduled(subscription)) return false;
	return true;
}

export function formatSubscriptionPeriodEnd(currentPeriodEnd) {
	if (!currentPeriodEnd) return '';
	const date = new Date(currentPeriodEnd);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleDateString();
}

export function accessContinuesUntilMessage(currentPeriodEnd) {
	const label = formatSubscriptionPeriodEnd(currentPeriodEnd);
	if (label) return `Access continues until ${label}.`;
	return 'Access continues until the end of the current billing period.';
}

export function mapSubscriptionCancelError(status, payload = {}) {
	const code = String(payload.errorCode || '').trim();
	const message = String(payload.message || '').trim();
	if (status === 403 || code === 'FORBIDDEN') {
		return {
			title: 'Permission denied',
			description: message || 'You do not have permission to cancel this subscription.',
		};
	}
	if (status === 404 || code === 'NOT_FOUND') {
		return {
			title: 'Subscription not found',
			description: message || 'No subscription was found for this workspace.',
		};
	}
	if (status === 409 || code === 'CANCELLATION_IN_PROGRESS') {
		return {
			title: 'Cancellation in progress',
			description: message || 'A cancellation is already in progress. Please wait and try again.',
		};
	}
	if (status === 422) {
		return {
			title: 'Cancellation unavailable',
			description: message || 'This subscription cannot be cancelled right now.',
		};
	}
	if (status === 502) {
		return {
			title: 'Provider cancellation failed',
			description: message || 'The payment provider did not confirm cancellation. Your plan was left unchanged.',
		};
	}
	return {
		title: 'Cancellation failed',
		description: message || 'Could not cancel this subscription. Please try again.',
	};
}

export function describeCancelSuccess(payload = {}, currentPeriodEnd) {
	const access = accessContinuesUntilMessage(currentPeriodEnd);
	if (payload.refundPending) {
		return {
			title: 'Cancellation not applied',
			description: 'A refund is already pending. Your current subscription was left unchanged.',
		};
	}
	if (payload.alreadyCanceled) {
		return {
			title: 'Subscription already cancelled',
			description: payload.message || 'This subscription is already cancelled.',
		};
	}
	if (payload.alreadyScheduled || payload.cancelled) {
		return {
			title: payload.alreadyScheduled ? 'Cancellation already scheduled' : 'Cancellation scheduled',
			description: access,
		};
	}
	return {
		title: 'Cancellation scheduled',
		description: access,
	};
}
