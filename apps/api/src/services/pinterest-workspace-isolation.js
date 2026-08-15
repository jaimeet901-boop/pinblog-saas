/**
 * Pure Pinterest P0 workspace-isolation guards and payload builders.
 * No PocketBase / network imports — safe for fixture tests.
 */

function httpError(status, message, extras = {}) {
	const error = new Error(message);
	error.status = status;
	Object.assign(error, extras);
	return error;
}

function fieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

/** Reject when the active workspace is missing. */
export function requirePinterestWorkspaceId(workspaceId) {
	const id = fieldId(workspaceId);
	if (!id) {
		throw httpError(403, 'Workspace access is required');
	}
	return id;
}

/**
 * Record must belong to the active workspace owner + workspace.
 * Cross-workspace resources return not-found (no enumeration).
 */
export function assertPinterestStrictWorkspaceRecord(record, { workspaceId, ownerId }, notFoundMessage = 'Record not found') {
	const ws = requirePinterestWorkspaceId(workspaceId);
	const owner = fieldId(ownerId);
	if (!record
		|| fieldId(record.owner) !== owner
		|| fieldId(record.workspace) !== ws) {
		throw httpError(404, notFoundMessage);
	}
	return record;
}

/** Pin / account / board must stay consistent with the job. */
export function assertPinterestJobRelationConsistency({ job, pin, account, board }, notFoundMessage = 'Scheduled job not found') {
	if (!job || !pin || !account || !board) {
		throw httpError(404, notFoundMessage);
	}
	if (fieldId(pin.owner) !== fieldId(job.owner)
		|| fieldId(account.owner) !== fieldId(job.owner)
		|| fieldId(board.account) !== fieldId(account.id)) {
		throw httpError(404, notFoundMessage);
	}
	return { pin, account, board };
}

/**
 * Queue-side isolation before any publish attempt.
 * Returns normalized workspace + account ids on success.
 */
export function assertPinterestQueueWorkspaceIsolation({ job, pin, account, board }) {
	const workspaceId = fieldId(job?.workspace);
	if (!workspaceId) {
		throw httpError(403, 'Pinterest publish job workspace is missing');
	}

	const owner = fieldId(job?.owner);
	if (!pin || fieldId(pin.owner) !== owner || fieldId(pin.workspace) !== workspaceId) {
		throw httpError(404, 'Associated AI pin was not found');
	}

	const accountId = typeof job?.account === 'object'
		? fieldId(job.account?.id)
		: fieldId(job?.account);

	if (!account?.connected
		|| fieldId(account.workspace) !== workspaceId
		|| fieldId(account.owner) !== owner
		|| fieldId(account.id) !== accountId) {
		throw httpError(422, 'Pinterest account is not connected');
	}

	if (!board
		|| fieldId(board.workspace) !== workspaceId
		|| fieldId(board.owner) !== owner
		|| fieldId(board.account) !== fieldId(account.id)
		|| fieldId(board.board_id) !== fieldId(job.board_id)) {
		throw httpError(404, 'Pinterest board was not found');
	}

	return { workspaceId, accountId, owner };
}

/** Board sync may only run for an account bound to a workspace. */
export function assertPinterestAccountWorkspaceBound({ owner, account }) {
	const workspaceId = fieldId(account?.workspace);
	if (!workspaceId || fieldId(account?.owner) !== fieldId(owner)) {
		throw httpError(404, 'Pinterest account not found');
	}
	return workspaceId;
}

export function buildPinterestBoardSyncFilterParams({ owner, workspaceId, accountId }) {
	return {
		owner: fieldId(owner),
		workspace: fieldId(workspaceId),
		account: fieldId(accountId),
	};
}

export function buildPinterestSyncedBoardPayload({
	owner,
	workspaceId,
	account,
	board,
	thumbnailUrl = '',
}) {
	const ws = requirePinterestWorkspaceId(workspaceId);
	return {
		owner: fieldId(owner),
		workspace: ws,
		account: fieldId(account?.id),
		account_label: account?.label || account?.account_name || account?.username || '',
		account_username: account?.username || '',
		board_id: fieldId(board?.id || board?.board_id),
		name: String(board?.name || '').trim() || 'Untitled board',
		thumbnail_url: thumbnailUrl || '',
		description: String(board?.description || '').trim(),
		privacy: String(board?.privacy || '').trim(),
	};
}

/** Prefer default board inside the account workspace; never cross workspace. */
export function resolveDefaultBoardInWorkspace(boards, { workspaceId, accountId }) {
	const ws = fieldId(workspaceId);
	const account = fieldId(accountId);
	const scoped = (Array.isArray(boards) ? boards : []).filter((board) => (
		fieldId(board.workspace) === ws
		&& fieldId(board.account) === account
	));
	return scoped.find((board) => board.is_default) || scoped[0] || null;
}

/**
 * Stamp a Pinterest publish/schedule job create payload.
 * Requires an active workspace — never creates owner-only unscoped jobs.
 */
export function stampPinterestJobCreatePayload({ workspaceId, ownerId, creatorId }, fields = {}) {
	const ws = requirePinterestWorkspaceId(workspaceId);
	const owner = fieldId(ownerId) || fieldId(creatorId);
	const creator = fieldId(creatorId) || owner;
	return {
		...fields,
		workspace: ws,
		owner,
		created_by: creator,
		last_edited_by: creator,
	};
}

/** History create payload — workspace comes only from the job/explicit arg. */
export function buildPinterestHistoryCreatePayload({
	owner,
	accountId,
	jobId,
	workspaceId,
	workspaceKey,
	title,
	boardId,
	boardName,
	result,
	pinterestPinId,
	pinterestPinUrl,
	publishedAt,
	durationMs,
	attemptCount,
	error,
	meta = {},
} = {}) {
	return {
		owner,
		account: accountId || undefined,
		job: jobId || undefined,
		workspace: workspaceId || undefined,
		workspace_key: workspaceKey || String(owner || ''),
		title: title || '',
		board_id: boardId || '',
		board_name: boardName || '',
		result: result || 'published',
		pinterest_pin_id: pinterestPinId || '',
		pinterest_pin_url: pinterestPinUrl || '',
		published_at: publishedAt || new Date().toISOString(),
		duration_ms: Number(durationMs) || 0,
		attempt_count: Number(attemptCount) || 0,
		error: error || '',
		meta,
	};
}
