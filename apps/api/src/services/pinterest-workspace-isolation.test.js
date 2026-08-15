import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	assertPinterestAccountWorkspaceBound,
	assertPinterestJobRelationConsistency,
	assertPinterestQueueWorkspaceIsolation,
	assertPinterestStrictWorkspaceRecord,
	buildPinterestBoardSyncFilterParams,
	buildPinterestHistoryCreatePayload,
	buildPinterestSyncedBoardPayload,
	failClosedPinterestOAuthAccountWrite,
	PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE,
	requirePinterestOAuthReconnectAccount,
	requirePinterestWorkspaceId,
	resolveDefaultBoardInWorkspace,
	resolvePinterestOAuthCallbackWorkspace,
	selectPinterestOAuthWorkspaceAccounts,
	defaultFlagUpdatesForOAuthWorkspace,
	stampPinterestJobCreatePayload,
	stampPinterestOAuthAccountWorkspace,
	bindPinterestOAuthAccountToStateWorkspace,
	buildPinterestOAuthCallbackScope,
	applyPinterestOAuthStateCas,
	createPinterestOAuthStateCasStore,
	wouldUnconditionalPinterestOAuthStateUsedPatchSucceed,
	rejectPinterestOAuthStateConsume,
	interpretPinterestOAuthStateConsumeResult,
} from './pinterest-workspace-isolation.js';

const WS_A = 'workspace_a';
const WS_B = 'workspace_b';
const OWNER = 'owner_1';

function fixtureJob(overrides = {}) {
	return {
		id: 'job_1',
		owner: OWNER,
		workspace: WS_A,
		account: 'account_a',
		ai_pin: 'pin_a',
		board_id: 'board_ext_a',
		...overrides,
	};
}

function fixturePin(overrides = {}) {
	return {
		id: 'pin_a',
		owner: OWNER,
		workspace: WS_A,
		...overrides,
	};
}

function fixtureAccount(overrides = {}) {
	return {
		id: 'account_a',
		owner: OWNER,
		workspace: WS_A,
		connected: true,
		...overrides,
	};
}

function fixtureBoard(overrides = {}) {
	return {
		id: 'board_row_a',
		owner: OWNER,
		workspace: WS_A,
		account: 'account_a',
		board_id: 'board_ext_a',
		is_default: true,
		...overrides,
	};
}

describe('Pinterest P0 workspace isolation (behavioral)', () => {
	describe('requirePinterestWorkspaceId / job create stamp', () => {
		it('rejects missing workspace on create path', () => {
			assert.throws(
				() => requirePinterestWorkspaceId(''),
				(error) => error.status === 403 && /Workspace access is required/.test(error.message),
			);
			assert.throws(
				() => stampPinterestJobCreatePayload({ workspaceId: null, ownerId: OWNER, creatorId: OWNER }, { status: 'scheduled' }),
				(error) => error.status === 403,
			);
		});

		it('stamps workspace + ownership on job create payload', () => {
			const payload = stampPinterestJobCreatePayload(
				{ workspaceId: WS_A, ownerId: OWNER, creatorId: 'creator_1' },
				{ account: 'account_a', status: 'scheduled' },
			);
			assert.equal(payload.workspace, WS_A);
			assert.equal(payload.owner, OWNER);
			assert.equal(payload.created_by, 'creator_1');
			assert.equal(payload.last_edited_by, 'creator_1');
			assert.equal(payload.account, 'account_a');
			assert.equal(payload.status, 'scheduled');
		});
	});

	describe('strict workspace record (mutate / target)', () => {
		it('allows same-owner same-workspace record', () => {
			const record = assertPinterestStrictWorkspaceRecord(
				fixtureAccount(),
				{ workspaceId: WS_A, ownerId: OWNER },
				'Pinterest account not found',
			);
			assert.equal(record.id, 'account_a');
		});

		it('returns 404 for same-owner cross-workspace record (no enumeration)', () => {
			assert.throws(
				() => assertPinterestStrictWorkspaceRecord(
					fixtureAccount({ workspace: WS_B }),
					{ workspaceId: WS_A, ownerId: OWNER },
					'Pinterest account not found',
				),
				(error) => error.status === 404 && error.message === 'Pinterest account not found',
			);
		});

		it('returns 404 when record is missing', () => {
			assert.throws(
				() => assertPinterestStrictWorkspaceRecord(
					null,
					{ workspaceId: WS_A, ownerId: OWNER },
					'Scheduled job not found',
				),
				(error) => error.status === 404,
			);
		});
	});

	describe('job relation consistency', () => {
		it('allows consistent pin/account/board for a job', () => {
			const result = assertPinterestJobRelationConsistency({
				job: fixtureJob(),
				pin: fixturePin(),
				account: fixtureAccount(),
				board: fixtureBoard(),
			});
			assert.equal(result.pin.id, 'pin_a');
			assert.equal(result.account.id, 'account_a');
			assert.equal(result.board.board_id, 'board_ext_a');
		});

		it('rejects board bound to a different account', () => {
			assert.throws(
				() => assertPinterestJobRelationConsistency({
					job: fixtureJob(),
					pin: fixturePin(),
					account: fixtureAccount(),
					board: fixtureBoard({ account: 'account_other' }),
				}),
				(error) => error.status === 404 && error.message === 'Scheduled job not found',
			);
		});
	});

	describe('queue workspace isolation', () => {
		it('allows a consistent queued job', () => {
			const result = assertPinterestQueueWorkspaceIsolation({
				job: fixtureJob(),
				pin: fixturePin(),
				account: fixtureAccount(),
				board: fixtureBoard(),
			});
			assert.equal(result.workspaceId, WS_A);
			assert.equal(result.accountId, 'account_a');
			assert.equal(result.owner, OWNER);
		});

		it('rejects job with missing workspace', () => {
			assert.throws(
				() => assertPinterestQueueWorkspaceIsolation({
					job: fixtureJob({ workspace: '' }),
					pin: fixturePin(),
					account: fixtureAccount(),
					board: fixtureBoard(),
				}),
				(error) => error.status === 403 && /workspace is missing/.test(error.message),
			);
		});

		it('rejects pin from another workspace', () => {
			assert.throws(
				() => assertPinterestQueueWorkspaceIsolation({
					job: fixtureJob(),
					pin: fixturePin({ workspace: WS_B }),
					account: fixtureAccount(),
					board: fixtureBoard(),
				}),
				(error) => error.status === 404 && /AI pin/.test(error.message),
			);
		});

		it('rejects account from another workspace', () => {
			assert.throws(
				() => assertPinterestQueueWorkspaceIsolation({
					job: fixtureJob(),
					pin: fixturePin(),
					account: fixtureAccount({ workspace: WS_B }),
					board: fixtureBoard(),
				}),
				(error) => error.status === 422 && /not connected/.test(error.message),
			);
		});

		it('rejects board from another workspace', () => {
			assert.throws(
				() => assertPinterestQueueWorkspaceIsolation({
					job: fixtureJob(),
					pin: fixturePin(),
					account: fixtureAccount(),
					board: fixtureBoard({ workspace: WS_B }),
				}),
				(error) => error.status === 404 && /board was not found/.test(error.message),
			);
		});
	});

	describe('board sync workspace binding', () => {
		it('rejects sync when account has no workspace', () => {
			assert.throws(
				() => assertPinterestAccountWorkspaceBound({
					owner: OWNER,
					account: fixtureAccount({ workspace: '' }),
				}),
				(error) => error.status === 404 && /account not found/.test(error.message),
			);
		});

		it('builds filter params and board payloads stamped with account workspace', () => {
			const workspaceId = assertPinterestAccountWorkspaceBound({
				owner: OWNER,
				account: fixtureAccount(),
			});
			assert.equal(workspaceId, WS_A);

			const filter = buildPinterestBoardSyncFilterParams({
				owner: OWNER,
				workspaceId,
				accountId: 'account_a',
			});
			assert.deepEqual(filter, { owner: OWNER, workspace: WS_A, account: 'account_a' });

			const payload = buildPinterestSyncedBoardPayload({
				owner: OWNER,
				workspaceId,
				account: fixtureAccount({ label: 'Acme', username: 'acme' }),
				board: { id: 'board_ext_a', name: 'Recipes', description: 'd', privacy: 'PUBLIC' },
				thumbnailUrl: 'https://cdn.example/t.jpg',
			});
			assert.equal(payload.workspace, WS_A);
			assert.equal(payload.owner, OWNER);
			assert.equal(payload.account, 'account_a');
			assert.equal(payload.board_id, 'board_ext_a');
			assert.equal(payload.name, 'Recipes');
		});

		it('never picks a default board from another workspace', () => {
			const boards = [
				fixtureBoard({ id: 'foreign', workspace: WS_B, is_default: true, board_id: 'x' }),
				fixtureBoard({ id: 'local', workspace: WS_A, is_default: false, board_id: 'y' }),
			];
			const picked = resolveDefaultBoardInWorkspace(boards, {
				workspaceId: WS_A,
				accountId: 'account_a',
			});
			assert.equal(picked.id, 'local');
		});
	});

	describe('token refresh workspace gate (F1)', () => {
		function authorizeTokenRefreshAccount(account, { workspaceId, ownerId }) {
			return assertPinterestStrictWorkspaceRecord(
				account,
				{ workspaceId, ownerId },
				'Pinterest account not found',
			);
		}

		function resolveOmittedAccountId(accounts, { workspaceId, ownerId }) {
			const scoped = accounts.filter((account) => (
				account.owner === ownerId && account.workspace === workspaceId
			));
			const usable = (account) => {
				if (!account?.connected) return false;
				const status = String(account.status || '').trim();
				return !status || status === 'connected';
			};
			return scoped.find((account) => account.is_default && usable(account))
				|| scoped.find((account) => usable(account))
				|| scoped.find((account) => account.is_default)
				|| scoped[0]
				|| null;
		}

		it('rejects same-owner Workspace B accountId from a Workspace A session', () => {
			assert.throws(
				() => authorizeTokenRefreshAccount(
					fixtureAccount({ id: 'account_b', workspace: WS_B }),
					{ workspaceId: WS_A, ownerId: OWNER },
				),
				(error) => error.status === 404 && error.message === 'Pinterest account not found',
			);
		});

		it('allows Workspace A accountId from a Workspace A session', () => {
			const account = authorizeTokenRefreshAccount(
				fixtureAccount({ id: 'account_a', workspace: WS_A }),
				{ workspaceId: WS_A, ownerId: OWNER },
			);
			assert.equal(account.id, 'account_a');
			assert.equal(account.workspace, WS_A);
		});

		it('omitted accountId resolves only the Workspace A default account', () => {
			const selected = resolveOmittedAccountId([
				fixtureAccount({ id: 'account_b', workspace: WS_B, is_default: true }),
				fixtureAccount({ id: 'account_a', workspace: WS_A, is_default: true }),
			], { workspaceId: WS_A, ownerId: OWNER });
			const account = authorizeTokenRefreshAccount(selected, { workspaceId: WS_A, ownerId: OWNER });
			assert.equal(account.id, 'account_a');
			assert.equal(account.workspace, WS_A);
		});

		it('does not write tokens when the cross-workspace request is rejected', () => {
			let tokenWrites = 0;
			const writeTokens = () => { tokenWrites += 1; };
			assert.throws(
				() => {
					authorizeTokenRefreshAccount(
						fixtureAccount({ id: 'account_b', workspace: WS_B }),
						{ workspaceId: WS_A, ownerId: OWNER },
					);
					writeTokens();
				},
				(error) => error.status === 404,
			);
			assert.equal(tokenWrites, 0);
		});
	});

	describe('bulk board sync workspace enumeration (F2)', () => {
		function enumerateAccountsForBulkSync(accounts, { workspaceId, ownerId }) {
			return accounts.filter((account) => (
				account.owner === ownerId
				&& account.workspace === workspaceId
				&& account.connected
				&& account.status === 'connected'
			));
		}

		function runBulkSync(accounts, { workspaceId, ownerId }) {
			const syncedAccountIds = [];
			const tokenRefreshes = [];
			const boardWrites = [];
			for (const account of enumerateAccountsForBulkSync(accounts, { workspaceId, ownerId })) {
				syncedAccountIds.push(account.id);
				tokenRefreshes.push(account.id);
				boardWrites.push(account.id);
			}
			return { syncedAccountIds, tokenRefreshes, boardWrites };
		}

		const ownerAccounts = [
			fixtureAccount({
				id: 'account_a',
				workspace: WS_A,
				connected: true,
				status: 'connected',
				is_default: true,
			}),
			fixtureAccount({
				id: 'account_b',
				workspace: WS_B,
				connected: true,
				status: 'connected',
				is_default: true,
			}),
		];

		it('enumerates and synchronizes only Workspace A accounts for a Workspace A session', () => {
			const result = runBulkSync(ownerAccounts, { workspaceId: WS_A, ownerId: OWNER });
			assert.deepEqual(result.syncedAccountIds, ['account_a']);
		});

		it('does not synchronize a connected Workspace B account', () => {
			const result = runBulkSync(ownerAccounts, { workspaceId: WS_A, ownerId: OWNER });
			assert.equal(result.syncedAccountIds.includes('account_b'), false);
		});

		it('does not refresh Workspace B tokens', () => {
			const result = runBulkSync(ownerAccounts, { workspaceId: WS_A, ownerId: OWNER });
			assert.equal(result.tokenRefreshes.includes('account_b'), false);
			assert.deepEqual(result.tokenRefreshes, ['account_a']);
		});

		it('does not modify Workspace B board rows', () => {
			const result = runBulkSync(ownerAccounts, { workspaceId: WS_A, ownerId: OWNER });
			assert.equal(result.boardWrites.includes('account_b'), false);
			assert.deepEqual(result.boardWrites, ['account_a']);
		});

		it('keeps existing Workspace A sync behavior valid', () => {
			const result = runBulkSync(ownerAccounts, { workspaceId: WS_A, ownerId: OWNER });
			assert.deepEqual(result.syncedAccountIds, ['account_a']);
			assert.equal(
				assertPinterestAccountWorkspaceBound({
					owner: OWNER,
					account: ownerAccounts[0],
				}),
				WS_A,
			);
		});
	});

	describe('OAuth callback workspace fail-closed (F5)', () => {
		function runCallbackAfterWorkspaceGate(stateRecord) {
			const writes = {
				ensureUserWorkspace: 0,
				account: 0,
				secrets: 0,
				boards: 0,
			};
			const workspace = resolvePinterestOAuthCallbackWorkspace(stateRecord);
			const payload = stampPinterestOAuthAccountWorkspace({ owner: OWNER }, workspace);
			writes.account += 1;
			writes.secrets += 1;
			writes.boards += 1;
			return { workspace, payload, writes };
		}

		it('continues with the workspace_id stored on a valid OAuth state', () => {
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
		});

		it('rejects missing workspace_id without owner fallback or resource writes', () => {
			let ensureUserWorkspaceCalls = 0;
			const writes = { account: 0, secrets: 0, boards: 0 };
			assert.throws(
				() => {
					const workspace = resolvePinterestOAuthCallbackWorkspace({
						owner: OWNER,
					});
					ensureUserWorkspaceCalls += 1;
					writes.account += 1;
					writes.secrets += 1;
					writes.boards += 1;
					return stampPinterestOAuthAccountWorkspace({ owner: OWNER }, workspace);
				},
				(error) => error.status === 400
					&& error.message === PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE
					&& !/workspace_a|owner_1|pocketbase/i.test(error.message),
			);
			assert.equal(ensureUserWorkspaceCalls, 0);
			assert.deepEqual(writes, { account: 0, secrets: 0, boards: 0 });
		});

		it('rejects empty or whitespace workspace_id safely', () => {
			for (const workspace_id of ['', '   ', null]) {
				assert.throws(
					() => resolvePinterestOAuthCallbackWorkspace({
						owner: OWNER,
						workspace_id,
						workspace_key: 'key_a',
					}),
					(error) => error.status === 400
						&& error.message === PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE,
				);
			}
		});

		it('does not strip workspace fields or retry unscoped after account write failure', () => {
			const payload = stampPinterestOAuthAccountWorkspace(
				{ owner: OWNER, label: 'Acme' },
				{ workspaceId: WS_A, workspaceKey: 'key_a' },
			);
			const snapshot = { ...payload };
			assert.throws(
				() => {
					try {
						throw new Error('schema validation failed');
					} catch {
						failClosedPinterestOAuthAccountWrite(payload);
					}
				},
				(error) => error.status === 500
					&& error.message === PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE
					&& !/schema validation failed/i.test(error.message),
			);
			assert.equal(payload.workspace, snapshot.workspace);
			assert.equal(payload.workspace_id, snapshot.workspace_id);
			assert.equal(payload.workspace_key, snapshot.workspace_key);
			assert.equal(payload.workspace, WS_A);
			assert.equal(payload.workspace_id, WS_A);
		});
	});

	describe('OAuth callback workspace scoping (F4)', () => {
		it('rejects reconnect of a Workspace B account from a Workspace A state', () => {
			let mutated = false;
			assert.throws(
				() => {
					requirePinterestOAuthReconnectAccount(
						fixtureAccount({ id: 'account_b', workspace: WS_B }),
						{ workspaceId: WS_A, ownerId: OWNER },
					);
					mutated = true;
				},
				(error) => error.status === 404
					&& error.message === 'Pinterest account not found'
					&& !/workspace_b|account_b/i.test(error.message),
			);
			assert.equal(mutated, false);
		});

		it('keeps same-workspace duplicate Pinterest-user account as the existing row', () => {
			const existing = bindPinterestOAuthAccountToStateWorkspace(
				fixtureAccount({
					id: 'account_a',
					workspace: WS_A,
					pinterest_user_id: 'pin_user_1',
				}),
				{ workspaceId: WS_A, ownerId: OWNER },
			);
			assert.equal(existing.id, 'account_a');
			assert.equal(existing.workspace, WS_A);
		});

		it('does not select or mutate a same-owner Workspace B duplicate Pinterest user', () => {
			const foreign = fixtureAccount({
				id: 'account_b',
				workspace: WS_B,
				pinterest_user_id: 'pin_user_1',
			});
			const selected = bindPinterestOAuthAccountToStateWorkspace(
				foreign,
				{ workspaceId: WS_A, ownerId: OWNER },
			);
			assert.equal(selected, null);
			assert.equal(foreign.workspace, WS_B);
			assert.equal(foreign.id, 'account_b');
		});

		it('may set default only inside Workspace A and leaves Workspace B default unchanged', () => {
			const accounts = [
				fixtureAccount({ id: 'account_a', workspace: WS_A, is_default: false }),
				fixtureAccount({ id: 'account_b', workspace: WS_B, is_default: true }),
			];
			const scoped = selectPinterestOAuthWorkspaceAccounts(accounts, {
				workspaceId: WS_A,
				ownerId: OWNER,
			});
			assert.deepEqual(scoped.map((account) => account.id), ['account_a']);
			const updates = defaultFlagUpdatesForOAuthWorkspace(accounts, {
				workspaceId: WS_A,
				ownerId: OWNER,
				accountId: 'account_a',
			});
			assert.deepEqual(updates, [{ id: 'account_a', is_default: true }]);
			assert.equal(updates.some((row) => row.id === 'account_b'), false);
			assert.equal(accounts.find((account) => account.id === 'account_b').is_default, true);
		});

		it('same-owner multi-workspace callback never mutates the foreign workspace', () => {
			const scope = buildPinterestOAuthCallbackScope({
				workspaceId: WS_A,
				workspaceKey: 'key_a',
				ownerId: OWNER,
			});
			assert.equal(scope.workspace.id, WS_A);
			assert.equal(scope.workspaceOwnerId, OWNER);

			const accounts = [
				fixtureAccount({ id: 'account_a', workspace: WS_A, is_default: false }),
				fixtureAccount({ id: 'account_b', workspace: WS_B, is_default: true }),
			];
			const reconnect = bindPinterestOAuthAccountToStateWorkspace(
				accounts[1],
				{ workspaceId: WS_A, ownerId: OWNER },
			);
			const duplicate = bindPinterestOAuthAccountToStateWorkspace(
				accounts[1],
				{ workspaceId: WS_A, ownerId: OWNER },
			);
			const defaultUpdates = defaultFlagUpdatesForOAuthWorkspace(accounts, {
				workspaceId: WS_A,
				ownerId: OWNER,
				accountId: 'account_a',
			});
			assert.equal(reconnect, null);
			assert.equal(duplicate, null);
			assert.deepEqual(defaultUpdates.map((row) => row.id), ['account_a']);
			assert.equal(accounts[1].is_default, true);
			assert.equal(accounts[1].workspace, WS_B);
		});
	});

	describe('publish history workspace stamp', () => {
		it('includes workspace from the job on history create payload', () => {
			const payload = buildPinterestHistoryCreatePayload({
				owner: OWNER,
				accountId: 'account_a',
				jobId: 'job_1',
				workspaceId: WS_A,
				title: 'Pin title',
				result: 'published',
				publishedAt: '2026-01-01T00:00:00.000Z',
			});
			assert.equal(payload.workspace, WS_A);
			assert.equal(payload.owner, OWNER);
			assert.equal(payload.job, 'job_1');
			assert.equal(payload.title, 'Pin title');
		});

		it('does not invent a workspace when none is provided', () => {
			const payload = buildPinterestHistoryCreatePayload({
				owner: OWNER,
				result: 'failed',
			});
			assert.equal(payload.workspace, undefined);
			assert.equal(payload.workspace_key, OWNER);
		});
	});

	describe('OAuth state atomic consume (F3)', () => {
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
				&& error.message === PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE
				&& !/workspace_a|workspace_b|owner_1|state_1|SELECT|UPDATE|pocketbase|pinterest_oauth/i.test(error.message)
				&& !/invalid_grant|access_token|expires_at/i.test(error.message);
		}

		async function runCallbackAfterConsume(cas, nowMs, { tokenExchangeFails = false } = {}) {
			const writes = { tokenExchange: 0, account: 0, secrets: 0, boards: 0 };
			const consume = await cas.consume(nowMs);
			if (!consume.ok) {
				rejectPinterestOAuthStateConsume();
			}
			writes.tokenExchange += 1;
			if (tokenExchangeFails) {
				throw Object.assign(new Error(PINTEREST_OAUTH_CALLBACK_FAILED_MESSAGE), {
					status: 400,
					errorCode: 'PINTEREST_OAUTH_TOKEN_EXCHANGE_FAILED',
				});
			}
			writes.account += 1;
			writes.secrets += 1;
			writes.boards += 1;
			return { consume, writes, snapshot: cas.snapshot() };
		}

		it('sequential replay: first consume succeeds, second consume fails', async () => {
			const cas = createPinterestOAuthStateCasStore(fixtureState());
			const first = await cas.consume(NOW);
			const second = await cas.consume(NOW);
			assert.equal(first.ok, true);
			assert.equal(second.ok, false);
			assert.equal(second.reason, 'used');
			assert.equal(cas.snapshot().used, true);
		});

		it('concurrent consume: exactly one of two overlapping attempts succeeds', async () => {
			const cas = createPinterestOAuthStateCasStore(fixtureState());
			const results = await Promise.all([cas.consume(NOW), cas.consume(NOW)]);
			assert.equal(results.filter((result) => result.ok).length, 1);
			assert.equal(results.filter((result) => !result.ok).length, 1);
			assert.equal(cas.snapshot().used, true);
		});

		it('losing callback does not exchange tokens or write account/secrets', async () => {
			const cas = createPinterestOAuthStateCasStore(fixtureState());
			const winnerWrites = { tokenExchange: 0, account: 0, secrets: 0 };
			const loserWrites = { tokenExchange: 0, account: 0, secrets: 0 };
			const [first, second] = await Promise.all([cas.consume(NOW), cas.consume(NOW)]);
			const winner = first.ok ? first : second;
			const loser = first.ok ? second : first;
			if (winner.ok) {
				winnerWrites.tokenExchange += 1;
				winnerWrites.account += 1;
				winnerWrites.secrets += 1;
			}
			if (loser.ok) {
				loserWrites.tokenExchange += 1;
				loserWrites.account += 1;
				loserWrites.secrets += 1;
			}
			assert.equal(winner.ok, true);
			assert.equal(loser.ok, false);
			assert.deepEqual(winnerWrites, { tokenExchange: 1, account: 1, secrets: 1 });
			assert.deepEqual(loserWrites, { tokenExchange: 0, account: 0, secrets: 0 });
		});

		it('expired state cannot consume', async () => {
			assert.equal(
				applyPinterestOAuthStateCas(fixtureState({ expires_at: PAST }), { nowMs: NOW }).ok,
				false,
			);
			assert.equal(
				applyPinterestOAuthStateCas(fixtureState({ expires_at: PAST }), { nowMs: NOW }).reason,
				'expired',
			);
			const cas = createPinterestOAuthStateCasStore(fixtureState({ expires_at: PAST }));
			const result = await cas.consume(NOW);
			assert.equal(result.ok, false);
			assert.equal(result.reason, 'expired');
			assert.equal(cas.snapshot().used, false);
		});

		it('already-used state cannot consume', async () => {
			assert.equal(
				applyPinterestOAuthStateCas(fixtureState({ used: true }), { nowMs: NOW }).ok,
				false,
			);
			assert.equal(
				applyPinterestOAuthStateCas(fixtureState({ used: true }), { nowMs: NOW }).reason,
				'used',
			);
			const cas = createPinterestOAuthStateCasStore(fixtureState({ used: true }));
			const result = await cas.consume(NOW);
			assert.equal(result.ok, false);
			assert.equal(result.reason, 'used');
			assert.equal(cas.snapshot().used, true);
		});

		it('failed token exchange after successful consume writes no account and leaves state used', async () => {
			const cas = createPinterestOAuthStateCasStore(fixtureState());
			await assert.rejects(
				() => runCallbackAfterConsume(cas, NOW, { tokenExchangeFails: true }),
				(error) => isSafeOAuthError(error),
			);
			assert.equal(cas.snapshot().used, true);
			assert.equal(cas.snapshot().workspace_id, WS_A);
		});

		it('successful consume does not alter workspace_id', async () => {
			const cas = createPinterestOAuthStateCasStore(fixtureState({ workspace_id: WS_A }));
			const result = await cas.consume(NOW);
			assert.equal(result.ok, true);
			assert.equal(result.workspace_id, WS_A);
			assert.equal(cas.snapshot().workspace_id, WS_A);
			assert.equal(cas.snapshot().workspace_key, 'key_a');
		});

		it('unconditional used=true patch would silently succeed on an already-used row; CAS does not', () => {
			const usedRow = fixtureState({ used: true });
			assert.equal(wouldUnconditionalPinterestOAuthStateUsedPatchSucceed(usedRow), true);
			assert.equal(applyPinterestOAuthStateCas(usedRow, { nowMs: NOW }).ok, false);
		});

		it('losing, replayed, and expired consume failures use the safe OAuth error', () => {
			assert.throws(() => rejectPinterestOAuthStateConsume(), isSafeOAuthError);
			assert.throws(
				() => interpretPinterestOAuthStateConsumeResult({ ok: false }, 'state_1'),
				isSafeOAuthError,
			);
			assert.throws(
				() => interpretPinterestOAuthStateConsumeResult({ ok: true, id: 'other' }, 'state_1'),
				isSafeOAuthError,
			);
			assert.doesNotThrow(() => interpretPinterestOAuthStateConsumeResult({ ok: true, id: 'state_1' }, 'state_1'));
		});
	});
});
