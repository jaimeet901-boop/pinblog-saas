import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectScheduledItems, listUnifiedCalendarEvents } from './facade.js';
import { matchesFacadeFilters, monthToUtcRange, parseCalendarFacadeQuery } from './query.js';
import {
	buildScheduledItemId,
	normalizeScheduledItem,
	assertScheduledItemContract,
} from './scheduled-item.js';
import { createManualOverlayProvider, mapManualEventToScheduledItem } from './providers/manual-overlay.js';
import {
	createPinterestCalendarProvider,
	mapPinterestJobToScheduledItem,
	PINTEREST_CALENDAR_CHANNEL,
} from './providers/pinterest.js';
import {
	CALENDAR_CONSOLIDATION_PHASE,
	SCHEDULED_ITEM_CONTRACT_FIELDS,
	UNIFIED_CALENDAR_EVENTS_PATH,
} from './calendar-architecture.js';

describe('calendar facade (C1+)', () => {
	it('locks phase C10 and facade path', () => {
		assert.equal(CALENDAR_CONSOLIDATION_PHASE, 'C10');
		assert.equal(UNIFIED_CALENDAR_EVENTS_PATH, '/workspace/v1/calendar/events');
	});

	it('normalizes Scheduled Items to the contract fields only', () => {
		const item = normalizeScheduledItem({
			channel: 'pinterest',
			refId: 'job1',
			status: 'scheduled',
			scheduledAt: '2026-07-15T12:00:00.000Z',
			websiteId: 'wsite1',
			title: 'Pin A',
			boardId: 'should-not-leak',
			pinterestAccount: 'secret',
		});

		assert.equal(item.id, 'pinterest:job1');
		assert.equal(item.channel, 'pinterest');
		assert.equal(item.websiteId, 'wsite1');
		assert.equal(item.website.id, 'wsite1');
		assert.equal(item.boardId, undefined);
		assert.equal(item.pinterestAccount, undefined);
		assertScheduledItemContract(item);
		for (const field of SCHEDULED_ITEM_CONTRACT_FIELDS) {
			assert.ok(Object.prototype.hasOwnProperty.call(item, field), field);
		}
	});

	it('parses month and from/to query filters', () => {
		const byMonth = parseCalendarFacadeQuery({ month: '2026-07' });
		assert.equal(byMonth.month, '2026-07');
		assert.equal(byMonth.from, '2026-07-01T00:00:00.000Z');
		assert.equal(byMonth.to, '2026-08-01T00:00:00.000Z');
		assert.ok(byMonth.statuses.includes('scheduled'));
		assert.ok(byMonth.statuses.includes('published'));
		assert.ok(byMonth.statuses.includes('failed'));

		const byRange = parseCalendarFacadeQuery({
			from: '2026-07-10T00:00:00.000Z',
			to: '2026-07-20T00:00:00.000Z',
			websiteId: 'site-9',
			channels: 'pinterest,manual',
			statuses: 'scheduled,failed',
		});
		assert.equal(byRange.month, null);
		assert.equal(byRange.websiteId, 'site-9');
		assert.deepEqual(byRange.channels, ['pinterest', 'manual']);
		assert.deepEqual(byRange.statuses, ['scheduled', 'failed']);

		const legacyNarrow = parseCalendarFacadeQuery({ month: '2026-07', statuses: 'scheduled' });
		assert.deepEqual(legacyNarrow.statuses, ['scheduled']);

		assert.throws(() => monthToUtcRange('2026-13'), (error) => error.status === 422);
		assert.throws(
			() => parseCalendarFacadeQuery({ from: '2026-07-01T00:00:00.000Z' }),
			(error) => error.errorCode === 'VALIDATION_ERROR',
		);
	});

	it('maps Pinterest jobs without leaking channel fields into the item', () => {
		const item = mapPinterestJobToScheduledItem({
			id: 'ppj1',
			status: 'scheduled',
			scheduled_at: '2026-07-12T08:00:00.000Z',
			scheduled_timezone: 'Europe/Paris',
			websiteId: 'web1',
			title: 'Summer pin',
			ai_pin: 'pin99',
			board_id: 'board-x',
			expand: { ai_pin: { id: 'pin99', title: 'Summer pin', image_url: 'https://cdn/x.png' } },
		});

		assert.equal(item.id, buildScheduledItemId(PINTEREST_CALENDAR_CHANNEL, 'ppj1'));
		assert.equal(item.channel, 'pinterest');
		assert.equal(item.refType, 'pinterest_publish_jobs');
		assert.equal(item.previewUrl, 'https://cdn/x.png');
		assert.deepEqual(item.actions, ['reschedule', 'cancel']);
		assert.equal(item.board_id, undefined);
		assert.equal(item.deepLinks.studioPinId, 'pin99');
	});

	it('projects Pinterest scheduled jobs and filters by websiteId / range', async () => {
		const jobs = [
			{
				id: 'a',
				status: 'scheduled',
				scheduled_at: '2026-07-05T10:00:00.000Z',
				websiteId: 'site-a',
				title: 'A',
			},
			{
				id: 'b',
				status: 'scheduled',
				scheduled_at: '2026-07-15T10:00:00.000Z',
				websiteId: 'site-b',
				title: 'B',
			},
			{
				id: 'c',
				status: 'published',
				scheduled_at: '2026-07-16T10:00:00.000Z',
				websiteId: 'site-b',
				title: 'C published',
			},
			{
				id: 'd',
				status: 'scheduled',
				scheduled_at: '2026-08-02T10:00:00.000Z',
				websiteId: 'site-b',
				title: 'Next month',
			},
		];

		const providers = [
			createPinterestCalendarProvider({
				fetchJobs: async () => jobs,
			}),
		];

		const filters = parseCalendarFacadeQuery({
			month: '2026-07',
			websiteId: 'site-b',
		});
		const items = await collectScheduledItems({ req: {} }, filters, providers);
		const ids = items.map((item) => item.id).sort();

		assert.deepEqual(ids, ['pinterest:b', 'pinterest:c']);
		assert.ok(items.every((item) => item.websiteId === 'site-b'));
		assert.equal(items.find((item) => item.id === 'pinterest:c').status, 'published');
	});

	it('includes published and failed statuses and normalizes channel aliases', async () => {
		const providers = [
			createPinterestCalendarProvider({
				fetchJobs: async () => [
					{
						id: 'ok',
						status: 'scheduled',
						scheduled_at: '2026-07-05T10:00:00.000Z',
						title: 'Scheduled',
					},
					{
						id: 'done',
						status: 'published',
						scheduled_at: '2026-07-06T10:00:00.000Z',
						title: 'Published',
					},
					{
						id: 'bad',
						status: 'failed',
						scheduled_at: '2026-07-07T10:00:00.000Z',
						title: 'Failed',
					},
					{
						id: 'wait',
						status: 'waiting_provider',
						scheduled_at: '2026-07-08T10:00:00.000Z',
						title: 'Waiting',
					},
				],
			}),
		];

		const items = await collectScheduledItems(
			{ req: {} },
			parseCalendarFacadeQuery({ month: '2026-07' }),
			providers,
		);
		const byId = Object.fromEntries(items.map((item) => [item.id, item]));
		assert.equal(byId['pinterest:done'].status, 'published');
		assert.equal(byId['pinterest:bad'].status, 'failed');
		assert.equal(byId['pinterest:wait'].status, 'publishing');

		const failedOnly = await collectScheduledItems(
			{ req: {} },
			parseCalendarFacadeQuery({ month: '2026-07', statuses: 'failed' }),
			providers,
		);
		assert.deepEqual(failedOnly.map((item) => item.id), ['pinterest:bad']);
	});

	it('includes manual overlay and skips channel-job mirror CE rows', async () => {
		const providers = [
			createPinterestCalendarProvider({
				fetchJobs: async () => [{
					id: 'ppj1',
					status: 'scheduled',
					scheduled_at: '2026-07-10T10:00:00.000Z',
					websiteId: 'site-1',
					title: 'Pin',
				}],
			}),
			createManualOverlayProvider({
				fetchEvents: async () => [
					{
						id: 'ce1',
						title: 'Manual plan',
						status: 'scheduled',
						scheduled_at: '2026-07-11T10:00:00.000Z',
						ref_type: '',
						meta: { websiteId: 'site-1' },
					},
					{
						id: 'ce2',
						title: 'Mirror',
						status: 'scheduled',
						scheduled_at: '2026-07-12T10:00:00.000Z',
						ref_type: 'pinterest_publish_jobs',
						ref_id: 'ppj1',
					},
				],
			}),
		];

		const filters = parseCalendarFacadeQuery({ month: '2026-07' });
		const items = await collectScheduledItems({ req: {} }, filters, providers);
		const ids = items.map((item) => item.id).sort();

		assert.deepEqual(ids, ['manual:ce1', 'pinterest:ppj1']);
		assert.equal(mapManualEventToScheduledItem({
			id: 'ce1',
			title: 'Manual plan',
			scheduled_at: '2026-07-11T10:00:00.000Z',
		}).channel, 'manual');
	});

	it('filters by channels and can disable manual overlay', async () => {
		const providers = [
			createPinterestCalendarProvider({
				fetchJobs: async () => [{
					id: 'ppj1',
					status: 'scheduled',
					scheduled_at: '2026-07-10T10:00:00.000Z',
					title: 'Pin',
				}],
			}),
			createManualOverlayProvider({
				fetchEvents: async () => [{
					id: 'ce1',
					title: 'Plan',
					status: 'scheduled',
					scheduled_at: '2026-07-11T10:00:00.000Z',
				}],
			}),
		];

		const pinterestOnly = await collectScheduledItems(
			{ req: {} },
			parseCalendarFacadeQuery({ month: '2026-07', channels: 'pinterest' }),
			providers,
		);
		assert.deepEqual(pinterestOnly.map((item) => item.id), ['pinterest:ppj1']);

		const noManual = await collectScheduledItems(
			{ req: {} },
			parseCalendarFacadeQuery({ month: '2026-07', includeManual: 'false' }),
			providers,
		);
		assert.deepEqual(noManual.map((item) => item.id), ['pinterest:ppj1']);
	});

	it('listUnifiedCalendarEvents returns facade envelope with injected providers', async () => {
		const result = await listUnifiedCalendarEvents(
			{ workspace: { id: 'ws1' }, pocketbaseUserId: 'u1' },
			{ month: '2026-07', websiteId: 'site-1' },
			{
				assertCapability: () => {},
				providers: [
					createPinterestCalendarProvider({
						fetchJobs: async () => [{
							id: 'job9',
							status: 'scheduled',
							scheduled_at: '2026-07-20T09:00:00.000Z',
							websiteId: 'site-1',
							title: 'Facade pin',
						}],
					}),
				],
			},
		);

		assert.equal(result.meta.source, 'unified_calendar_facade');
		assert.equal(result.meta.channelAgnostic, true);
		assert.equal(result.month, '2026-07');
		assert.equal(result.filters.websiteId, 'site-1');
		assert.equal(result.items.length, 1);
		assert.equal(result.items[0].title, 'Facade pin');
		assert.ok(matchesFacadeFilters(result.items[0], parseCalendarFacadeQuery({ month: '2026-07', websiteId: 'site-1' })));
	});

	it('remains extensible: unknown future channel provider needs no facade changes', async () => {
		const wordpressStub = {
			channel: 'wordpress',
			async listScheduledItems() {
				return [
					normalizeScheduledItem({
						channel: 'wordpress',
						refId: 'wp1',
						refType: 'wordpress_publish_jobs',
						status: 'scheduled',
						scheduledAt: '2026-07-18T12:00:00.000Z',
						title: 'WP post',
						websiteId: 'site-1',
						actions: ['reschedule', 'cancel'],
						readOnly: true,
					}),
				];
			},
		};

		const items = await collectScheduledItems(
			{ req: {} },
			parseCalendarFacadeQuery({ month: '2026-07', channels: 'wordpress' }),
			[wordpressStub],
		);

		assert.equal(items.length, 1);
		assert.equal(items[0].channel, 'wordpress');
		assert.equal(items[0].id, 'wordpress:wp1');
	});
});
