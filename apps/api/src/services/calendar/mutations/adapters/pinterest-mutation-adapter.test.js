import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPinterestMutationAdapter } from './pinterest.js';

function adapterFor(job) {
	return createPinterestMutationAdapter({
		getOwner: (req) => req.workspaceOwnerId,
		getJob: async () => job,
		updateJob: async (_id, payload) => ({ ...job, ...payload }),
		sanitize: async ({ payload }) => payload,
		resolveScheduledAtUtc: ({ scheduledAt }) => scheduledAt,
		assertPinterestConnected: async () => ({ id: job.account, workspace: job.workspace }),
	});
}

describe('Pinterest calendar workspace isolation', () => {
	it('rejects a same-owner job from another workspace', async () => {
		const job = { id: 'job_b', owner: 'owner_1', workspace: 'workspace_b', status: 'scheduled', account: 'account_b' };
		const adapter = adapterFor(job);
		const req = { workspaceOwnerId: 'owner_1', workspace: { id: 'workspace_a' } };

		await assert.rejects(
			adapter.cancel(req, job.id),
			(error) => error.status === 404 && error.errorCode === 'NOT_FOUND',
		);
	});

	it('allows a job in the active workspace', async () => {
		const job = { id: 'job_a', owner: 'owner_1', workspace: 'workspace_a', status: 'scheduled', account: 'account_a' };
		const adapter = adapterFor(job);
		const req = { workspaceOwnerId: 'owner_1', workspace: { id: 'workspace_a' } };

		const result = await adapter.cancel(req, job.id);
		assert.equal(result.refId, 'job_a');
	});
});
