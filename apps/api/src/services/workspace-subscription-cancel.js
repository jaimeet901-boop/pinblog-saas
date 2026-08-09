function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function parseAtPeriodEnd(payload = {}) {
	if (payload.atPeriodEnd === undefined) return true;
	if (typeof payload.atPeriodEnd !== 'boolean') {
		throw httpError(422, 'atPeriodEnd must be a boolean', 'VALIDATION_ERROR');
	}
	return payload.atPeriodEnd;
}

/**
 * Workspace subscription cancellation — delegates to fail-closed billing service.
 * Phase 4.3-F HTTP handler; idempotency owned by subscription-cancel.js (Phase 4.3-D).
 */
export async function cancelWorkspaceSubscription(req, payload = {}, options = {}) {
	const assertFn = options.assertCapability
		|| (await import('./workspace-rbac.js')).assertCapability;
	assertFn(req, 'workspace.billing.manage');

	const atPeriodEnd = parseAtPeriodEnd(payload);
	const workspaceKey = String(req.workspaceKey || '').trim();
	if (!workspaceKey) {
		throw httpError(422, 'Workspace is required', 'VALIDATION_ERROR');
	}

	const subscription = req.workspaceSubscription;
	if (!subscription?.id) {
		throw httpError(404, 'Subscription not found', 'NOT_FOUND');
	}
	if (subscription.workspace_key && subscription.workspace_key !== workspaceKey) {
		throw httpError(403, 'Subscription does not belong to this workspace', 'FORBIDDEN');
	}

	const cancelFn = options.cancelSubscription
		|| (await import('./billing/subscription-cancel.js')).cancelSubscription;
	const actor = req.workspaceUser?.email || req.pocketbaseUserId || 'user';

	const result = await cancelFn(workspaceKey, {
		actor,
		atPeriodEnd,
		deps: options.deps,
	});

	return {
		success: true,
		cancelled: Boolean(result?.cancelled),
		atPeriodEnd: result?.atPeriodEnd ?? atPeriodEnd,
		...(result?.remoteConfirmed ? { remoteConfirmed: true } : {}),
		...(result?.localOnly ? { localOnly: true } : {}),
		...(result?.alreadyScheduled ? { alreadyScheduled: true } : {}),
		...(result?.alreadyCanceled ? { alreadyCanceled: true } : {}),
		...(result?.refundPending ? { refundPending: true, preserved: true } : {}),
		...(result?.idempotent ? { idempotent: true } : {}),
		...(result?.duplicate ? { duplicate: true } : {}),
	};
}

export { parseAtPeriodEnd };
