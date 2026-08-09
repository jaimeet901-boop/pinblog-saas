function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

export const ADMIN_WORKSPACE_PLAN_ASSIGN_DIRECTIVE = 'POST /admin/v1/plans/assign';

/**
 * Phase 4.5 — Reject direct workspace plan mirror edits (Option A).
 * Plan changes must use assignWorkspacePlan() via POST /admin/v1/plans/assign.
 */
export function rejectDirectWorkspacePlanPatch(payload = {}) {
	if (payload.plan != null || payload.plan_slug != null) {
		throw httpError(
			422,
			`Workspace plan changes must use ${ADMIN_WORKSPACE_PLAN_ASSIGN_DIRECTIVE}`,
			'WORKSPACE_PLAN_PATCH_FORBIDDEN',
		);
	}
}

/** Build allowed workspace admin PATCH fields after Phase 4.5 plan guard. */
export function buildAdminWorkspaceAllowedPatch(payload = {}) {
	rejectDirectWorkspacePlanPatch(payload);
	const updates = {};
	if (payload.name != null) updates.name = String(payload.name).trim();
	if (payload.status != null) updates.status = String(payload.status).trim().toLowerCase();
	return updates;
}
