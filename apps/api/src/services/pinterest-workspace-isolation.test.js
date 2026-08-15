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
	requirePinterestWorkspaceId,
	resolveDefaultBoardInWorkspace,
	stampPinterestJobCreatePayload,
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
});
