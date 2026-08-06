import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FACEBOOK_SCHEDULE_MIN_LEAD_MS,
	normalizeAiPinIds,
	resolveFacebookScheduleTime,
	scheduleFacebookPublishJobs,
} from './schedule.js';
import {
	buildFacebookPublishCreatedEventForJob,
	persistFacebookPublishJobWithCreatedEvent,
} from './publish-persist.js';
import { buildFacebookPublishCreatedEventPayload } from './publish-events.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

const basePrepared = {
	ok: true,
	jobPayload: {
		owner: 'user_1',
		workspace: 'ws_1',
		ai_pin: 'pin_1',
		account: 'acc_1',
		page_id: '123456789',
		scheduled_at: '2026-12-01T15:00:00.000Z',
		timezone: 'UTC',
		scheduled_timezone: 'UTC',
		status: 'scheduled',
	},
	eventPayload: {
		event_type: 'created',
		owner: 'user_1',
		payload: { publishMode: 'now' },
	},
};

function futureIso(msAhead = 60_000) {
	return new Date(Date.now() + msAhead).toISOString();
}

function createPersistDeps() {
	const jobs = [];
	const events = [];

	const pocketbaseClient = {
		collection: (name) => {
			if (name === 'facebook_publish_jobs') {
				return {
					create: async (payload) => {
						const row = { id: `job_${jobs.length + 1}`, ...payload };
						jobs.push(row);
						return { ...row };
					},
				};
			}
			if (name === 'facebook_publish_events') {
				return {
					create: async (payload) => {
						const row = { id: `evt_${events.length + 1}`, ...payload };
						events.push(row);
						return { ...row };
					},
				};
			}
			throw new Error(`unexpected collection ${name}`);
		},
	};

	return {
		jobs,
		events,
		deps: {
			pocketbaseClient,
			sanitizeCollectionPayload: async ({ payload }) => payload,
		},
	};
}

describe('facebook F5-1 schedule service', () => {
	it('normalizeAiPinIds accepts arrays and deduplicates', () => {
		assert.deepEqual(normalizeAiPinIds(['pin_a', 'pin_b', 'pin_a']), ['pin_a', 'pin_b']);
		assert.deepEqual(normalizeAiPinIds('pin_single'), ['pin_single']);
	});

	it('normalizeAiPinIds rejects empty input', () => {
		assert.throws(() => normalizeAiPinIds([]), /non-empty array/);
		assert.throws(() => normalizeAiPinIds(null), /non-empty array/);
	});

	it('resolveFacebookScheduleTime converts wall time to UTC', () => {
		const utc = resolveFacebookScheduleTime({
			scheduledAt: futureIso(120_000).slice(0, 16),
			timezone: 'UTC',
		});
		assert.match(utc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	});

	it('resolveFacebookScheduleTime rejects schedules inside 30-second lead window', () => {
		assert.throws(
			() => resolveFacebookScheduleTime({
				scheduledAt: new Date(Date.now() + 10_000).toISOString(),
				timezone: 'UTC',
			}),
			/at least 30 seconds/,
		);
	});

	it('resolveFacebookScheduleTime rejects invalid timezone', () => {
		assert.throws(
			() => resolveFacebookScheduleTime({
				scheduledAt: '2099-12-15T10:00',
				timezone: 'Invalid/Timezone',
			}),
			/Invalid timezone/,
		);
	});

	it('resolveFacebookScheduleTime requires timezone', () => {
		assert.throws(
			() => resolveFacebookScheduleTime({ scheduledAt: futureIso(120_000), timezone: '' }),
			/timezone is required/,
		);
	});

	it('scheduleFacebookPublishJobs creates future jobs with schedule publishMode events', async () => {
		const { jobs, events, deps } = createPersistDeps();
		let prepareCalls = 0;

		const result = await scheduleFacebookPublishJobs({
			owner: 'user_1',
			aiPinIds: ['pin_1'],
			accountId: 'acc_1',
			pageId: '123456789',
			timezone: 'UTC',
			scheduledAt: futureIso(120_000),
			deps: {
				...deps,
				prepareFacebookPublishJob: async () => {
					prepareCalls += 1;
					return { ...basePrepared };
				},
			},
		});

		assert.equal(prepareCalls, 1);
		assert.equal(result.jobs.length, 1);
		assert.equal(result.jobs[0].status, 'scheduled');
		assert.equal(jobs.length, 1);
		assert.equal(events.length, 1);
		assert.equal(events[0].job, jobs[0].id);
		assert.equal(events[0].payload.idempotencyKey, `created:${jobs[0].id}`);
		assert.equal(events[0].payload.publishMode, 'schedule');
	});

	it('scheduleFacebookPublishJobs supports batch aiPinIds', async () => {
		const { jobs, events, deps } = createPersistDeps();
		const preparedPins = [];

		const result = await scheduleFacebookPublishJobs({
			owner: 'user_1',
			aiPinIds: ['pin_1', 'pin_2'],
			accountId: 'acc_1',
			pageId: '123456789',
			timezone: 'UTC',
			scheduledAt: futureIso(120_000),
			deps: {
				...deps,
				prepareFacebookPublishJob: async ({ aiPinId, scheduledAt }) => {
					preparedPins.push({ aiPinId, scheduledAt });
					return {
						...basePrepared,
						jobPayload: {
							...basePrepared.jobPayload,
							ai_pin: aiPinId,
							scheduled_at: scheduledAt,
						},
					};
				},
			},
		});

		assert.equal(result.jobs.length, 2);
		assert.equal(jobs.length, 2);
		assert.equal(events.length, 2);
		assert.deepEqual(preparedPins.map((item) => item.aiPinId), ['pin_1', 'pin_2']);
		assert.ok(preparedPins.every((item) => item.scheduledAt === preparedPins[0].scheduledAt));
	});

	it('scheduleFacebookPublishJobs reuses destination validation via prepareFacebookPublishJob', async () => {
		const { deps } = createPersistDeps();
		let validationCalled = false;

		await assert.rejects(
			() => scheduleFacebookPublishJobs({
				owner: 'user_1',
				aiPinIds: ['pin_1'],
				accountId: 'acc_1',
				pageId: '123456789',
				timezone: 'UTC',
				scheduledAt: futureIso(120_000),
				deps: {
					...deps,
					prepareFacebookPublishJob: async () => {
						validationCalled = true;
						return {
							ok: false,
							errors: ['Facebook destination not found'],
						};
					},
				},
			}),
			(err) => err.status === 404 && err.errorCode === 'FACEBOOK_DESTINATION_NOT_FOUND',
		);

		assert.equal(validationCalled, true);
	});

	it('scheduleFacebookPublishJobs rejects duplicate active jobs with 409', async () => {
		const { deps } = createPersistDeps();

		await assert.rejects(
			() => scheduleFacebookPublishJobs({
				owner: 'user_1',
				aiPinIds: ['pin_1'],
				accountId: 'acc_1',
				pageId: '123456789',
				timezone: 'UTC',
				scheduledAt: futureIso(120_000),
				deps: {
					...deps,
					prepareFacebookPublishJob: async () => ({
						ok: false,
						errors: ['This pin already has an active Facebook publish job'],
					}),
				},
			}),
			(err) => err.status === 409 && err.errorCode === 'FACEBOOK_PUBLISH_JOB_CONFLICT',
		);
	});

	it('scheduleFacebookPublishJobs validates all pins before persisting any job', async () => {
		const { jobs, deps } = createPersistDeps();
		let prepareCount = 0;

		await assert.rejects(
			() => scheduleFacebookPublishJobs({
				owner: 'user_1',
				aiPinIds: ['pin_ok', 'pin_bad'],
				accountId: 'acc_1',
				pageId: '123456789',
				timezone: 'UTC',
				scheduledAt: futureIso(120_000),
				deps: {
					...deps,
					prepareFacebookPublishJob: async ({ aiPinId }) => {
						prepareCount += 1;
						if (aiPinId === 'pin_bad') {
							return { ok: false, errors: ['This pin already has an active Facebook publish job'] };
						}
						return { ...basePrepared, jobPayload: { ...basePrepared.jobPayload, ai_pin: aiPinId } };
					},
				},
			}),
			/FACEBOOK_PUBLISH_JOB_CONFLICT|active Facebook publish job/,
		);

		assert.equal(prepareCount, 2);
		assert.equal(jobs.length, 0);
	});

	it('buildFacebookPublishCreatedEventForJob patches idempotency key after job id exists', () => {
		const event = buildFacebookPublishCreatedEventForJob(basePrepared, 'job_abc', { publishMode: 'schedule' });
		assert.equal(event.job, 'job_abc');
		assert.equal(event.payload.idempotencyKey, 'created:job_abc');
		assert.equal(event.payload.publishMode, 'schedule');
	});

	it('persistFacebookPublishJobWithCreatedEvent patches created event idempotency for publish-now', async () => {
		const { jobs, events, deps } = createPersistDeps();

		const job = await persistFacebookPublishJobWithCreatedEvent({
			prepared: basePrepared,
			publishMode: 'now',
			deps,
		});

		assert.equal(jobs.length, 1);
		assert.equal(events.length, 1);
		assert.equal(events[0].job, job.id);
		assert.equal(events[0].payload.idempotencyKey, `created:${job.id}`);
		assert.equal(events[0].payload.publishMode, 'now');
	});

	it('buildFacebookPublishCreatedEventPayload without job id leaves empty idempotency key', () => {
		const event = buildFacebookPublishCreatedEventPayload({
			owner: 'user_1',
			accountId: 'acc_1',
			pageId: '123',
			aiPinId: 'pin_1',
		});
		assert.equal(event.payload.idempotencyKey, '');
	});

	it('registers POST /facebook/schedule without graph, queue, or credits wiring', () => {
		const route = readFileSync(path.join(root, 'apps/api/src/routes/facebook.js'), 'utf8');
		assert.match(route, /router\.post\('\/schedule'/);
		assert.match(route, /scheduleFacebookPublishJobs/);
		assert.match(route, /persistFacebookPublishJobWithCreatedEvent/);
		assert.doesNotMatch(route, /graph-publish|publishFacebookFeedPost/);
		assert.doesNotMatch(route, /facebook-publish-queue|consumeFeatureCredits/);
	});

	it('exports 30-second minimum lead constant', () => {
		assert.equal(FACEBOOK_SCHEDULE_MIN_LEAD_MS, 30_000);
	});
});
