/**
 * Pure Facebook OAuth workspace-isolation guards (FB-F5 callback + FB-P2 start).
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

/** Safe product-level 409 copy. Safe to show in the Hub toast. */
export const FACEBOOK_OAUTH_ALREADY_CONNECTED_MESSAGE = 'This Facebook account is already connected. Use reconnect instead.';
export const FACEBOOK_OAUTH_PROFILE_IN_USE_MESSAGE = 'Another connected account already uses this Facebook profile.';

/** Safe Hub warning after connect succeeds but Pages sync fails. */
export const FACEBOOK_OAUTH_PAGES_SYNC_WARNING_MESSAGE = 'Some Facebook Pages could not be synced. You can retry from the Facebook hub.';

const SAFE_FACEBOOK_OAUTH_CALLBACK_BROWSER_MESSAGES = new Set([
	FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
	FACEBOOK_OAUTH_ALREADY_CONNECTED_MESSAGE,
	FACEBOOK_OAUTH_PROFILE_IN_USE_MESSAGE,
]);

function isSafeFacebookOAuthCallbackBrowserMessage(message) {
	return SAFE_FACEBOOK_OAUTH_CALLBACK_BROWSER_MESSAGES.has(String(message || '').trim());
}

/**
 * Map a callback exception to browser-facing facebook_error.
 * Unexpected / Graph / provider / internal text becomes the generic F5 message.
 * 409 product copy is preserved only when the status and message both match.
 */
export function facebookOAuthCallbackBrowserError(error) {
	const message = String(error?.message || '').trim();
	if (Number(error?.status) === 409 && isSafeFacebookOAuthCallbackBrowserMessage(message)) {
		return message;
	}
	return FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE;
}

/** Meta dialog denial — never forward error_description or error= to the browser. */
export function facebookOAuthProviderDeniedBrowserError() {
	return FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE;
}

/** Operational callback-failure log. Never includes message, tokens, codes, secrets, or state. */
export function facebookOAuthCallbackFailureLog(error) {
	return {
		status: Number(error?.status) || 0,
		errorCode: String(error?.errorCode || ''),
		hasMessage: Boolean(String(error?.message || '').trim()),
		messageLength: String(error?.message || '').length,
		safeProductError: Number(error?.status) === 409
			&& isSafeFacebookOAuthCallbackBrowserMessage(error?.message),
	};
}

export function facebookOAuthProviderDeniedLog({ hasError = false, hasErrorDescription = false } = {}) {
	return {
		hasError: Boolean(hasError),
		hasErrorDescription: Boolean(hasErrorDescription),
	};
}

export function facebookOAuthPageSyncFailureLog({ accountId = '', error } = {}) {
	return {
		hasAccountId: Boolean(String(accountId || '').trim()),
		status: Number(error?.status) || 0,
		errorCode: String(error?.errorCode || ''),
		hasMessage: Boolean(String(error?.message || '').trim()),
		messageLength: String(error?.message || '').length,
	};
}

/** Authenticated OAuth start must prove Hub workspace id + key. */
export const FACEBOOK_OAUTH_START_WORKSPACE_REQUIRED_MESSAGE = 'Workspace is required to start Facebook OAuth.';

/**
 * OAuth start workspace comes only from the authenticated Hub workspace.
 * Missing/empty id or key fails closed — never invent a workspace from the owner.
 */
export function resolveFacebookOAuthStartWorkspace({ workspaceId, workspaceKey } = {}) {
	const id = fieldId(workspaceId);
	const key = fieldId(workspaceKey);
	if (!id || !key) {
		throw httpError(422, FACEBOOK_OAUTH_START_WORKSPACE_REQUIRED_MESSAGE, {
			errorCode: 'FACEBOOK_WORKSPACE_REQUIRED',
		});
	}
	return { workspaceId: id, workspaceKey: key };
}

/** Full facebook_oauth_states create payload. Never omit workspace or reconnect fields. */
export function buildFacebookOAuthStateCreatePayload({
	owner,
	state,
	expiresAt,
	accountId = '',
	requestedLabel = '',
	workspaceId = '',
	workspaceKey = '',
	returnPath = '',
	websiteId = '',
} = {}) {
	const workspace = resolveFacebookOAuthStartWorkspace({ workspaceId, workspaceKey });
	const body = {
		owner,
		state,
		expires_at: expiresAt,
		used: false,
		account_id: accountId || '',
		requested_label: requestedLabel || '',
		workspace_id: workspace.workspaceId,
		workspace_key: workspace.workspaceKey,
		return_path: returnPath || '',
		workspace: workspace.workspaceId,
	};
	if (websiteId) body.websiteId = websiteId;
	return body;
}

/** Operational OAuth-start log fields. Never include state, authUrl, secrets, or codes. */
export function facebookOAuthStartLogFields({
	hasAuthUrl = false,
	hasState = false,
	stateLength = 0,
	hasClientId = false,
	redirectUri = '',
	scopes = [],
	dialogBase = '',
	graphVersion = '',
} = {}) {
	return {
		hasAuthUrl: Boolean(hasAuthUrl),
		hasState: Boolean(hasState),
		stateLength: Number(stateLength) || 0,
		hasClientId: Boolean(hasClientId),
		hasRedirectUri: Boolean(String(redirectUri || '').trim()),
		redirectUri: String(redirectUri || ''),
		responseType: 'code',
		scopeCount: Array.isArray(scopes) ? scopes.length : 0,
		dialogBase,
		graphVersion,
	};
}

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

export const FACEBOOK_JOB_WORKSPACE_MISSING_MESSAGE = 'Facebook publish job workspace is missing';
export const FACEBOOK_QUEUE_ACCOUNT_NOT_CONNECTED_MESSAGE = 'Facebook account is not connected';
export const FACEBOOK_QUEUE_PAGE_NOT_FOUND_MESSAGE = 'Facebook Page was not found';

function jobWorkspaceId(job) {
	return fieldId(job?.workspace || job?.workspace_id);
}

function jobAccountId(job) {
	return typeof job?.account === 'object'
		? fieldId(job?.account?.id)
		: fieldId(job?.account || job?.accountId);
}

function jobPageId(job) {
	return fieldId(job?.page_id || job?.pageId);
}

/** PocketBase filter params for a workspace-scoped facebook_pages lookup. */
export function buildFacebookQueuePageFilterParams({ owner, workspaceId, accountId, pageId } = {}) {
	return {
		owner: fieldId(owner),
		workspace: fieldId(workspaceId),
		account: fieldId(accountId),
		pageId: fieldId(pageId),
	};
}

/**
 * Queue/analytics isolation before any Graph call.
 * A WS-A job must never use a WS-B account or page, even for the same owner.
 */
export function assertFacebookQueueWorkspaceIsolation({ job, account, page } = {}) {
	const workspaceId = jobWorkspaceId(job);
	if (!workspaceId) {
		throw httpError(403, FACEBOOK_JOB_WORKSPACE_MISSING_MESSAGE, {
			errorCode: 'FACEBOOK_JOB_WORKSPACE_MISSING',
			retryable: false,
		});
	}

	const owner = fieldId(job?.owner);
	const accountId = jobAccountId(job);
	if (!owner || !accountId || !account?.connected
		|| fieldId(account.id) !== accountId
		|| fieldId(account.owner) !== owner
		|| fieldId(account.workspace) !== workspaceId) {
		throw httpError(422, FACEBOOK_QUEUE_ACCOUNT_NOT_CONNECTED_MESSAGE, {
			errorCode: 'FACEBOOK_ACCOUNT_WORKSPACE_MISMATCH',
			retryable: false,
		});
	}

	const pageId = jobPageId(job);
	if (!pageId || !page
		|| fieldId(page.workspace) !== workspaceId
		|| fieldId(page.owner) !== owner
		|| fieldId(page.account) !== fieldId(account.id)
		|| fieldId(page.page_id || page.pageId) !== pageId) {
		throw httpError(404, FACEBOOK_QUEUE_PAGE_NOT_FOUND_MESSAGE, {
			errorCode: 'FACEBOOK_PAGE_WORKSPACE_MISMATCH',
			retryable: false,
		});
	}

	return { workspaceId, accountId, owner, pageId };
}

export const FACEBOOK_ACCOUNT_WORKSPACE_REQUIRED_MESSAGE = 'Facebook account not found';

/**
 * Page sync may only run for an account already bound to a workspace.
 * Workspace comes from the account row — never from client input.
 */
export function assertFacebookAccountWorkspaceBound({ owner, account } = {}) {
	const workspaceId = fieldId(account?.workspace);
	if (!workspaceId
		|| !fieldId(account?.id)
		|| fieldId(account?.owner) !== fieldId(owner)) {
		throw httpError(404, FACEBOOK_ACCOUNT_WORKSPACE_REQUIRED_MESSAGE, {
			errorCode: 'FACEBOOK_ACCOUNT_WORKSPACE_REQUIRED',
		});
	}
	return workspaceId;
}

/** Bulk facebook_pages list for page sync: owner + workspace + account. */
export function buildFacebookPageSyncExistingFilterParams({ owner, workspaceId, accountId } = {}) {
	return {
		owner: fieldId(owner),
		workspace: fieldId(workspaceId),
		account: fieldId(accountId),
	};
}

/**
 * Select an existing page only when owner, workspace, account, and page_id all match.
 * Never returns a foreign-workspace row.
 */
export function selectFacebookExistingPageInWorkspace(existingPages, {
	owner,
	workspaceId,
	accountId,
	pageId,
} = {}) {
	const ownerId = fieldId(owner);
	const ws = fieldId(workspaceId);
	const account = fieldId(accountId);
	const pid = fieldId(pageId);
	if (!ownerId || !ws || !account || !pid) return null;
	return (Array.isArray(existingPages) ? existingPages : []).find((page) => (
		fieldId(page.owner) === ownerId
		&& fieldId(page.workspace) === ws
		&& fieldId(page.account) === account
		&& fieldId(page.page_id || page.pageId) === pid
	)) || null;
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
