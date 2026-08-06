import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	syncAiPinForCancel,
	syncAiPinForReschedule,
	syncAiPinForRetry,
	syncAiPinForScheduledJob,
} from './pin-sync.js';
import { scheduleFacebookPublishJobs } from './schedule.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

function futureIso(msAhead = 120_000) {
	return new Date(Date.now() + msAhead).toISOString();
}

function createPinSyncStore(initialPin = null) {
	const pins = new Map();
	if (initialPin?.id) {
		pins.set(initialPin.id, { ...initialPin });
	}

	const pocketbaseClient = {
		collection: (name) => {
			if (name === 'ai_pins') {
				return {
					getOne: async (id) => {
						const row = pins.get(id);
						if (!row) throw new Error('not found');
						return { ...row };
					},
					update: async (id, payload) => {
						const current = pins.get(id);
						if (!current) throw new Error('not found');
						const next = { ...current, ...payload };
						pins.set(id, next);
						return { ...next };
					},
				};
			}
			throw new Error(`unexpected collection ${name}`);
		},
	};

	const deps = {
		pocketbaseClient,
		sanitizeCollectionPayload: async ({ payload }) => payload,
		recordBelongsToWorkspace: () => true,
	};

	const req = {
		workspaceOwnerId: 'user_1',
		pocketbaseUserId: 'user_1',
		workspaceId: 'ws_1',
	};

	return { pins, deps, req, getPin: (id) => pins.get(id) };
}

const baseJob = {
	id: 'job_1',
	owner: 'user_1',
	workspace: 'ws_1',
	ai_pin: 'pin_1',
	status: 'scheduled',
	scheduled_at: futureIso(3_600_000),
	timezone: 'UTC',
	scheduled_timezone: 'UTC',
};

const basePin = {
	id: 'pin_1',
	owner: 'user_1',
	workspace: 'ws_1',
	status: 'draft',
	scheduled_at: '',
	scheduled_timezone: '',
	publish_job_id: '',
};

describe('facebook F5-5 ai pin sync', () => {
	it('syncAiPinForScheduledJob marks pin scheduled with job linkage', async () => {
		const { deps, req, getPin } = createPinSyncStore(basePin);
		const result = await syncAiPinForScheduledJob(baseJob, { req, deps });

		assert.equal(result.skipped, false);
		assert.equal(getPin('pin_1').status, 'scheduled');
		assert.equal(getPin('pin_1').scheduled_at, baseJob.scheduled_at);
		assert.equal(getPin('pin_1').scheduled_timezone, 'UTC');
		assert.equal(getPin('pin_1').publish_job_id, 'job_1');
	});

	it('syncAiPinForReschedule updates schedule fields only', async () => {
		const { deps, req, getPin } = createPinSyncStore({
			...basePin,
			status: 'scheduled',
			scheduled_at: futureIso(1_800_000),
			scheduled_timezone: 'UTC',
			publish_job_id: 'job_1',
		});
		const nextAt = futureIso(7_200_000);

		await syncAiPinForReschedule({
			...baseJob,
			scheduled_at: nextAt,
			scheduled_timezone: 'Europe/Paris',
		}, { req, deps });

		assert.equal(getPin('pin_1').status, 'scheduled');
		assert.equal(getPin('pin_1').scheduled_at, nextAt);
		assert.equal(getPin('pin_1').scheduled_timezone, 'Europe/Paris');
		assert.equal(getPin('pin_1').publish_job_id, 'job_1');
	});

	it('syncAiPinForCancel restores draft and clears schedule linkage', async () => {
		const { deps, req, getPin } = createPinSyncStore({
			...basePin,
			status: 'scheduled',
			scheduled_at: baseJob.scheduled_at,
			scheduled_timezone: 'UTC',
			publish_job_id: 'job_1',
		});

		await syncAiPinForCancel(baseJob, { req, deps });

		assert.equal(getPin('pin_1').status, 'draft');
		assert.equal(getPin('pin_1').scheduled_at, '');
		assert.equal(getPin('pin_1').scheduled_timezone, '');
		assert.equal(getPin('pin_1').publish_job_id, '');
	});

	it('syncAiPinForRetry restores scheduled pin state', async () => {
		const { deps, req, getPin } = createPinSyncStore({
			...basePin,
			status: 'draft',
			publish_job_id: '',
		});

		const retryAt = futureIso(9_000_000);
		await syncAiPinForRetry({
			...baseJob,
			status: 'failed',
			scheduled_at: retryAt,
		}, { req, deps });

		assert.equal(getPin('pin_1').status, 'scheduled');
		assert.equal(getPin('pin_1').scheduled_at, retryAt);
		assert.equal(getPin('pin_1').publish_job_id, 'job_1');
	});

	it('no-ops when ai pin id is missing', async () => {
		const { deps, req } = createPinSyncStore(basePin);
		const result = await syncAiPinForScheduledJob({ ...baseJob, ai_pin: '' }, { req, deps });
		assert.equal(result.skipped, true);
		assert.equal(result.reason, 'no_ai_pin');
	});

	it('no-ops when ai pin record is missing', async () => {
		const { deps, req } = createPinSyncStore();
		const result = await syncAiPinForCancel(baseJob, { req, deps });
		assert.equal(result.skipped, true);
		assert.equal(result.reason, 'pin_not_found');
	});

	it('skips sync on workspace mismatch', async () => {
		const { deps, req } = createPinSyncStore(basePin);
		const result = await syncAiPinForScheduledJob(baseJob, {
			req,
			deps: {
				...deps,
				recordBelongsToWorkspace: () => false,
			},
		});
		assert.equal(result.skipped, true);
		assert.equal(result.reason, 'workspace_mismatch');
	});

	it('skips sync on owner mismatch', async () => {
		const { deps, req } = createPinSyncStore({ ...basePin, owner: 'other_user' });
		const result = await syncAiPinForScheduledJob(baseJob, { req, deps });
		assert.equal(result.skipped, true);
		assert.equal(result.reason, 'owner_mismatch');
	});

	it('is idempotent when pin fields already match target state', async () => {
		const { deps, req } = createPinSyncStore({
			...basePin,
			status: 'scheduled',
			scheduled_at: baseJob.scheduled_at,
			scheduled_timezone: 'UTC',
			publish_job_id: 'job_1',
		});

		const result = await syncAiPinForScheduledJob(baseJob, { req, deps });
		assert.equal(result.skipped, true);
		assert.equal(result.reason, 'already_synced');
	});

	it('wires pin sync from schedule.js and job-mutations.js only', () => {
		const scheduleSource = readFileSync(path.join(root, 'apps/api/src/services/facebook/schedule.js'), 'utf8');
		const mutationsSource = readFileSync(path.join(root, 'apps/api/src/services/facebook/job-mutations.js'), 'utf8');
		const queueSource = readFileSync(path.join(root, 'apps/api/src/services/facebook/facebook-publish-queue.js'), 'utf8');

		assert.match(scheduleSource, /syncAiPinForScheduledJob/);
		assert.match(mutationsSource, /syncAiPinForReschedule/);
		assert.match(mutationsSource, /syncAiPinForCancel/);
		assert.match(mutationsSource, /syncAiPinForRetry/);
		assert.doesNotMatch(queueSource, /pin-sync/);
	});
});

describe('facebook F5-5 ai pin sync integration hooks', () => {
	it('scheduleFacebookPublishJobs syncs ai_pins after job creation when pin exists', async () => {
		const jobs = [];
		const events = [];
		const pins = new Map([['pin_1', { ...basePin }]]);

		const pocketbaseClient = {
			filter: (template, params = {}) => {
				let result = String(template);
				for (const [key, value] of Object.entries(params)) {
					result = result.replace(new RegExp(`\\{:${key}\\}`, 'g'), String(value));
				}
				return result;
			},
			collection: (name) => {
				if (name === 'facebook_publish_jobs') {
					return {
						create: async (payload) => {
							const row = { id: 'job_1', owner: 'user_1', workspace: 'ws_1', ...payload };
							jobs.push(row);
							return { ...row };
						},
					};
				}
				if (name === 'facebook_publish_events') {
					return {
						getList: async () => ({ items: events }),
						create: async (payload) => {
							const row = { id: `evt_${events.length + 1}`, ...payload };
							events.push(row);
							return row;
						},
					};
				}
				if (name === 'ai_pins') {
					return {
						getOne: async (id) => {
							const row = pins.get(id);
							if (!row) throw new Error('not found');
							return { ...row };
						},
						update: async (id, payload) => {
							const current = pins.get(id);
							const next = { ...current, ...payload };
							pins.set(id, next);
							return { ...next };
						},
					};
				}
				throw new Error(`unexpected collection ${name}`);
			},
		};

		await scheduleFacebookPublishJobs({
			owner: 'user_1',
			aiPinIds: ['pin_1'],
			accountId: 'acc_1',
			pageId: '123456789',
			timezone: 'UTC',
			scheduledAt: futureIso(120_000),
			req: { workspaceOwnerId: 'user_1', workspaceId: 'ws_1' },
			deps: {
				pocketbaseClient,
				sanitizeCollectionPayload: async ({ payload }) => payload,
				recordBelongsToWorkspace: () => true,
				prepareFacebookPublishJob: async () => ({
					ok: true,
					jobPayload: {
						owner: 'user_1',
						workspace: 'ws_1',
						ai_pin: 'pin_1',
						account: 'acc_1',
						page_id: '123456789',
						scheduled_at: futureIso(120_000),
						timezone: 'UTC',
						scheduled_timezone: 'UTC',
						status: 'scheduled',
					},
				}),
			},
		});

		assert.equal(pins.get('pin_1').status, 'scheduled');
		assert.equal(pins.get('pin_1').publish_job_id, 'job_1');
	});
});
