/**
 * P1 — WordPress publish job cancel safety (reject while publishing).
 * Run: node --test src/services/wordpress-publish.cancel.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createWordpressMutationAdapter } from './calendar/mutations/adapters/wordpress.js';
import { dispatchCalendarMutation } from './calendar/mutations/router.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const baseJob = {
	id: 'job_1',
	owner: 'user_1',
	status: 'scheduled',
	scheduled_at: '2026-07-18T12:00:00.000Z',
	timezone: 'UTC',
	title: 'WP post',
};

function createPublishJobStore(initialJob = baseJob) {
	const jobs = new Map([[initialJob.id, { ...initialJob }]]);
	return {
		jobs,
		getJob: (id) => jobs.get(id),
	};
}

function createAdapter(store) {
	return createWordpressMutationAdapter({
		getOwner: (req) => req.pocketbaseUserId,
		getJob: async (id) => (store.getJob(id) ? { ...store.getJob(id) } : null),
		updateJob: async (id, payload) => {
			const current = store.getJob(id);
			store.jobs.set(id, { ...current, ...payload, id });
			return { ...store.jobs.get(id) };
		},
		sanitize: async ({ payload }) => payload,
		resolveScheduledAtUtc: ({ scheduledAt }) => new Date(scheduledAt).toISOString(),
	});
}

function assertPublishingCancelRejected(run) {
	return assert.rejects(
		run,
		(err) => err.status === 409
			&& err.errorCode === 'JOB_PUBLISHING'
			&& err.message === 'Job is already publishing and cannot be cancelled',
	);
}

function readCancelPublishJobBlock() {
	const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
	return source.slice(
		source.indexOf('export async function cancelPublishJob'),
		source.indexOf('export async function listPublishHistory'),
	);
}

function readAdapterCancelBlock() {
	const source = readFileSync(path.join(root, 'apps/api/src/services/calendar/mutations/adapters/wordpress.js'), 'utf8');
	return source.slice(
		source.indexOf('async cancel(req, refId)'),
		source.indexOf('async retry(req, refId)'),
	);
}

describe('wordpress publish cancel safety (P1)', () => {
	it('cancelPublishJob rejects publishing jobs with JOB_PUBLISHING (source)', () => {
		const block = readCancelPublishJobBlock();
		assert.match(block, /job\.status === 'publishing'/);
		assert.match(block, /httpError\(409, 'Job is already publishing and cannot be cancelled', 'JOB_PUBLISHING'\)/);
	});

	it('cancelPublishJob preserves scheduled/queued/failed cancellation and terminal rejects (source)', () => {
		const block = readCancelPublishJobBlock();
		assert.match(block, /status: 'cancelled'/);
		assert.match(block, /last_error: 'Cancelled by user'/);
		assert.match(block, /if \(\['published', 'cancelled'\]\.includes\(job\.status\)\)/);
		assert.match(block, /httpError\(400, 'Job cannot be cancelled', 'INVALID_STATUS'\)/);
		assert.doesNotMatch(block, /if \(!\['scheduled', 'queued', 'failed'\]/);
	});

	it('wordpress calendar adapter rejects publishing jobs with JOB_PUBLISHING (source)', () => {
		const block = readAdapterCancelBlock();
		assert.match(block, /job\.status === 'publishing'/);
		assert.match(block, /freezeError\(409, 'Job is already publishing and cannot be cancelled', 'JOB_PUBLISHING'\)/);
	});

	it('wordpress calendar adapter cancels scheduled, queued, and failed jobs', async () => {
		const req = { pocketbaseUserId: 'user_1' };
		const options = { assertCapability: () => {} };

		for (const status of ['scheduled', 'queued', 'failed']) {
			const store = createPublishJobStore({ ...baseJob, status });
			const adapter = createAdapter(store);
			const result = await dispatchCalendarMutation(
				req,
				{ eventId: 'wordpress:job_1', action: 'cancel', payload: {} },
				{ ...options, adapters: [adapter] },
			);
			assert.equal(result.action, 'cancel');
			assert.equal(store.getJob('job_1').status, 'cancelled');
		}
	});

	it('wordpress calendar adapter rejects publishing jobs with 409 JOB_PUBLISHING', async () => {
		const store = createPublishJobStore({ ...baseJob, status: 'publishing' });
		const adapter = createAdapter(store);
		const req = { pocketbaseUserId: 'user_1' };

		await assertPublishingCancelRejected(() => dispatchCalendarMutation(
			req,
			{ eventId: 'wordpress:job_1', action: 'cancel', payload: {} },
			{ adapters: [adapter], assertCapability: () => {} },
		));
		assert.equal(store.getJob('job_1').status, 'publishing');
	});

	it('wordpress calendar adapter rejects published and cancelled jobs with INVALID_STATUS', async () => {
		const req = { pocketbaseUserId: 'user_1' };
		const options = { assertCapability: () => {} };

		for (const status of ['published', 'cancelled']) {
			const store = createPublishJobStore({ ...baseJob, status });
			const adapter = createAdapter(store);
			await assert.rejects(
				() => dispatchCalendarMutation(
					req,
					{ eventId: 'wordpress:job_1', action: 'cancel', payload: {} },
					{ ...options, adapters: [adapter] },
				),
				(err) => err.status === 400 && err.errorCode === 'INVALID_STATUS',
			);
		}
	});
});
