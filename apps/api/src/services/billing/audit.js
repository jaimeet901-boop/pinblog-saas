import { writeAuditLog } from '../audit/write.js';
import { writeBillingEvent } from '../credits-engine.js';

/**
 * Dual-write: domain billing_events + platform audit_logs for every billing action.
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
} = {}) {
	const resolvedEvent = eventType || action;
	await writeBillingEvent({
		workspaceKey,
		workspaceName,
		eventType: resolvedEvent,
		fromPlan,
		toPlan,
		actor,
		message: message || action,
		metadata: {
			...metadata,
			idempotencyKey: idempotencyKey || undefined,
			provider: provider || undefined,
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
			...metadata,
		},
	}).catch(() => null);
}
