/**
 * Pure Facebook OAuth callback workspace-isolation guards (FB-F5).
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

/** Safe browser-facing OAuth failure. No workspace, owner, or DB details. */
export const FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE = 'Facebook connection could not be completed. Please try connecting again.';

/**
 * Callback workspace comes only from OAuth state.
 * Missing/empty identity fails closed — never invent a workspace from the owner.
 */
export function resolveFacebookOAuthCallbackWorkspace(stateRecord) {
	const workspaceId = fieldId(stateRecord?.workspace_id || stateRecord?.workspace);
	if (!workspaceId) {
		throw httpError(400, FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE, {
			errorCode: 'FACEBOOK_OAUTH_WORKSPACE_REQUIRED',
		});
	}
	return {
		workspaceId,
		workspaceKey: fieldId(stateRecord?.workspace_key) || workspaceId,
	};
}

/** Account connect/reconnect payload must keep a proven workspace. */
export function stampFacebookOAuthAccountWorkspace(payload, { workspaceId, workspaceKey }) {
	const ws = fieldId(workspaceId);
	if (!ws) {
		throw httpError(400, FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE, {
			errorCode: 'FACEBOOK_OAUTH_WORKSPACE_REQUIRED',
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
export function failClosedFacebookOAuthAccountWrite(payload) {
	const ws = fieldId(payload?.workspace || payload?.workspace_id);
	if (!ws || !fieldId(payload?.workspace) || !fieldId(payload?.workspace_id)) {
		throw httpError(500, FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE, {
			errorCode: 'FACEBOOK_OAUTH_WORKSPACE_REQUIRED',
		});
	}
	throw httpError(500, FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE, {
		errorCode: 'FACEBOOK_OAUTH_ACCOUNT_WRITE_FAILED',
	});
}

/**
 * Synthetic workspace actor for callback helpers that already accept `req`.
 * Workspace identity comes only from validated OAuth state (F5).
 */
export function buildFacebookOAuthCallbackScope({ workspaceId, workspaceKey, ownerId }) {
	const ws = fieldId(workspaceId);
	const owner = fieldId(ownerId);
	if (!ws || !owner) {
		throw httpError(400, FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE, {
			errorCode: 'FACEBOOK_OAUTH_WORKSPACE_REQUIRED',
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
export function bindFacebookOAuthAccountToStateWorkspace(account, { workspaceId, ownerId }) {
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
export function requireFacebookOAuthReconnectAccount(account, { workspaceId, ownerId }) {
	const ws = fieldId(workspaceId);
	const owner = fieldId(ownerId);
	if (!account
		|| fieldId(account.owner) !== owner
		|| fieldId(account.workspace) !== ws) {
		throw httpError(404, 'Facebook account not found', {
			errorCode: 'FACEBOOK_ACCOUNT_NOT_FOUND',
		});
	}
	return account;
}

export function selectFacebookOAuthWorkspaceAccounts(accounts, { workspaceId, ownerId }) {
	const ws = fieldId(workspaceId);
	const owner = fieldId(ownerId);
	return (Array.isArray(accounts) ? accounts : []).filter((account) => (
		fieldId(account.owner) === owner && fieldId(account.workspace) === ws
	));
}

/** Default-flag writes may only touch accounts in the OAuth state workspace. */
export function defaultFlagUpdatesForFacebookOAuthWorkspace(accounts, { workspaceId, ownerId, accountId }) {
	const target = fieldId(accountId);
	return selectFacebookOAuthWorkspaceAccounts(accounts, { workspaceId, ownerId }).map((account) => ({
		id: account.id,
		is_default: fieldId(account.id) === target,
	}));
}

/**
 * F3 CAS decision for a facebook_oauth_states row.
 * Models UPDATE ... SET used=true WHERE id=? AND used=false AND expires_at>now.
 * Does not mutate the row. Zero-row (used/expired/missing) is failure, never a no-op success.
 */
export function applyFacebookOAuthStateCas(row, { nowMs } = {}) {
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
export function wouldUnconditionalFacebookOAuthStateUsedPatchSucceed(row) {
	return Boolean(fieldId(row?.id));
}

/**
 * Concurrent-safe in-memory stand-in for the SQL conditional UPDATE.
 * Uses Atomics.compareExchange so overlapping Promise.all callers cannot both win.
 * Never writes workspace_id. Not used by Express at runtime.
 */
export function createFacebookOAuthStateCasStore(initial = {}) {
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
			const decision = applyFacebookOAuthStateCas(snapshot, { nowMs });
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
export function rejectFacebookOAuthStateConsume() {
	throw httpError(400, FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE, {
		errorCode: 'FACEBOOK_OAUTH_STATE_CONSUMED',
	});
}

/** Superuser consume endpoint must return ok + the same id; anything else is a failed consume. */
export function interpretFacebookOAuthStateConsumeResult(result, expectedId) {
	const id = fieldId(expectedId);
	if (!result?.ok || fieldId(result.id) !== id) {
		rejectFacebookOAuthStateConsume();
	}
	return result;
}
