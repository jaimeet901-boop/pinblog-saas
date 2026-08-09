import { fetchAndVerifyPaddleSubscriptionForReconciliation } from './paddle-subscription-reconciliation.js';
import { reconcilePaddleSubscription } from './paddle-subscription-reconcile.js';
import {
	acquireReconciliationClaim,
	completeReconciliationIdempotency,
	failReconciliationIdempotency,
} from './paddle-subscription-reconciliation-idempotency.js';
import { deriveEffectivePaddleEnvironment } from './providers/paddle-environment.js';
import { extractPaddleWebhookContext } from './providers/paddle-webhook-helpers.js';

/**
 * Phase 4.4-C/D — Verified subscription.updated ingress with metadata reconciliation.
 * PocketBase and webhook persistence are injected via deps by the fulfillment wrapper.
 */
export async function handlePaddleSubscriptionUpdatedEvent({
	config,
	parsed,
	webhookRecord,
	fetchImpl,
	deps = {},
} = {}) {
	const context = parsed.context || extractPaddleWebhookContext(parsed.payload);
	const updateEvent = deps.updateWebhookEvent;
	if (typeof updateEvent !== 'function') {
		throw new Error('updateWebhookEvent dependency is required');
	}

	const persistFailure = deps.persistWebhookFailure
		|| ((recordId, error, decision) => updateEvent(recordId, {
			status: 'failed',
			error: error?.message || String(error || decision || 'unknown'),
		}));

	const envResult = deriveEffectivePaddleEnvironment(config);
	if (!envResult.ok) {
		await persistFailure(webhookRecord.id, null, envResult.error);
		return { ok: true, result: { handled: false, verified: false, reason: envResult.error } };
	}

	const paddleSubscriptionId = String(context.subscriptionId || '').trim();
	if (!paddleSubscriptionId) {
		await updateEvent(webhookRecord.id, {
			status: 'failed',
			error: 'paddle_reconciliation_missing_subscription_id',
		});
		return {
			ok: true,
			result: {
				handled: false,
				verified: false,
				reason: 'paddle_reconciliation_missing_subscription_id',
			},
		};
	}

	const loadSubByWorkspace = deps.loadSubscriptionByWorkspace;
	const loadSubByPaddleId = deps.loadSubscriptionByPaddleId;
	const fetchAndVerify = deps.fetchAndVerifyPaddleSubscriptionForReconciliation
		|| fetchAndVerifyPaddleSubscriptionForReconciliation;
	const reconcileFn = deps.reconcilePaddleSubscription || reconcilePaddleSubscription;
	const loadRegistryEntries = deps.loadRegistryEntries;

	let subscriptionRecord = null;
	if (context.workspaceKey && typeof loadSubByWorkspace === 'function') {
		subscriptionRecord = await loadSubByWorkspace(context.workspaceKey);
	} else if (typeof loadSubByPaddleId === 'function') {
		subscriptionRecord = await loadSubByPaddleId(paddleSubscriptionId);
	}

	if (context.workspaceKey && subscriptionRecord?.workspace_key
		&& subscriptionRecord.workspace_key !== context.workspaceKey) {
		await persistFailure(webhookRecord.id, null, 'paddle_reconciliation_workspace_mismatch');
		return {
			ok: true,
			result: {
				handled: false,
				verified: false,
				reason: 'paddle_reconciliation_workspace_mismatch',
			},
		};
	}

	if (!subscriptionRecord?.id) {
		await persistFailure(webhookRecord.id, null, 'paddle_reconciliation_subscription_not_found');
		return {
			ok: true,
			result: {
				handled: false,
				verified: false,
				reason: 'paddle_reconciliation_subscription_not_found',
			},
		};
	}

	const verified = await fetchAndVerify({
		subscriptionId: paddleSubscriptionId,
		subscriptionRecord,
		environment: envResult.environment,
		config,
		fetchImpl,
	});

	if (!verified.ok) {
		await persistFailure(webhookRecord.id, null, verified.error);
		return {
			ok: true,
			result: {
				handled: false,
				verified: false,
				reason: verified.error,
				retryable: Boolean(verified.retryable),
			},
		};
	}

	let registryEntries = [];
	if (typeof loadRegistryEntries === 'function') {
		registryEntries = await loadRegistryEntries({
			environment: envResult.environment,
			provider: 'paddle',
			config,
		});
	}

	const eventId = String(parsed.idempotencyKey || '').trim();
	const workspaceKey = subscriptionRecord.workspace_key || context.workspaceKey || '';
	const claimResult = await acquireReconciliationClaim({
		subscriptionId: paddleSubscriptionId,
		eventId,
		workspaceKey,
		provider: 'paddle',
		actor: deps.actor || 'webhook:paddle',
		deps,
		staleMs: deps.reconciliationProcessingStaleMs,
	});

	if (!claimResult.ok) {
		if (claimResult.inProgress) {
			return {
				ok: true,
				result: {
					handled: false,
					verified: true,
					reconciled: false,
					reason: 'reconciliation_in_progress',
					inProgress: true,
					idempotencyKey: claimResult.idempotencyKey,
				},
			};
		}
		await persistFailure(webhookRecord.id, null, claimResult.error || 'reconciliation_idempotency_failed');
		return {
			ok: true,
			result: {
				handled: false,
				verified: true,
				reconciled: false,
				reason: claimResult.error || 'reconciliation_idempotency_failed',
			},
		};
	}

	if (claimResult.shortCircuit) {
		await updateEvent(webhookRecord.id, {
			status: 'processed',
			subscription_id: verified.subscriptionId,
			workspace_key: workspaceKey,
			error: '',
		});
		return {
			ok: true,
			result: {
				...claimResult.shortCircuit,
				handled: true,
				verified: true,
				reconciled: true,
			},
		};
	}

	const reconciled = await reconcileFn({
		subscriptionRecord,
		verified,
		environment: envResult.environment,
		registryEntries,
		eventId,
		actor: deps.actor || 'webhook:paddle',
		idempotencyKey: claimResult.idempotencyKey,
		deps,
	});

	if (!reconciled.ok) {
		await failReconciliationIdempotency(
			claimResult.record?.id,
			reconciled.error || 'reconciliation_failed',
			deps,
		);
		await persistFailure(webhookRecord.id, null, reconciled.error);
		return {
			ok: true,
			result: {
				handled: false,
				verified: true,
				reconciled: false,
				reason: reconciled.error,
				retryable: true,
			},
		};
	}

	const successResult = {
		handled: true,
		verified: true,
		reconciled: true,
		subscriptionId: verified.subscriptionId,
		workspaceKey: reconciled.workspaceKey,
		refundPending: reconciled.refundPending,
		planChanged: reconciled.planChanged,
		reconciliation: reconciled.reconciliation,
	};

	await completeReconciliationIdempotency(claimResult.record?.id, successResult, deps);

	await updateEvent(webhookRecord.id, {
		status: 'processed',
		subscription_id: verified.subscriptionId,
		workspace_key: workspaceKey,
		error: '',
	});

	return {
		ok: true,
		result: successResult,
	};
}
