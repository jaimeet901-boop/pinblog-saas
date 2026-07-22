import { ensureUserWorkspace, mapWorkspaceDto } from '../services/workspace-context.js';
import { httpError } from './require-admin.js';

/**
 * Resolve personal workspace for the authenticated user.
 * Enforces membership and attaches isolation context to the request.
 */
export async function resolveWorkspace(req, res, next) {
	try {
		const userId = req.pocketbaseUserId;
		if (!userId) {
			return next(httpError(401, 'Please sign in to continue.', 'UNAUTHENTICATED'));
		}

		const ctx = await ensureUserWorkspace(userId);
		if (ctx.workspace.status === 'suspended' || ctx.workspace.status === 'closed') {
			return next(httpError(403, 'Workspace is suspended', 'WORKSPACE_SUSPENDED'));
		}

		req.workspace = ctx.workspace;
		req.workspaceKey = ctx.workspaceKey;
		req.workspaceRole = ctx.role;
		req.workspaceUser = ctx.user;
		req.workspaceMembership = ctx.membership;
		req.workspaceSubscription = ctx.subscription;
		req.workspaceSettings = ctx.settings;
		req.workspaceDto = mapWorkspaceDto(ctx.workspace, {
			role: ctx.role,
			planSlug: ctx.workspace.plan_slug || ctx.user.plan,
		});

		return next();
	} catch (error) {
		if (error?.status) return next(error);
		return next(httpError(500, error?.message || 'Failed to resolve workspace', 'WORKSPACE_RESOLVE_FAILED'));
	}
}
