/**
 * Best-effort cancel of the previous Paddle subscription after a verified rotation.
 * Never throws — local activation must remain successful if remote cancel fails.
 */

/**
 * @param {object} options
 * @param {string} [options.previousSubscriptionId]
 * @param {string} [options.newSubscriptionId]
 * @param {string} [options.workspaceKey]
 * @param {string} [options.actor]
 * @param {(id: string) => Promise<unknown>} [options.cancelPreviousSubscription]
 * @param {Function} [options.logBillingAction]
 */
export async function cancelPreviousPaddleSubscriptionAfterRotation({
	previousSubscriptionId = '',
	newSubscriptionId = '',
	workspaceKey = '',
	actor = 'webhook:paddle',
	cancelPreviousSubscription = null,
	logBillingAction = null,
} = {}) {
	const previousId = String(previousSubscriptionId || '').trim();
	const newId = String(newSubscriptionId || '').trim();
	if (!previousId || !newId || previousId === newId) {
		return { attempted: false, ok: true, skipped: true };
	}
	if (typeof cancelPreviousSubscription !== 'function') {
		return {
			attempted: false,
			ok: false,
			skipped: true,
			retryable: true,
			error: 'paddle_previous_subscription_cancel_unavailable',
		};
	}

	const log = typeof logBillingAction === 'function'
		? logBillingAction
		: async (payload) => {
			const { logBillingAction: write } = await import('./audit.js');
			return write(payload);
		};

	try {
		await cancelPreviousSubscription(previousId);
		await log({
			action: 'Previous Paddle subscription cancelled after plan change',
			eventType: 'subscription_replaced',
			workspaceKey,
			actor,
			provider: 'paddle',
			metadata: {
				previous_subscription_id: previousId,
				new_subscription_id: newId,
				effective_from: 'immediately',
				decision: 'cancelled',
			},
		}).catch(() => null);
		return {
			attempted: true,
			ok: true,
			previousSubscriptionId: previousId,
			newSubscriptionId: newId,
		};
	} catch (error) {
		const message = error?.message || String(error || 'paddle_previous_subscription_cancel_failed');
		await log({
			action: 'Previous Paddle subscription cancel failed after plan change',
			eventType: 'payment_failed',
			workspaceKey,
			actor,
			provider: 'paddle',
			severity: 'error',
			metadata: {
				previous_subscription_id: previousId,
				new_subscription_id: newId,
				effective_from: 'immediately',
				decision: 'cancel_failed',
				retryable: true,
				error: message,
				code: error?.code || '',
			},
		}).catch(() => null);
		return {
			attempted: true,
			ok: false,
			retryable: true,
			previousSubscriptionId: previousId,
			newSubscriptionId: newId,
			error: message,
		};
	}
}
