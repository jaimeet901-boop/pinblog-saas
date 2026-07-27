/**
 * Workspace-scoped resource ownership.
 * Canonical fields: workspace, created_by, last_edited_by
 * Legacy `owner` is stamped as the workspace owner for backward-compatible filters.
 */
import pocketbaseClient from '../utils/pocketbaseClient.js';

export function getWorkspaceActor(req) {
	const workspaceId = req.workspace?.id || '';
	const workspaceKey = req.workspaceKey || req.workspace?.workspace_key || '';
	const creatorId = req.pocketbaseUserId || '';
	const workspaceOwnerId = req.workspaceOwnerId
		|| (typeof req.workspace?.owner === 'string' ? req.workspace.owner : req.workspace?.owner)
		|| creatorId;
	return {
		workspaceId,
		workspaceKey,
		creatorId,
		workspaceOwnerId,
		editorId: creatorId,
	};
}

/**
 * Stamp create payload with workspace ownership fields.
 */
export function stampCreateOwnership(req, data = {}) {
	const actor = getWorkspaceActor(req);
	return {
		...data,
		workspace: data.workspace || actor.workspaceId || undefined,
		created_by: data.created_by || actor.creatorId || undefined,
		last_edited_by: data.last_edited_by || actor.editorId || undefined,
		// Always stamp legacy owner as workspace owner (ignore caller-supplied owner).
		owner: actor.workspaceOwnerId || actor.creatorId || undefined,
	};
}

/**
 * Stamp update payload with last editor.
 */
export function stampUpdateOwnership(req, data = {}) {
	const actor = getWorkspaceActor(req);
	return {
		...data,
		last_edited_by: actor.editorId || undefined,
		workspace: data.workspace || actor.workspaceId || undefined,
	};
}

/**
 * PocketBase filter scoped to the active workspace.
 * Legacy fallback only for unmigrated rows (empty workspace) owned by the workspace owner.
 * Never match bare `owner =` — that leaks cross-workspace data.
 */
export function workspaceScopeFilter(req, { ownerField = 'owner' } = {}) {
	const actor = getWorkspaceActor(req);
	if (actor.workspaceId && actor.workspaceOwnerId) {
		return pocketbaseClient.filter(
			`(workspace = {:ws} || (workspace = "" && ${ownerField} = {:owner}))`,
			{ ws: actor.workspaceId, owner: actor.workspaceOwnerId },
		);
	}
	if (actor.workspaceId) {
		return pocketbaseClient.filter('workspace = {:ws}', { ws: actor.workspaceId });
	}
	return pocketbaseClient.filter(`${ownerField} = {:owner}`, { owner: actor.workspaceOwnerId || actor.creatorId });
}

/**
 * List helper scoped to the active workspace.
 */
export async function listWorkspaceResources(collection, req, {
	page = 1,
	perPage = 50,
	sort = '-created',
	extraFilter = '',
	fields,
} = {}) {
	const scope = workspaceScopeFilter(req);
	const filter = extraFilter ? `(${scope}) && (${extraFilter})` : scope;
	return pocketbaseClient.collection(collection).getList(page, perPage, {
		filter,
		sort,
		fields,
		requestKey: null,
	}).catch(() => ({ items: [], totalItems: 0, page, perPage, totalPages: 0 }));
}

export async function countWorkspaceResources(collection, req, extraFilter = '') {
	const result = await listWorkspaceResources(collection, req, {
		page: 1,
		perPage: 1,
		extraFilter,
		fields: 'id',
	});
	return result.totalItems || 0;
}
