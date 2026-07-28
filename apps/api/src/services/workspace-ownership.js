/**
 * Workspace-scoped resource ownership.
 * Canonical fields: workspace, created_by, last_edited_by
 * Legacy `owner` is stamped as the workspace owner for backward-compatible filters.
 */
import pocketbaseClient from '../utils/pocketbaseClient.js';

function httpError(status, message, errorCode = 'FORBIDDEN') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function recordFieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

export function getWorkspaceActor(req) {
	const workspaceId = req.workspace?.id || '';
	const workspaceKey = req.workspaceKey || req.workspace?.workspace_key || '';
	const creatorId = req.pocketbaseUserId || '';
	const workspaceOwnerId = req.workspaceOwnerId
		|| (typeof req.workspace?.owner === 'string' ? req.workspace.owner : recordFieldId(req.workspace?.owner))
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
 * Combine workspace scope with an extra PocketBase filter expression.
 */
export function andWorkspaceScope(req, extraFilter = '', options = {}) {
	const scope = workspaceScopeFilter(req, options);
	const extra = String(extraFilter || '').trim();
	if (!extra) return scope;
	return `(${scope}) && (${extra})`;
}

/**
 * True if a record belongs to the active workspace (including legacy empty-workspace rows).
 */
export function recordBelongsToWorkspace(record, req, { ownerField = 'owner' } = {}) {
	if (!record) return false;
	const actor = getWorkspaceActor(req);
	const recordWs = recordFieldId(record.workspace);
	const recordOwner = recordFieldId(record[ownerField]);

	if (actor.workspaceId && recordWs && recordWs === String(actor.workspaceId)) {
		return true;
	}
	if (actor.workspaceId && !recordWs && actor.workspaceOwnerId && recordOwner === actor.workspaceOwnerId) {
		return true;
	}
	if (!actor.workspaceId) {
		const fallbackOwner = actor.workspaceOwnerId || actor.creatorId;
		return Boolean(fallbackOwner && recordOwner === fallbackOwner);
	}
	return false;
}

/**
 * Assert a loaded record is in the active workspace. Throws 404 to avoid IDOR enumeration.
 */
export function assertWorkspaceOwnedRecord(record, req, {
	ownerField = 'owner',
	notFoundMessage = 'Record not found',
} = {}) {
	if (!record || !recordBelongsToWorkspace(record, req, { ownerField })) {
		throw httpError(404, notFoundMessage, 'NOT_FOUND');
	}
	return record;
}

/**
 * Load a collection record and assert workspace ownership.
 */
export async function getWorkspaceOwnedRecord(collection, id, req, {
	ownerField = 'owner',
	notFoundMessage = 'Record not found',
} = {}) {
	const record = await pocketbaseClient.collection(collection).getOne(id).catch(() => null);
	return assertWorkspaceOwnedRecord(record, req, { ownerField, notFoundMessage });
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
	const filter = andWorkspaceScope(req, extraFilter);
	return pocketbaseClient.collection(collection).getList(page, perPage, {
		filter,
		sort,
		fields,
		requestKey: null,
	}).catch(() => ({ items: [], totalItems: 0, page, perPage, totalPages: 0 }));
}

/**
 * Full list scoped to the active workspace.
 */
export async function listWorkspaceResourcesFull(collection, req, {
	sort = '-created',
	extraFilter = '',
	fields,
} = {}) {
	const filter = andWorkspaceScope(req, extraFilter);
	return pocketbaseClient.collection(collection).getFullList({
		filter,
		sort,
		fields,
		requestKey: null,
	}).catch(() => []);
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
