import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	applyFacebookOAuthStateCas,
	bindFacebookOAuthAccountToStateWorkspace,
	buildFacebookOAuthCallbackScope,
	buildFacebookOAuthStateCreatePayload,
	createFacebookOAuthStateCasStore,
	defaultFlagUpdatesForFacebookOAuthWorkspace,
	failClosedFacebookOAuthAccountWrite,
	FACEBOOK_OAUTH_ALREADY_CONNECTED_MESSAGE,
	FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
	FACEBOOK_OAUTH_PAGES_SYNC_WARNING_MESSAGE,
	FACEBOOK_OAUTH_PROFILE_IN_USE_MESSAGE,
	FACEBOOK_OAUTH_START_WORKSPACE_REQUIRED_MESSAGE,
	facebookOAuthCallbackBrowserError,
	facebookOAuthCallbackFailureLog,
	facebookOAuthPageSyncFailureLog,
	facebookOAuthProviderDeniedBrowserError,
	facebookOAuthProviderDeniedLog,
	facebookOAuthStartLogFields,
	interpretFacebookOAuthStateConsumeResult,
	rejectFacebookOAuthStateConsume,
	requireFacebookOAuthReconnectAccount,
	resolveFacebookOAuthCallbackWorkspace,
	resolveFacebookOAuthStartWorkspace,
	selectFacebookOAuthWorkspaceAccounts,
	stampFacebookOAuthAccountWorkspace,
	wouldUnconditionalFacebookOAuthStateUsedPatchSucceed,
	assertFacebookQueueWorkspaceIsolation,
	assertFacebookAccountWorkspaceBound,
	buildFacebookQueuePageFilterParams,
	buildFacebookPageSyncExistingFilterParams,
	buildFacebookAccountsSummary,
	countFacebookAccountPagesInWorkspace,
	selectFacebookExistingPageInWorkspace,
	FACEBOOK_ACCOUNT_WORKSPACE_REQUIRED_MESSAGE,
	FACEBOOK_JOB_WORKSPACE_MISSING_MESSAGE,
	FACEBOOK_QUEUE_ACCOUNT_NOT_CONNECTED_MESSAGE,
	FACEBOOK_QUEUE_PAGE_NOT_FOUND_MESSAGE,
} from './workspace-isolation.js';

const WS_A = 'workspace_a';
const OWNER = 'owner_1';

function isSafeGenericReconnectError(error, status) {
	return error.status === status
		&& error.message === FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE
		&& !/workspace_a|owner_1|pocketbase|ensureUserWorkspace/i.test(error.message);
}

describe('Facebook OAuth callback workspace fail-closed (F5)', () => {
	function runCallbackAfterWorkspaceGate(stateRecord) {
		const writes = {
			ensureUserWorkspace: 0,
			account: 0,
			secrets: 0,
			pages: 0,
		};
		const workspace = resolveFacebookOAuthCallbackWorkspace(stateRecord);
		const payload = stampFacebookOAuthAccountWorkspace({ owner: OWNER }, workspace);
		writes.account += 1;
		writes.secrets += 1;
		writes.pages += 1;
		return { workspace, payload, writes };
	}

	it('preserves and stamps a valid workspace_id from OAuth state', () => {
		const result = runCallbackAfterWorkspaceGate({
			owner: OWNER,
			workspace_id: WS_A,
			workspace_key: 'key_a',
		});
		assert.equal(result.workspace.workspaceId, WS_A);
		assert.equal(result.workspace.workspaceKey, 'key_a');
		assert.equal(result.payload.workspace, WS_A);
		assert.equal(result.payload.workspace_id, WS_A);
		assert.equal(result.payload.workspace_key, 'key_a');
		assert.equal(result.writes.account, 1);
		assert.equal(result.writes.ensureUserWorkspace, 0);
	});

	it('stamps workspace from the workspace relation when workspace_id is absent', () => {
		const result = runCallbackAfterWorkspaceGate({
			owner: OWNER,
			workspace: WS_A,
			workspace_key: 'key_a',
		});
		assert.equal(result.payload.workspace, WS_A);
		assert.equal(result.payload.workspace_id, WS_A);
	});

	it('rejects missing workspace_id without owner fallback or resource writes', () => {
		let ensureUserWorkspaceCalls = 0;
		const writes = { account: 0, secrets: 0, pages: 0 };
		assert.throws(
			() => {
				const workspace = resolveFacebookOAuthCallbackWorkspace({
					owner: OWNER,
				});
				ensureUserWorkspaceCalls += 1;
				writes.account += 1;
				writes.secrets += 1;
				writes.pages += 1;
				return stampFacebookOAuthAccountWorkspace({ owner: OWNER }, workspace);
			},
			(error) => isSafeGenericReconnectError(error, 400),
		);
		assert.equal(ensureUserWorkspaceCalls, 0);
		assert.deepEqual(writes, { account: 0, secrets: 0, pages: 0 });
	});

	it('rejects empty workspace_id without account, secret, or Page writes', () => {
		let ensureUserWorkspaceCalls = 0;
		const writes = { account: 0, secrets: 0, pages: 0 };
		assert.throws(
			() => {
				const workspace = resolveFacebookOAuthCallbackWorkspace({
					owner: OWNER,
					workspace_id: '',
					workspace_key: 'key_a',
				});
				ensureUserWorkspaceCalls += 1;
				writes.account += 1;
				writes.secrets += 1;
				writes.pages += 1;
				return stampFacebookOAuthAccountWorkspace({ owner: OWNER }, workspace);
			},
			(error) => isSafeGenericReconnectError(error, 400),
		);
		assert.equal(ensureUserWorkspaceCalls, 0);
		assert.deepEqual(writes, { account: 0, secrets: 0, pages: 0 });
	});

	it('rejects whitespace workspace_id without account, secret, or Page writes', () => {
		let ensureUserWorkspaceCalls = 0;
		const writes = { account: 0, secrets: 0, pages: 0 };
		assert.throws(
			() => {
				const workspace = resolveFacebookOAuthCallbackWorkspace({
					owner: OWNER,
					workspace_id: '   ',
					workspace: '  ',
					workspace_key: 'key_a',
				});
				ensureUserWorkspaceCalls += 1;
				writes.account += 1;
				writes.secrets += 1;
				writes.pages += 1;
				return stampFacebookOAuthAccountWorkspace({ owner: OWNER }, workspace);
			},
			(error) => isSafeGenericReconnectError(error, 400),
		);
		assert.equal(ensureUserWorkspaceCalls, 0);
		assert.deepEqual(writes, { account: 0, secrets: 0, pages: 0 });
	});

	it('does not strip workspace fields or retry unscoped after account write failure', () => {
		const payload = stampFacebookOAuthAccountWorkspace(
			{ owner: OWNER, label: 'Kitchen Page' },
			{ workspaceId: WS_A, workspaceKey: 'key_a' },
		);
		const snapshot = { ...payload };
		assert.throws(
			() => {
				try {
					throw new Error('schema validation failed');
				} catch {
					failClosedFacebookOAuthAccountWrite(payload);
				}
			},
			(error) => isSafeGenericReconnectError(error, 500)
				&& !/schema validation failed/i.test(error.message),
		);
		assert.equal(payload.workspace, snapshot.workspace);
		assert.equal(payload.workspace_id, snapshot.workspace_id);
		assert.equal(payload.workspace_key, snapshot.workspace_key);
		assert.equal(payload.workspace, WS_A);
		assert.equal(payload.workspace_id, WS_A);
		assert.equal(payload.workspace_key, 'key_a');
	});

	it('failClosedFacebookOAuthAccountWrite never returns a stripped retry payload', () => {
		const payload = stampFacebookOAuthAccountWorkspace(
			{ owner: OWNER },
			{ workspaceId: WS_A, workspaceKey: 'key_a' },
		);
		assert.throws(
			() => failClosedFacebookOAuthAccountWrite(payload),
			(error) => isSafeGenericReconnectError(error, 500),
		);
		assert.equal(payload.workspace, WS_A);
		assert.equal(payload.workspace_id, WS_A);
	});
});

describe('Facebook OAuth callback workspace scoping (F4)', () => {
	const WS_B = 'workspace_b';

	function fixtureAccount(overrides = {}) {
		return {
			id: 'account_a',
			owner: OWNER,
			workspace: WS_A,
			facebook_user_id: 'fb_user_1',
			is_default: false,
			...overrides,
		};
	}

	it('allows reconnect of a same-workspace account', () => {
		const account = requireFacebookOAuthReconnectAccount(
			fixtureAccount({ id: 'account_a', workspace: WS_A }),
			{ workspaceId: WS_A, ownerId: OWNER },
		);
		assert.equal(account.id, 'account_a');
		assert.equal(account.workspace, WS_A);
	});

	it('rejects reconnect of a Workspace B account from a Workspace A state', () => {
		let mutated = false;
		const foreign = fixtureAccount({ id: 'account_b', workspace: WS_B });
		assert.throws(
			() => {
				requireFacebookOAuthReconnectAccount(
					foreign,
					{ workspaceId: WS_A, ownerId: OWNER },
				);
				mutated = true;
			},
			(error) => error.status === 404
				&& error.message === 'Facebook account not found'
				&& !/workspace_b|account_b/i.test(error.message),
		);
		assert.equal(mutated, false);
		assert.equal(foreign.workspace, WS_B);
		assert.equal(foreign.id, 'account_b');
	});

	it('keeps same-workspace duplicate Facebook-user account as the existing row', () => {
		const existing = bindFacebookOAuthAccountToStateWorkspace(
			fixtureAccount({
				id: 'account_a',
				workspace: WS_A,
				facebook_user_id: 'fb_user_1',
			}),
			{ workspaceId: WS_A, ownerId: OWNER },
		);
		assert.equal(existing.id, 'account_a');
		assert.equal(existing.workspace, WS_A);
		assert.equal(existing.facebook_user_id, 'fb_user_1');
	});

	it('does not select or mutate a same-owner Workspace B duplicate Facebook user', () => {
		const foreign = fixtureAccount({
			id: 'account_b',
			workspace: WS_B,
			facebook_user_id: 'fb_user_1',
		});
		const selected = bindFacebookOAuthAccountToStateWorkspace(
			foreign,
			{ workspaceId: WS_A, ownerId: OWNER },
		);
		assert.equal(selected, null);
		assert.equal(foreign.workspace, WS_B);
		assert.equal(foreign.id, 'account_b');
		assert.equal(foreign.facebook_user_id, 'fb_user_1');
	});

	it('may set default only inside Workspace A and leaves Workspace B default unchanged', () => {
		const accounts = [
			fixtureAccount({ id: 'account_a', workspace: WS_A, is_default: false }),
			fixtureAccount({ id: 'account_b', workspace: WS_B, is_default: true }),
		];
		const scoped = selectFacebookOAuthWorkspaceAccounts(accounts, {
			workspaceId: WS_A,
			ownerId: OWNER,
		});
		assert.deepEqual(scoped.map((account) => account.id), ['account_a']);
		const updates = defaultFlagUpdatesForFacebookOAuthWorkspace(accounts, {
			workspaceId: WS_A,
			ownerId: OWNER,
			accountId: 'account_a',
		});
		assert.deepEqual(updates, [{ id: 'account_a', is_default: true }]);
		assert.equal(updates.some((row) => row.id === 'account_b'), false);
		assert.equal(accounts.find((account) => account.id === 'account_b').is_default, true);
	});

	it('same-owner multi-workspace callback never mutates the foreign workspace', () => {
		const resolved = resolveFacebookOAuthCallbackWorkspace({
			owner: OWNER,
			workspace_id: WS_A,
			workspace_key: 'key_a',
		});
		const scope = buildFacebookOAuthCallbackScope({
			workspaceId: resolved.workspaceId,
			workspaceKey: resolved.workspaceKey,
			ownerId: OWNER,
		});
		assert.equal(scope.workspace.id, WS_A);
		assert.equal(scope.workspaceOwnerId, OWNER);
		assert.equal(scope.pocketbaseUserId, OWNER);

		const accounts = [
			fixtureAccount({ id: 'account_a', workspace: WS_A, is_default: false }),
			fixtureAccount({ id: 'account_b', workspace: WS_B, is_default: true, facebook_user_id: 'fb_user_1' }),
		];
		const reconnect = bindFacebookOAuthAccountToStateWorkspace(
			accounts[1],
			{ workspaceId: WS_A, ownerId: OWNER },
		);
		const duplicate = bindFacebookOAuthAccountToStateWorkspace(
			accounts[1],
			{ workspaceId: WS_A, ownerId: OWNER },
		);
		const defaultUpdates = defaultFlagUpdatesForFacebookOAuthWorkspace(accounts, {
			workspaceId: WS_A,
			ownerId: OWNER,
			accountId: 'account_a',
		});
		assert.equal(reconnect, null);
		assert.equal(duplicate, null);
		assert.deepEqual(defaultUpdates.map((row) => row.id), ['account_a']);
		assert.equal(accounts[1].is_default, true);
		assert.equal(accounts[1].workspace, WS_B);
		assert.equal(accounts[1].facebook_user_id, 'fb_user_1');
	});
});

describe('Facebook OAuth state atomic consume (F3)', () => {
	const FUTURE = '2099-01-01T00:00:00.000Z';
	const PAST = '2000-01-01T00:00:00.000Z';
	const NOW = Date.parse('2026-08-15T12:00:00.000Z');

	function fixtureState(overrides = {}) {
		return {
			id: 'state_1',
			owner: OWNER,
			workspace_id: WS_A,
			workspace_key: 'key_a',
			used: false,
			expires_at: FUTURE,
			...overrides,
		};
	}

	function isSafeOAuthError(error) {
		return error.status === 400
			&& error.message === FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE
			&& !/workspace_a|workspace_b|owner_1|state_1|SELECT|UPDATE|pocketbase|facebook_oauth/i.test(error.message)
			&& !/invalid_grant|access_token|expires_at|graph\.facebook/i.test(error.message);
	}

	async function runCallbackAfterConsume(cas, nowMs, { tokenExchangeFails = false } = {}) {
		const writes = { tokenExchange: 0, account: 0, secrets: 0, pages: 0 };
		const consume = await cas.consume(nowMs);
		if (!consume.ok) {
			rejectFacebookOAuthStateConsume();
		}
		writes.tokenExchange += 1;
		if (tokenExchangeFails) {
			throw Object.assign(new Error(FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE), {
				status: 400,
				errorCode: 'FACEBOOK_OAUTH_TOKEN_EXCHANGE_FAILED',
			});
		}
		writes.account += 1;
		writes.secrets += 1;
		writes.pages += 1;
		return { consume, writes, snapshot: cas.snapshot() };
	}

	it('first consume succeeds', async () => {
		const cas = createFacebookOAuthStateCasStore(fixtureState());
		const first = await cas.consume(NOW);
		assert.equal(first.ok, true);
		assert.equal(cas.snapshot().used, true);
	});

	it('sequential replay: first consume succeeds, second consume fails', async () => {
		const cas = createFacebookOAuthStateCasStore(fixtureState());
		const first = await cas.consume(NOW);
		const second = await cas.consume(NOW);
		assert.equal(first.ok, true);
		assert.equal(second.ok, false);
		assert.equal(second.reason, 'used');
		assert.equal(cas.snapshot().used, true);
	});

	it('concurrent consume: exactly one of two overlapping attempts succeeds', async () => {
		const cas = createFacebookOAuthStateCasStore(fixtureState());
		const results = await Promise.all([cas.consume(NOW), cas.consume(NOW)]);
		assert.equal(results.filter((result) => result.ok).length, 1);
		assert.equal(results.filter((result) => !result.ok).length, 1);
		assert.equal(cas.snapshot().used, true);
	});

	it('losing callback does not exchange Graph tokens or write account/secrets/pages', async () => {
		const cas = createFacebookOAuthStateCasStore(fixtureState());
		const winnerWrites = { tokenExchange: 0, account: 0, secrets: 0, pages: 0 };
		const loserWrites = { tokenExchange: 0, account: 0, secrets: 0, pages: 0 };
		const [first, second] = await Promise.all([cas.consume(NOW), cas.consume(NOW)]);
		const winner = first.ok ? first : second;
		const loser = first.ok ? second : first;
		if (winner.ok) {
			winnerWrites.tokenExchange += 1;
			winnerWrites.account += 1;
			winnerWrites.secrets += 1;
			winnerWrites.pages += 1;
		}
		if (loser.ok) {
			loserWrites.tokenExchange += 1;
			loserWrites.account += 1;
			loserWrites.secrets += 1;
			loserWrites.pages += 1;
		}
		assert.equal(winner.ok, true);
		assert.equal(loser.ok, false);
		assert.deepEqual(winnerWrites, { tokenExchange: 1, account: 1, secrets: 1, pages: 1 });
		assert.deepEqual(loserWrites, { tokenExchange: 0, account: 0, secrets: 0, pages: 0 });
	});

	it('expired state cannot consume', async () => {
		assert.equal(
			applyFacebookOAuthStateCas(fixtureState({ expires_at: PAST }), { nowMs: NOW }).ok,
			false,
		);
		assert.equal(
			applyFacebookOAuthStateCas(fixtureState({ expires_at: PAST }), { nowMs: NOW }).reason,
			'expired',
		);
		const cas = createFacebookOAuthStateCasStore(fixtureState({ expires_at: PAST }));
		const result = await cas.consume(NOW);
		assert.equal(result.ok, false);
		assert.equal(result.reason, 'expired');
		assert.equal(cas.snapshot().used, false);
	});

	it('already-used state cannot consume', async () => {
		assert.equal(
			applyFacebookOAuthStateCas(fixtureState({ used: true }), { nowMs: NOW }).ok,
			false,
		);
		assert.equal(
			applyFacebookOAuthStateCas(fixtureState({ used: true }), { nowMs: NOW }).reason,
			'used',
		);
		const cas = createFacebookOAuthStateCasStore(fixtureState({ used: true }));
		const result = await cas.consume(NOW);
		assert.equal(result.ok, false);
		assert.equal(result.reason, 'used');
		assert.equal(cas.snapshot().used, true);
	});

	it('failed Graph exchange after successful consume writes no account and leaves state used', async () => {
		const cas = createFacebookOAuthStateCasStore(fixtureState());
		await assert.rejects(
			() => runCallbackAfterConsume(cas, NOW, { tokenExchangeFails: true }),
			(error) => isSafeOAuthError(error),
		);
		assert.equal(cas.snapshot().used, true);
		assert.equal(cas.snapshot().workspace_id, WS_A);
	});

	it('successful consume does not alter workspace_id', async () => {
		const cas = createFacebookOAuthStateCasStore(fixtureState({ workspace_id: WS_A }));
		const result = await cas.consume(NOW);
		assert.equal(result.ok, true);
		assert.equal(result.workspace_id, WS_A);
		assert.equal(cas.snapshot().workspace_id, WS_A);
		assert.equal(cas.snapshot().workspace_key, 'key_a');
	});

	it('unconditional used=true patch would silently succeed on an already-used row; CAS does not', () => {
		const usedRow = fixtureState({ used: true });
		assert.equal(wouldUnconditionalFacebookOAuthStateUsedPatchSucceed(usedRow), true);
		assert.equal(applyFacebookOAuthStateCas(usedRow, { nowMs: NOW }).ok, false);
	});

	it('losing, replayed, and expired consume failures use the safe OAuth error', () => {
		assert.throws(() => rejectFacebookOAuthStateConsume(), isSafeOAuthError);
		assert.throws(
			() => interpretFacebookOAuthStateConsumeResult({ ok: false }, 'state_1'),
			isSafeOAuthError,
		);
		assert.throws(
			() => interpretFacebookOAuthStateConsumeResult({ ok: true, id: 'other' }, 'state_1'),
			isSafeOAuthError,
		);
		assert.doesNotThrow(() => interpretFacebookOAuthStateConsumeResult({ ok: true, id: 'state_1' }, 'state_1'));
	});
});

describe('Facebook OAuth start workspace fail-closed (P2-1 / P2-2 / P2-4)', () => {
	const KEY_A = 'key_a';

	function isStartWorkspaceRequired(error) {
		return error.status === 422
			&& error.errorCode === 'FACEBOOK_WORKSPACE_REQUIRED'
			&& error.message === FACEBOOK_OAUTH_START_WORKSPACE_REQUIRED_MESSAGE;
	}

	it('stamps the active workspace id and preserves workspaceKey', () => {
		const resolved = resolveFacebookOAuthStartWorkspace({
			workspaceId: WS_A,
			workspaceKey: KEY_A,
		});
		assert.equal(resolved.workspaceId, WS_A);
		assert.equal(resolved.workspaceKey, KEY_A);

		const payload = buildFacebookOAuthStateCreatePayload({
			owner: OWNER,
			state: 'nonce_1',
			expiresAt: '2026-08-15T18:00:00.000Z',
			accountId: '',
			requestedLabel: 'Kitchen',
			workspaceId: WS_A,
			workspaceKey: KEY_A,
			returnPath: '/app/facebook',
		});
		assert.equal(payload.workspace, WS_A);
		assert.equal(payload.workspace_id, WS_A);
		assert.equal(payload.workspace_key, KEY_A);
		assert.equal(payload.owner, OWNER);
		assert.equal(payload.account_id, '');
		assert.equal(payload.requested_label, 'Kitchen');
		assert.equal(payload.return_path, '/app/facebook');
		assert.equal(payload.used, false);
		assert.equal('websiteId' in payload, false);
	});

	it('fails closed when workspace id or workspaceKey is missing or whitespace', () => {
		assert.throws(() => resolveFacebookOAuthStartWorkspace({}), isStartWorkspaceRequired);
		assert.throws(
			() => resolveFacebookOAuthStartWorkspace({ workspaceId: WS_A, workspaceKey: '' }),
			isStartWorkspaceRequired,
		);
		assert.throws(
			() => resolveFacebookOAuthStartWorkspace({ workspaceId: '', workspaceKey: KEY_A }),
			isStartWorkspaceRequired,
		);
		assert.throws(
			() => resolveFacebookOAuthStartWorkspace({ workspaceId: '  ', workspaceKey: KEY_A }),
			isStartWorkspaceRequired,
		);
		assert.throws(
			() => resolveFacebookOAuthStartWorkspace({ workspaceId: WS_A, workspaceKey: '  ' }),
			isStartWorkspaceRequired,
		);
		assert.throws(
			() => buildFacebookOAuthStateCreatePayload({
				owner: OWNER,
				state: 'nonce_1',
				expiresAt: '2026-08-15T18:00:00.000Z',
			}),
			isStartWorkspaceRequired,
		);
	});

	it('does not invent a workspaceKey from the workspace id', () => {
		assert.throws(
			() => resolveFacebookOAuthStartWorkspace({ workspaceId: WS_A }),
			isStartWorkspaceRequired,
		);
	});

	it('reconnect payload retains account_id and uses the initiating workspace, not another account workspace', () => {
		const payload = buildFacebookOAuthStateCreatePayload({
			owner: OWNER,
			state: 'nonce_reconnect',
			expiresAt: '2026-08-15T18:00:00.000Z',
			accountId: 'account_1',
			requestedLabel: 'Reconnect',
			workspaceId: WS_A,
			workspaceKey: KEY_A,
		});
		assert.equal(payload.account_id, 'account_1');
		assert.equal(payload.workspace, WS_A);
		assert.equal(payload.workspace_id, WS_A);
		assert.equal(payload.workspace_key, KEY_A);
		assert.equal(payload.requested_label, 'Reconnect');
		assert.equal(payload.return_path, '');
	});

	it('create payload always includes full state fields and never a reduced retry shape', () => {
		const payload = buildFacebookOAuthStateCreatePayload({
			owner: OWNER,
			state: 'nonce_1',
			expiresAt: '2026-08-15T18:00:00.000Z',
			accountId: 'account_1',
			requestedLabel: 'Label',
			workspaceId: WS_A,
			workspaceKey: KEY_A,
			returnPath: '/app/facebook',
			websiteId: 'site_1',
		});
		assert.deepEqual(Object.keys(payload).sort(), [
			'account_id',
			'expires_at',
			'owner',
			'requested_label',
			'return_path',
			'state',
			'used',
			'websiteId',
			'workspace',
			'workspace_id',
			'workspace_key',
		]);
	});

	it('OAuth start logs never include state, authUrl, secrets, or codes', () => {
		const fields = facebookOAuthStartLogFields({
			hasAuthUrl: true,
			hasState: true,
			stateLength: 48,
			hasClientId: true,
			redirectUri: 'https://example.com/api/facebook/oauth/callback',
			scopes: ['pages_show_list'],
			dialogBase: 'https://www.facebook.com/v22.0/dialog/oauth',
			graphVersion: 'v22.0',
		});
		assert.equal('authUrl' in fields, false);
		assert.equal('state' in fields, false);
		assert.equal('clientId' in fields, false);
		assert.equal('code' in fields, false);
		assert.equal('scope' in fields, false);
		assert.equal(fields.hasAuthUrl, true);
		assert.equal(fields.hasState, true);
		assert.equal(fields.stateLength, 48);
		assert.equal(fields.hasClientId, true);
		assert.equal(fields.hasRedirectUri, true);
		assert.equal(fields.scopeCount, 1);
		assert.equal(JSON.stringify(fields).includes('nonce'), false);
	});
});

describe('Facebook OAuth callback error sanitization (P2-3)', () => {
	const GRAPH_LEAK = 'Invalid OAuth access token. Session has expired.';
	const TOKENISH = 'EAABsbCS0ABC.access_token.secret';

	it('never reflects Meta error_description or error= into facebook_error', () => {
		assert.equal(
			facebookOAuthProviderDeniedBrowserError(),
			FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
		);
		assert.equal(
			facebookOAuthProviderDeniedBrowserError({
				error: 'access_denied',
				errorDescription: 'The user denied your request. Visit https://evil.example',
			}),
			FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
		);
	});

	it('never reflects unexpected error.message into facebook_error', () => {
		assert.equal(
			facebookOAuthCallbackBrowserError({ message: GRAPH_LEAK, status: 502, errorCode: 'FACEBOOK_GRAPH_ERROR' }),
			FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
		);
		assert.equal(
			facebookOAuthCallbackBrowserError({ message: TOKENISH, status: 500 }),
			FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
		);
		assert.equal(
			facebookOAuthCallbackBrowserError({ message: 'Required field missing', status: 422 }),
			FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
		);
		assert.equal(
			facebookOAuthCallbackBrowserError(new Error(GRAPH_LEAK)),
			FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
		);
	});

	it('maps Graph/profile failures to the generic safe callback message', () => {
		const graph = Object.assign(new Error(GRAPH_LEAK), { status: 401, errorCode: 'FACEBOOK_GRAPH_ERROR' });
		assert.equal(facebookOAuthCallbackBrowserError(graph), FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE);
		assert.equal(
			facebookOAuthCallbackBrowserError({
				status: 400,
				message: FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
				errorCode: 'FACEBOOK_OAUTH_PROFILE_FAILED',
			}),
			FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
		);
	});

	it('preserves safe product-level 409 copy and rejects 409s with provider text', () => {
		assert.equal(
			facebookOAuthCallbackBrowserError({
				status: 409,
				message: FACEBOOK_OAUTH_ALREADY_CONNECTED_MESSAGE,
			}),
			FACEBOOK_OAUTH_ALREADY_CONNECTED_MESSAGE,
		);
		assert.equal(
			facebookOAuthCallbackBrowserError({
				status: 409,
				message: FACEBOOK_OAUTH_PROFILE_IN_USE_MESSAGE,
			}),
			FACEBOOK_OAUTH_PROFILE_IN_USE_MESSAGE,
		);
		assert.equal(
			facebookOAuthCallbackBrowserError({
				status: 409,
				message: GRAPH_LEAK,
			}),
			FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
		);
		assert.equal(
			facebookOAuthCallbackBrowserError({
				status: 502,
				message: FACEBOOK_OAUTH_ALREADY_CONNECTED_MESSAGE,
			}),
			FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
		);
	});

	it('uses a fixed safe page-sync warning', () => {
		assert.equal(
			FACEBOOK_OAUTH_PAGES_SYNC_WARNING_MESSAGE,
			'Some Facebook Pages could not be synced. You can retry from the Facebook hub.',
		);
		assert.equal(FACEBOOK_OAUTH_PAGES_SYNC_WARNING_MESSAGE.includes(GRAPH_LEAK), false);
	});

	it('callback and page-sync logs omit messages, tokens, codes, secrets, and state', () => {
		const log = facebookOAuthCallbackFailureLog({
			status: 502,
			errorCode: 'FACEBOOK_GRAPH_ERROR',
			message: `${GRAPH_LEAK} ${TOKENISH} code=AUTHCODE state=deadbeef`,
		});
		const serialized = JSON.stringify(log);
		assert.equal(log.status, 502);
		assert.equal(log.errorCode, 'FACEBOOK_GRAPH_ERROR');
		assert.equal(log.hasMessage, true);
		assert.equal('message' in log, false);
		assert.equal(serialized.includes(GRAPH_LEAK), false);
		assert.equal(serialized.includes(TOKENISH), false);
		assert.equal(serialized.includes('AUTHCODE'), false);
		assert.equal(serialized.includes('deadbeef'), false);
		assert.equal(serialized.includes('access_token'), false);

		const denied = facebookOAuthProviderDeniedLog({ hasError: true, hasErrorDescription: true });
		assert.deepEqual(denied, { hasError: true, hasErrorDescription: true });
		assert.equal(JSON.stringify(denied).includes('denied'), false);

		const pageLog = facebookOAuthPageSyncFailureLog({
			accountId: 'acc_1',
			error: { status: 401, errorCode: 'FACEBOOK_GRAPH_ERROR', message: GRAPH_LEAK },
		});
		assert.equal(pageLog.hasAccountId, true);
		assert.equal('message' in pageLog, false);
		assert.equal(JSON.stringify(pageLog).includes(GRAPH_LEAK), false);
	});
});

describe('Facebook queue workspace isolation (P2-5 / P2-7)', () => {
	const WS_B = 'workspace_b';
	const ACCOUNT = 'acc_1';
	const PAGE_ID = '123456789';

	function fixtureJob(overrides = {}) {
		return {
			id: 'job_1',
			owner: OWNER,
			workspace: WS_A,
			account: ACCOUNT,
			page_id: PAGE_ID,
			...overrides,
		};
	}

	function fixtureAccount(overrides = {}) {
		return {
			id: ACCOUNT,
			owner: OWNER,
			workspace: WS_A,
			connected: true,
			...overrides,
		};
	}

	function fixturePage(overrides = {}) {
		return {
			id: 'page_row_1',
			owner: OWNER,
			workspace: WS_A,
			account: ACCOUNT,
			page_id: PAGE_ID,
			...overrides,
		};
	}

	it('allows a WS-A job with a WS-A account and page', () => {
		const result = assertFacebookQueueWorkspaceIsolation({
			job: fixtureJob(),
			account: fixtureAccount(),
			page: fixturePage(),
		});
		assert.equal(result.workspaceId, WS_A);
		assert.equal(result.accountId, ACCOUNT);
		assert.equal(result.owner, OWNER);
		assert.equal(result.pageId, PAGE_ID);
	});

	it('rejects a missing job workspace', () => {
		assert.throws(
			() => assertFacebookQueueWorkspaceIsolation({
				job: fixtureJob({ workspace: '' }),
				account: fixtureAccount(),
				page: fixturePage(),
			}),
			(error) => error.status === 403
				&& error.retryable === false
				&& error.message === FACEBOOK_JOB_WORKSPACE_MISSING_MESSAGE,
		);
	});

	it('rejects a WS-A job with a WS-B account', () => {
		assert.throws(
			() => assertFacebookQueueWorkspaceIsolation({
				job: fixtureJob(),
				account: fixtureAccount({ workspace: WS_B }),
				page: fixturePage(),
			}),
			(error) => error.status === 422
				&& error.retryable === false
				&& error.message === FACEBOOK_QUEUE_ACCOUNT_NOT_CONNECTED_MESSAGE,
		);
	});

	it('rejects a mismatched account workspace or owner', () => {
		assert.throws(
			() => assertFacebookQueueWorkspaceIsolation({
				job: fixtureJob(),
				account: fixtureAccount({ owner: 'other_owner' }),
				page: fixturePage(),
			}),
			(error) => error.status === 422 && error.message === FACEBOOK_QUEUE_ACCOUNT_NOT_CONNECTED_MESSAGE,
		);
	});

	it('rejects a mismatched page workspace', () => {
		assert.throws(
			() => assertFacebookQueueWorkspaceIsolation({
				job: fixtureJob(),
				account: fixtureAccount(),
				page: fixturePage({ workspace: WS_B }),
			}),
			(error) => error.status === 404
				&& error.retryable === false
				&& error.message === FACEBOOK_QUEUE_PAGE_NOT_FOUND_MESSAGE,
		);
	});

	it('builds workspace-scoped page lookup params', () => {
		assert.deepEqual(
			buildFacebookQueuePageFilterParams({
				owner: OWNER,
				workspaceId: WS_A,
				accountId: ACCOUNT,
				pageId: PAGE_ID,
			}),
			{
				owner: OWNER,
				workspace: WS_A,
				account: ACCOUNT,
				pageId: PAGE_ID,
			},
		);
	});
});

describe('Facebook page sync workspace lookup (P2-6)', () => {
	const WS_B = 'workspace_b';
	const ACCOUNT = 'acc_1';
	const PAGE_ID = '123456789';

	function fixtureAccount(overrides = {}) {
		return {
			id: ACCOUNT,
			owner: OWNER,
			workspace: WS_A,
			connected: true,
			...overrides,
		};
	}

	function fixturePage(overrides = {}) {
		return {
			id: 'page_row_1',
			owner: OWNER,
			workspace: WS_A,
			account: ACCOUNT,
			page_id: PAGE_ID,
			name: 'Kitchen',
			...overrides,
		};
	}

	it('existing page lookup params include owner, workspace, and account', () => {
		assert.deepEqual(
			buildFacebookPageSyncExistingFilterParams({
				owner: OWNER,
				workspaceId: WS_A,
				accountId: ACCOUNT,
			}),
			{
				owner: OWNER,
				workspace: WS_A,
				account: ACCOUNT,
			},
		);
	});

	it('selects the matching workspace page by owner + workspace + account + page_id', () => {
		const existing = fixturePage();
		const selected = selectFacebookExistingPageInWorkspace([existing], {
			owner: OWNER,
			workspaceId: WS_A,
			accountId: ACCOUNT,
			pageId: PAGE_ID,
		});
		assert.equal(selected, existing);
	});

	it('does not select a Workspace-B page for a Workspace-A account', () => {
		const foreign = fixturePage({ id: 'page_row_b', workspace: WS_B });
		const selected = selectFacebookExistingPageInWorkspace([foreign], {
			owner: OWNER,
			workspaceId: WS_A,
			accountId: ACCOUNT,
			pageId: PAGE_ID,
		});
		assert.equal(selected, null);
	});

	it('fails closed when the account has no workspace', () => {
		assert.throws(
			() => assertFacebookAccountWorkspaceBound({
				owner: OWNER,
				account: fixtureAccount({ workspace: '' }),
			}),
			(error) => error.status === 404
				&& error.errorCode === 'FACEBOOK_ACCOUNT_WORKSPACE_REQUIRED'
				&& error.message === FACEBOOK_ACCOUNT_WORKSPACE_REQUIRED_MESSAGE,
		);
		assert.throws(
			() => assertFacebookAccountWorkspaceBound({
				owner: OWNER,
				account: fixtureAccount({ workspace: '  ' }),
			}),
			(error) => error.status === 404,
		);
	});

	it('updates the matching workspace page and treats a missing match as a create', () => {
		const existing = fixturePage();
		const updateTarget = selectFacebookExistingPageInWorkspace([existing], {
			owner: OWNER,
			workspaceId: WS_A,
			accountId: ACCOUNT,
			pageId: PAGE_ID,
		});
		assert.equal(updateTarget?.id, 'page_row_1');

		const createTarget = selectFacebookExistingPageInWorkspace([], {
			owner: OWNER,
			workspaceId: WS_A,
			accountId: ACCOUNT,
			pageId: PAGE_ID,
		});
		assert.equal(createTarget, null);
	});

	it('does not treat a foreign-workspace page as existing, so it is not updated or rebound', () => {
		const local = fixturePage();
		const foreign = fixturePage({ id: 'page_row_b', workspace: WS_B });
		const selected = selectFacebookExistingPageInWorkspace([foreign, local], {
			owner: OWNER,
			workspaceId: WS_A,
			accountId: ACCOUNT,
			pageId: PAGE_ID,
		});
		assert.equal(selected?.id, 'page_row_1');
		assert.equal(selected?.workspace, WS_A);

		const onlyForeign = selectFacebookExistingPageInWorkspace([foreign], {
			owner: OWNER,
			workspaceId: WS_A,
			accountId: ACCOUNT,
			pageId: PAGE_ID,
		});
		assert.equal(onlyForeign, null);
	});
});

describe('Facebook GET /accounts pageCount workspace isolation (FB-P0-1)', () => {
	const WS_B = 'workspace_b';
	const ACCOUNT = 'acc_ws_a';

	function fixturePage(overrides = {}) {
		return {
			id: 'page_row_1',
			owner: OWNER,
			workspace: WS_A,
			account: ACCOUNT,
			page_id: '111',
			...overrides,
		};
	}

	it('same owner, WS-A account: pageCount counts only WS-A pages', () => {
		const pages = [
			fixturePage({ id: 'p1', page_id: '1' }),
			fixturePage({ id: 'p2', page_id: '2' }),
			fixturePage({ id: 'p_b1', page_id: 'b1', workspace: WS_B }),
			fixturePage({ id: 'p_b2', page_id: 'b2', workspace: WS_B }),
		];
		assert.equal(
			countFacebookAccountPagesInWorkspace(pages, {
				owner: OWNER,
				workspaceId: WS_A,
				accountId: ACCOUNT,
			}),
			2,
		);
	});

	it('matching workspace page counts remain correct', () => {
		const pages = [
			fixturePage({ id: 'p1', page_id: '1' }),
			fixturePage({ id: 'p2', page_id: '2' }),
			fixturePage({ id: 'p3', page_id: '3' }),
		];
		assert.equal(
			countFacebookAccountPagesInWorkspace(pages, {
				owner: OWNER,
				workspaceId: WS_A,
				accountId: ACCOUNT,
			}),
			3,
		);
	});

	it('summary.totalPages is the sum of workspace-scoped pageCounts', () => {
		const wsAPages = [
			fixturePage({ id: 'p1' }),
			fixturePage({ id: 'p2' }),
			fixturePage({ id: 'p_b', workspace: WS_B }),
		];
		const items = [{
			id: ACCOUNT,
			status: 'connected',
			pageCount: countFacebookAccountPagesInWorkspace(wsAPages, {
				owner: OWNER,
				workspaceId: WS_A,
				accountId: ACCOUNT,
			}),
		}];
		const summary = buildFacebookAccountsSummary(items);
		assert.equal(summary.totalAccounts, 1);
		assert.equal(summary.totalPages, 2);
		assert.equal(summary.connectedAccounts, 1);
	});
});
