import { writeAuditLog } from '../audit/write.js';
import { writeBillingEvent } from '../credits-engine.js';
import { buildRevenueSnapshotMetadata } from './revenue-recognition.js';

/**
 * Dual-write: domain billing_events + platform audit_logs for every billing action.
 * Additive revenue snapshots are merged into metadata when amount/plan/provider are provided.
 */
export async function logBillingAction({
	action,
	workspaceKey = '',
	workspaceName = '',
	actor = 'system',
	actorUserId = '',
	eventType = '',
	fromPlan = '',
	toPlan = '',
	message = '',
	severity = 'info',
	result = 'ok',
	credits = null,
	provider = '',
	idempotencyKey = '',
	metadata = {},
	// Optional BP-3 snapshot inputs (additive only)
	amount = null,
	currency = 'USD',
	interval = null,
	plan = null,
	pack = null,
} = {}) {
	const resolvedEvent = eventType || action;
	const inferredAmount = amount
		?? metadata.amountSnapshot
		?? metadata.providerAmount
		?? metadata.amount
		?? metadata.pack?.price
		?? metadata.result?.pack?.price
		?? null;
	const inferredPack = pack || metadata.pack || metadata.result?.pack || null;
	const snapshotMeta = buildRevenueSnapshotMetadata({
		amount: inferredAmount,
		currency: currency || metadata.currency || inferredPack?.currency || 'USD',
		interval: interval || metadata.interval || (inferredPack ? 'one_time' : 'monthly'),
		plan: plan || (toPlan ? { slug: toPlan, name: toPlan } : null),
		pack: inferredPack,
		provider: provider || metadata.provider || '',
		existingMetadata: metadata,
	});

	await writeBillingEvent({
		workspaceKey,
		workspaceName,
		eventType: resolvedEvent,
		fromPlan,
		toPlan,
		actor,
		message: message || action,
		metadata: {
			...snapshotMeta,
			idempotencyKey: idempotencyKey || undefined,
			provider: provider || snapshotMeta.providerSnapshot || undefined,
		},
	}).catch(() => null);

	await writeAuditLog({
		category: 'billing',
		uiCategory: 'Subscriptions',
		severity,
		action,
		message: message || action,
		actorUserId: actorUserId || undefined,
		actorLabel: actor,
		workspaceKey: workspaceKey || undefined,
		resourceType: 'billing',
		resourceId: workspaceKey || idempotencyKey || '',
		result,
		credits: credits != null ? Number(credits) : undefined,
		provider: provider || undefined,
		correlationId: idempotencyKey || undefined,
		metadata: {
			eventType: resolvedEvent,
			fromPlan,
			toPlan,
			...snapshotMeta,
		},
	}).catch(() => null);
}
