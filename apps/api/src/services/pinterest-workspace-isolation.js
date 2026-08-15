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

/** Safe browser-facing OAuth failure. No workspace, owner, or DB details. */
export const PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE = 'Pinterest connection could not be completed. Please try connecting again.';

/**
 * Callback workspace comes only from OAuth state.
 * Missing/empty identity fails closed — never invent a workspace from the owner.
 */
export function resolvePinterestOAuthCallbackWorkspace(stateRecord) {
	const workspaceId = fieldId(stateRecord?.workspace_id || stateRecord?.workspace);
	if (!workspaceId) {
		throw httpError(400, PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE, {
			errorCode: 'PINTEREST_OAUTH_WORKSPACE_REQUIRED',
		});
	}
	return {
		workspaceId,
		workspaceKey: fieldId(stateRecord?.workspace_key) || workspaceId,
	};
}

/** Account connect/reconnect payload must keep a proven workspace. */
export function stampPinterestOAuthAccountWorkspace(payload, { workspaceId, workspaceKey }) {
	const ws = fieldId(workspaceId);
	if (!ws) {
		throw httpError(400, PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE, {
			errorCode: 'PINTEREST_OAUTH_WORKSPACE_REQUIRED',
		});
	}
	return {
		...payload,
		workspace: ws,
		workspace_id: ws,
		workspace_key: fieldId(workspaceKey) || ws,
	};
}

/**
 * Fail closed on account write errors.
 * Never return a retry payload with workspace fields stripped.
 */
export function failClosedPinterestOAuthAccountWrite(payload) {
	const ws = fieldId(payload?.workspace || payload?.workspace_id);
	if (!ws || !fieldId(payload?.workspace) || !fieldId(payload?.workspace_id)) {
		throw httpError(500, PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE, {
			errorCode: 'PINTEREST_OAUTH_WORKSPACE_REQUIRED',
		});
	}
	throw httpError(500, PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE, {
		errorCode: 'PINTEREST_OAUTH_ACCOUNT_WRITE_FAILED',
	});
}

/**
 * Synthetic workspace actor for callback helpers that already accept `req`.
 * Workspace identity comes only from validated OAuth state (F5).
 */
export function buildPinterestOAuthCallbackScope({ workspaceId, workspaceKey, ownerId }) {
	const ws = fieldId(workspaceId);
	const owner = fieldId(ownerId);
	if (!ws || !owner) {
		throw httpError(400, PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE, {
			errorCode: 'PINTEREST_OAUTH_WORKSPACE_REQUIRED',
		});
	}
	const key = fieldId(workspaceKey) || ws;
	return {
		workspace: { id: ws, workspace_key: key, owner },
		workspaceKey: key,
		workspaceOwnerId: owner,
		pocketbaseUserId: owner,
	};
}

/** Keep an account only when it is bound to the OAuth state workspace. Never select a foreign row. */
export function bindPinterestOAuthAccountToStateWorkspace(account, { workspaceId, ownerId }) {
	if (!account) return null;
	const ws = fieldId(workspaceId);
	const owner = fieldId(ownerId);
	if (!ws || !owner
		|| fieldId(account.owner) !== owner
		|| fieldId(account.workspace) !== ws) {
		return null;
	}
	return account;
}

/** Reconnect must target the state workspace; otherwise 404 (no enumeration). */
export function requirePinterestOAuthReconnectAccount(account, { workspaceId, ownerId }) {
	return assertPinterestStrictWorkspaceRecord(
		account,
		{ workspaceId, ownerId },
		'Pinterest account not found',
	);
}

export function selectPinterestOAuthWorkspaceAccounts(accounts, { workspaceId, ownerId }) {
	const ws = fieldId(workspaceId);
	const owner = fieldId(ownerId);
	return (Array.isArray(accounts) ? accounts : []).filter((account) => (
		fieldId(account.owner) === owner && fieldId(account.workspace) === ws
	));
}

/** Default-flag writes may only touch accounts in the OAuth state workspace. */
export function defaultFlagUpdatesForOAuthWorkspace(accounts, { workspaceId, ownerId, accountId }) {
	const target = fieldId(accountId);
	return selectPinterestOAuthWorkspaceAccounts(accounts, { workspaceId, ownerId }).map((account) => ({
		id: account.id,
		is_default: fieldId(account.id) === target,
	}));
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

/**
 * F3 CAS decision for a pinterest_oauth_states row.
 * Models UPDATE ... SET used=true WHERE id=? AND used=false AND expires_at>now.
 * Does not mutate the row. Zero-row (used/expired/missing) is failure, never a no-op success.
 */
export function applyPinterestOAuthStateCas(row, { nowMs } = {}) {
	if (!row || !fieldId(row.id)) {
		return { ok: false, reason: 'invalid' };
	}
	const used = row.used === true || row.used === 1 || row.used === 'true';
	if (used) {
		return { ok: false, reason: 'used' };
	}
	const expires = new Date(row.expires_at).getTime();
	const now = Number.isFinite(nowMs) ? nowMs : Date.now();
	if (!Number.isFinite(expires) || expires <= now) {
		return { ok: false, reason: 'expired' };
	}
	return {
		ok: true,
		id: fieldId(row.id),
		workspace_id: fieldId(row.workspace_id || row.workspace),
	};
}

/**
 * PocketBase collection.update({ used: true }) succeeds whenever the row exists,
 * including already-used rows (silent no-op). That is not CAS.
 */
export function wouldUnconditionalPinterestOAuthStateUsedPatchSucceed(row) {
	return Boolean(fieldId(row?.id));
}

/**
 * Concurrent-safe in-memory stand-in for the SQL conditional UPDATE.
 * Uses Atomics.compareExchange so overlapping Promise.all callers cannot both win.
 * Never writes workspace_id.
 */
export function createPinterestOAuthStateCasStore(initial = {}) {
	const row = {
		id: fieldId(initial.id) || 'state_1',
		used: Boolean(initial.used),
		expires_at: initial.expires_at,
		workspace_id: fieldId(initial.workspace_id || initial.workspace),
		workspace_key: fieldId(initial.workspace_key),
		owner: fieldId(initial.owner),
	};
	const usedFlag = new Int32Array(1);
	usedFlag[0] = row.used ? 1 : 0;

	return {
		async consume(nowMs = Date.now()) {
			await Promise.resolve();
			const snapshot = {
				...row,
				used: Atomics.load(usedFlag, 0) === 1,
			};
			const decision = applyPinterestOAuthStateCas(snapshot, { nowMs });
			if (!decision.ok) {
				return decision;
			}
			const previous = Atomics.compareExchange(usedFlag, 0, 0, 1);
			if (previous !== 0) {
				return { ok: false, reason: 'used' };
			}
			row.used = true;
			return {
				ok: true,
				id: row.id,
				workspace_id: row.workspace_id,
			};
		},
		snapshot() {
			return {
				...row,
				used: Atomics.load(usedFlag, 0) === 1,
			};
		},
	};
}

/** Safe browser-facing consume/replay/expiry failure. No ids, tokens, or DB details. */
export function rejectPinterestOAuthStateConsume() {
	throw httpError(400, PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE, {
		errorCode: 'PINTEREST_OAUTH_STATE_CONSUMED',
	});
}

/** Superuser consume endpoint must return ok + the same id; anything else is a failed consume. */
export function interpretPinterestOAuthStateConsumeResult(result, expectedId) {
	const id = fieldId(expectedId);
	if (!result?.ok || fieldId(result.id) !== id) {
		rejectPinterestOAuthStateConsume();
	}
	return result;
}
