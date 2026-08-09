import { syncEntitlementMirrors } from './entitlement-sync.js';
import {
	buildAdminAssignMetadataFields,
	resolveAdminOverrideActor,
	validateAdminOverrideReason,
} from './admin-plan-assign.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function slugify(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
}

async function resolvePocketbaseClient(override) {
	if (override) return override;
	const { default: pocketbaseClient } = await import('../../utils/pocketbaseClient.js');
	return pocketbaseClient;
}

async function resolveLogBillingAction(override) {
	if (override) return override;
	const { logBillingAction } = await import('./audit.js');
	return logBillingAction;
}

export async function assignWorkspacePlan(payload = {}, adminContext = {}, deps = {}) {
	const workspaceKey = slugify(payload.workspaceKey || payload.workspace_key || payload.workspaceName || payload.workspace_name);
	const workspaceName = String(payload.workspaceName || payload.workspace_name || workspaceKey).trim();
	if (!workspaceKey || !workspaceName) {
		throw httpError(422, 'workspaceKey and workspaceName are required', 'VALIDATION_ERROR');
	}

	const overrideReason = validateAdminOverrideReason(payload);
	const overrideActor = resolveAdminOverrideActor(adminContext, payload);
	const pb = await resolvePocketbaseClient(deps.client);
	const auditFn = await resolveLogBillingAction(deps.logBillingAction);
	const syncFn = deps.syncEntitlementMirrors || syncEntitlementMirrors;

	const plan = await pb.collection('plans').getOne(payload.planId || payload.plan);
	const now = new Date();
	const end = new Date(now);
	end.setMonth(end.getMonth() + 1);

	let existing = null;
	try {
		existing = await pb.collection('workspace_subscriptions').getFirstListItem(
			pb.filter('workspace_key = {:key}', { key: workspaceKey }),
			{ expand: 'plan' },
		);
	} catch {
		existing = null;
	}

	const fromPlan = existing?.expand?.plan?.slug || existing?.plan || '';
	const body = {
		workspace_key: workspaceKey,
		workspace_name: workspaceName,
		owner_email: payload.ownerEmail || existing?.owner_email || '',
		plan: plan.id,
		status: payload.status || 'active',
		billing_status: payload.billingStatus || payload.status || 'active',
		seats: Number(payload.seats) || existing?.seats || 1,
		current_period_start: now.toISOString(),
		current_period_end: end.toISOString(),
		credits_balance: Number(payload.creditsBalance ?? existing?.credits_balance ?? plan.credits) || 0,
		...buildAdminAssignMetadataFields(overrideActor, overrideReason),
	};

	const record = existing
		? await pb.collection('workspace_subscriptions').update(existing.id, body)
		: await pb.collection('workspace_subscriptions').create(body);

	await syncFn({
		workspaceKey,
		plan,
		subscriptionId: record.id,
		subscriptionRecord: record,
		actor: adminContext.actor || overrideActor,
		source: 'admin_override',
		client: deps.client || null,
	});

	const eventType = !existing
		? 'plan_assign'
		: ((Number(plan.monthly_price) || 0) > (Number(existing.expand?.plan?.monthly_price) || 0) ? 'upgrade' : 'downgrade');

	await auditFn({
		action: 'Admin plan assigned',
		eventType: existing ? eventType : 'plan_assign',
		workspaceKey,
		workspaceName,
		actor: adminContext.actor || overrideActor,
		actorUserId: adminContext.actorUserId || overrideActor,
		fromPlan: String(fromPlan || ''),
		toPlan: plan.slug || plan.name,
		message: overrideReason,
		metadata: {
			source: 'admin_override',
			reason: overrideReason,
			overrideActor,
			previousPlan: String(fromPlan || ''),
			newPlan: plan.slug || plan.name,
			workspaceKey,
			paddleIdentityPreserved: Boolean(
				existing?.paddle_subscription_id
				|| existing?.paddle_customer_id
				|| existing?.paddle_transaction_id
				|| existing?.paddle_price_id,
			),
		},
	});

	return {
		id: record.id,
		workspaceKey: record.workspace_key,
		workspaceName: record.workspace_name,
		planId: plan.id,
		planName: plan.name,
		planSlug: plan.slug,
		status: record.status,
		creditsBalance: record.credits_balance,
		activationSource: record.activation_source || body.activation_source,
		billingSource: record.billing_source || body.billing_source,
		overrideActor: record.override_actor || body.override_actor,
		overrideReason: record.override_reason || body.override_reason,
	};
}
