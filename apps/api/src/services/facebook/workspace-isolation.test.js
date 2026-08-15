import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	applyFacebookOAuthStateCas,
	bindFacebookOAuthAccountToStateWorkspace,
	buildFacebookOAuthCallbackScope,
	createFacebookOAuthStateCasStore,
	defaultFlagUpdatesForFacebookOAuthWorkspace,
	failClosedFacebookOAuthAccountWrite,
	FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
	interpretFacebookOAuthStateConsumeResult,
	rejectFacebookOAuthStateConsume,
	requireFacebookOAuthReconnectAccount,
	resolveFacebookOAuthCallbackWorkspace,
	selectFacebookOAuthWorkspaceAccounts,
	stampFacebookOAuthAccountWorkspace,
	wouldUnconditionalFacebookOAuthStateUsedPatchSucceed,
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
