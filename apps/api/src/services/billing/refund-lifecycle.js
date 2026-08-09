import { buildPaddleCreditPackIdempotencyKey } from './paddle-transaction-verification.js';

async function resolvePocketbaseClient(override) {
	if (override) return override;
	const { default: pocketbaseClient } = await import('../../utils/pocketbaseClient.js');
	return pocketbaseClient;
}

async function resolveIdempotency(deps = {}) {
	if (deps.claimIdempotencyKey && deps.completeIdempotency && deps.failIdempotency) {
		return {
			claim: deps.claimIdempotencyKey,
			complete: deps.completeIdempotency,
			fail: deps.failIdempotency,
		};
	}
	const mod = await import('./idempotency.js');
	return {
		claim: deps.claimIdempotencyKey || mod.claimIdempotencyKey,
		complete: deps.completeIdempotency || mod.completeIdempotency,
		fail: deps.failIdempotency || mod.failIdempotency,
	};
}

async function resolveSyncEntitlementMirrors(deps = {}) {
	if (deps.syncEntitlementMirrors) return deps.syncEntitlementMirrors;
	const { syncEntitlementMirrors } = await import('./entitlement-sync.js');
	return syncEntitlementMirrors;
}

async function resolveLogBillingAction(deps = {}) {
	if (deps.logBillingAction) return deps.logBillingAction;
	const { logBillingAction } = await import('./audit.js');
	return logBillingAction;
}

export function computeCreditPackClawbackAmounts({ purchasedCredits = 0, balance = 0, clawbackAmount = 0 } = {}) {
	const purchased = Math.max(0, Number(purchasedCredits) || 0);
	const currentBalance = Math.max(0, Number(balance) || 0);
	const clawback = Math.max(0, Number(clawbackAmount) || 0);
	const fromPurchased = Math.min(purchased, clawback);
	const nextPurchased = Math.max(0, purchased - fromPurchased);
	const nextBalance = Math.max(0, currentBalance - clawback);
	return {
		fromPurchased,
		nextPurchased,
		nextBalance,
		clawback,
	};
}

export function shouldImmediatelyDowngradeSubscription(currentPeriodEnd) {
	if (!currentPeriodEnd) return false;
	const periodEndMs = new Date(currentPeriodEnd).getTime();
	return periodEndMs > 0 && periodEndMs <= Date.now();
}

async function loadPlan(slug, client) {
	return client.collection('plans').getFirstListItem(
		client.filter('slug = {:slug}', { slug }),
		{ requestKey: null },
	).catch(() => null);
}

async function loadSubscription(workspaceKey, client) {
	return client.collection('workspace_subscriptions').getFirstListItem(
		client.filter('workspace_key = {:key}', { key: workspaceKey }),
		{ expand: 'plan', requestKey: null },
	).catch(() => null);
}

/**
 * Phase 4.2 — Option B: preserve paid entitlement until current_period_end, then downgrade.
 */
export async function handleSubscriptionRefundPending({
	workspaceKey,
	provider = '',
	providerSubscriptionId = '',
	transactionId = '',
	saleId = '',
	eventId = '',
	idempotencyKey = '',
	actor = 'webhook',
	reason = 'subscription_refund',
	deps = {},
} = {}) {
	if (!workspaceKey) {
		return { handled: false, error: 'subscription_refund_workspace_missing' };
	}

	const key = String(idempotencyKey || '').slice(0, 180);
	if (!key) {
		return { handled: false, error: 'subscription_refund_idempotency_missing' };
	}

	const pb = await resolvePocketbaseClient(deps.client);
	const idempotency = await resolveIdempotency(deps);
	const syncFn = await resolveSyncEntitlementMirrors(deps);
	const auditFn = await resolveLogBillingAction(deps);

	const idem = await idempotency.claim({
		idempotencyKey: key,
		scope: 'subscription_refund',
		workspaceKey,
		provider,
		eventType: 'subscription_refund',
		payload: {
			providerSubscriptionId,
			transactionId,
			saleId,
			eventId,
			reason,
		},
	});
	if (idem.duplicate) {
		return { handled: true, duplicate: true, result: idem.result };
	}

	try {
		const subscription = await loadSubscription(workspaceKey, pb);
		if (!subscription) {
			await idempotency.fail(idem.record.id, 'subscription_not_found');
			return { handled: false, error: 'subscription_not_found' };
		}

		if (provider === 'paddle' && providerSubscriptionId && subscription.paddle_subscription_id
			&& subscription.paddle_subscription_id !== providerSubscriptionId) {
			await idempotency.fail(idem.record.id, 'paddle_subscription_identity_mismatch');
			return { handled: false, error: 'paddle_subscription_identity_mismatch' };
		}

		if (providerSubscriptionId && subscription.provider === provider
			&& subscription.provider_subscription_id
			&& subscription.provider_subscription_id !== providerSubscriptionId) {
			await idempotency.fail(idem.record.id, 'subscription_identity_mismatch');
			return { handled: false, error: 'subscription_identity_mismatch' };
		}

		const periodEnded = shouldImmediatelyDowngradeSubscription(subscription.current_period_end);

		if (periodEnded) {
			const free = await loadPlan('free', pb);
			await pb.collection('workspace_subscriptions').update(subscription.id, {
				status: 'canceled',
				billing_status: 'refunded',
				cancel_at_period_end: false,
				plan: free?.id || subscription.plan,
				last_webhook_event_id: String(eventId || '').slice(0, 180),
				last_verified_at: new Date().toISOString(),
			});
			if (free) {
				await syncFn({
					workspaceKey,
					plan: free,
					subscriptionId: subscription.id,
					actor,
					source: provider === 'paypal' ? 'system' : 'paddle_webhook',
				});
			}
		} else {
			await pb.collection('workspace_subscriptions').update(subscription.id, {
				cancel_at_period_end: true,
				billing_status: 'refund_pending',
				last_webhook_event_id: String(eventId || '').slice(0, 180),
				last_verified_at: new Date().toISOString(),
			});
		}

		const result = {
			handled: true,
			refundPending: !periodEnded,
			downgraded: periodEnded,
			atPeriodEnd: !periodEnded,
			workspaceKey,
			provider,
			providerSubscriptionId: providerSubscriptionId || subscription.provider_subscription_id || '',
			transactionId,
			saleId,
		};

		await auditFn({
			action: periodEnded
				? 'Subscription refunded — downgraded after period end'
				: 'Subscription refund pending — paid until period end',
			eventType: periodEnded ? 'cancelled' : 'cancelled',
			workspaceKey,
			workspaceName: subscription.workspace_name,
			actor,
			provider,
			idempotencyKey: key,
			severity: periodEnded ? 'warn' : 'info',
			message: reason,
			metadata: {
				refundPolicy: 'period_end_downgrade',
				periodEnded,
				providerSubscriptionId,
				transactionId,
				saleId,
				eventId,
			},
		});

		await idempotency.complete(idem.record.id, result);
		return result;
	} catch (error) {
		await idempotency.fail(idem.record.id, error?.message || String(error));
		throw error;
	}
}

/**
 * Phase 4.2 — Option A: immediate strict credit-pack clawback after verified refund.
 */
export async function clawbackCreditPackPurchase({
	workspaceKey,
	transactionId = '',
	idempotencyKey = '',
	provider = 'paddle',
	actor = 'webhook',
	reason = 'credit_pack_refund',
	eventId = '',
	deps = {},
} = {}) {
	if (!workspaceKey) {
		return { handled: false, error: 'credit_pack_refund_workspace_missing' };
	}

	const purchaseKey = buildPaddleCreditPackIdempotencyKey(transactionId);
	if (!purchaseKey) {
		return { handled: false, error: 'credit_pack_refund_transaction_missing' };
	}

	const key = String(idempotencyKey || '').slice(0, 180);
	if (!key) {
		return { handled: false, error: 'credit_pack_refund_idempotency_missing' };
	}

	const pb = await resolvePocketbaseClient(deps.client);
	const idempotency = await resolveIdempotency(deps);
	const auditFn = await resolveLogBillingAction(deps);

	const idem = await idempotency.claim({
		idempotencyKey: key,
		scope: 'credit_pack_refund',
		workspaceKey,
		provider,
		eventType: 'credit_pack_refund',
		payload: { transactionId, purchaseKey, eventId, reason },
	});
	if (idem.duplicate) {
		return { handled: true, duplicate: true, fulfilled: false, result: idem.result };
	}

	try {
		const originalTx = await pb.collection('credit_transactions').getFirstListItem(
			pb.filter(
				'workspace_key = {:key} && (idempotency_key = {:purchaseTx} || reference_id = {:txn})',
				{
					key: workspaceKey,
					purchaseTx: `${purchaseKey}:tx`,
					txn: String(transactionId || '').slice(0, 180),
				},
			),
			{ requestKey: null },
		).catch(() => null);

		if (!originalTx) {
			await idempotency.fail(idem.record.id, 'original_pack_purchase_not_found');
			return { handled: false, error: 'original_pack_purchase_not_found' };
		}

		const clawbackAmount = Math.abs(Number(originalTx.amount) || 0);
		if (!clawbackAmount) {
			await idempotency.fail(idem.record.id, 'original_pack_amount_invalid');
			return { handled: false, error: 'original_pack_amount_invalid' };
		}

		const subscription = await loadSubscription(workspaceKey, pb);
		if (!subscription) {
			await idempotency.fail(idem.record.id, 'subscription_not_found');
			return { handled: false, error: 'subscription_not_found' };
		}

		const clawback = computeCreditPackClawbackAmounts({
			purchasedCredits: subscription.purchased_credits,
			balance: subscription.credits_balance,
			clawbackAmount,
		});

		await pb.collection('workspace_subscriptions').update(subscription.id, {
			purchased_credits: clawback.nextPurchased,
			credits_balance: clawback.nextBalance,
			last_webhook_event_id: String(eventId || '').slice(0, 180),
			last_verified_at: new Date().toISOString(),
		});

		await pb.collection('credit_transactions').create({
			workspace_key: workspaceKey,
			workspace_name: subscription.workspace_name || workspaceKey,
			amount: -clawback.clawback,
			type: 'refund',
			feature: 'payg',
			reason: reason || `Credit pack refund clawback (${transactionId})`,
			balance: clawback.nextBalance,
			created_by: actor,
			idempotency_key: `${key}:tx`,
			reference_id: String(transactionId || '').slice(0, 180),
			metadata: {
				clawbackAmount: clawback.clawback,
				fromPurchased: clawback.fromPurchased,
				originalTransactionId: originalTx.id,
				originalIdempotencyKey: originalTx.idempotency_key || purchaseKey,
				provider,
				eventId,
			},
		}).catch(() => null);

		const result = {
			handled: true,
			clawedBack: clawback.clawback,
			purchasedCredits: clawback.nextPurchased,
			balance: clawback.nextBalance,
			transactionId,
			workspaceKey,
		};

		await auditFn({
			action: 'Credit pack refund clawback',
			eventType: 'credits_purchased',
			workspaceKey,
			workspaceName: subscription.workspace_name,
			actor,
			provider,
			idempotencyKey: key,
			severity: 'warn',
			credits: -clawback.clawback,
			metadata: {
				refundPolicy: 'immediate_clawback',
				transactionId,
				fromPurchased: clawback.fromPurchased,
				eventId,
			},
		});

		await idempotency.complete(idem.record.id, result);
		return result;
	} catch (error) {
		await idempotency.fail(idem.record.id, error?.message || String(error));
		throw error;
	}
}

export function assertRefundIdempotencyKey(key) {
	if (!String(key || '').trim()) {
		const error = new Error('Refund idempotency key is required');
		error.status = 422;
		error.errorCode = 'VALIDATION_ERROR';
		throw error;
	}
}
