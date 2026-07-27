import { ensureUserWorkspace, mapWorkspaceDto, loadWorkspaceContextById } from '../services/workspace-context.js';
import { httpError } from './require-admin.js';
import pocketbaseClient from '../utils/pocketbaseClient.js';

function isMembersAcceptPath(req) {
	const path = String(req.path || req.url || req.originalUrl || '');
	return req.method === 'POST' && /\/members\/accept(?:\?|$)/.test(path);
}

/**
 * Resolve workspace for the authenticated user.
 * Supports X-Workspace-Id / ?workspaceId for team workspace selection.
 * Defaults to the user's owned personal workspace.
 */
export async function resolveWorkspace(req, res, next) {
	try {
		const userId = req.pocketbaseUserId;
		if (!userId) {
			return next(httpError(401, 'Please sign in to continue.', 'UNAUTHENTICATED'));
		}

		const requestedWorkspaceId = String(
			req.headers['x-workspace-id']
			|| req.query?.workspaceId
			|| req.query?.workspace_id
			|| '',
		).trim();

		let ctx = requestedWorkspaceId
			? await loadWorkspaceContextById(requestedWorkspaceId, userId).catch(async (error) => {
				// Invited / inactive selection must not lock the user out of their personal workspace.
				if (error?.errorCode === 'MEMBER_SUSPENDED' || error?.errorCode === 'FORBIDDEN' || error?.status === 403) {
					return ensureUserWorkspace(userId);
				}
				throw error;
			})
			: await ensureUserWorkspace(userId);

		if (ctx.workspace.status === 'suspended' || ctx.workspace.status === 'closed') {
			if (requestedWorkspaceId) {
				ctx = await ensureUserWorkspace(userId);
			} else {
				return next(httpError(403, 'Workspace is suspended', 'WORKSPACE_SUSPENDED'));
			}
		}
		if (ctx.membership?.status === 'suspended') {
			if (requestedWorkspaceId) {
				ctx = await ensureUserWorkspace(userId);
			} else {
				return next(httpError(403, 'Your membership is suspended', 'MEMBER_SUSPENDED'));
			}
		}
		if (ctx.membership && ctx.membership.status !== 'active') {
			if (isMembersAcceptPath(req) && ctx.membership.status === 'invited') {
				// Allow invite acceptance only.
			} else if (requestedWorkspaceId) {
				ctx = await ensureUserWorkspace(userId);
			} else {
				return next(httpError(403, 'Membership is not active', 'MEMBERSHIP_INACTIVE'));
			}
		}

		req.workspace = ctx.workspace;
		req.workspaceKey = ctx.workspaceKey;
		req.workspaceRole = ctx.role;
		req.workspaceUser = ctx.user;
		req.workspaceMembership = ctx.membership;
		req.workspaceSubscription = ctx.subscription;
		req.workspaceSettings = ctx.settings;
		req.workspaceOwnerId = ctx.workspace.owner || userId;
		req.workspaceDto = mapWorkspaceDto(ctx.workspace, {
			role: ctx.role,
			planSlug: ctx.workspace.plan_slug || ctx.user.plan,
			capabilities: ctx.capabilities || [],
		});

		if (ctx.membership?.id && ctx.membership.status === 'active') {
			pocketbaseClient.collection('workspace_members').update(ctx.membership.id, {
				last_active_at: new Date().toISOString(),
			}).catch(() => null);
		}

		return next();
	} catch (error) {
		if (error?.status) return next(error);
		return next(httpError(500, error?.message || 'Failed to resolve workspace', 'WORKSPACE_RESOLVE_FAILED'));
	}
}
