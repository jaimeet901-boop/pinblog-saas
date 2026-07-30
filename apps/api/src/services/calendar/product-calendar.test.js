import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listUnifiedCalendarEvents } from './facade.js';
import { createPinterestCalendarProvider } from './providers/pinterest.js';
import { createManualOverlayProvider } from './providers/manual-overlay.js';
import {
	loadDashboardCalendarJobs,
	loadProductCalendarMonth,
	localCalendarMonthKey,
	mapScheduledItemsToDashboardCalendarJobs,
	PRODUCT_CALENDAR_READ_DEFAULTS,
} from './product-calendar.js';
import { CALENDAR_CONSOLIDATION_PHASE } from './calendar-architecture.js';

function stubProviders(jobs, events = []) {
	return [
		createPinterestCalendarProvider({
			fetchJobs: async () => jobs,
		}),
		createManualOverlayProvider({
			fetchEvents: async () => events,
		}),
	];
}

describe('product calendar / dashboard parity (C3/C4)', () => {
	it('locks phase C10 defaults (no manual/draft overlays, expanded statuses)', () => {
		assert.equal(CALENDAR_CONSOLIDATION_PHASE, 'C10');
		assert.equal(PRODUCT_CALENDAR_READ_DEFAULTS.includeManual, false);
		assert.equal(PRODUCT_CALENDAR_READ_DEFAULTS.includeDrafts, false);
		assert.ok(PRODUCT_CALENDAR_READ_DEFAULTS.statuses.includes('published'));
		assert.ok(PRODUCT_CALENDAR_READ_DEFAULTS.statuses.includes('failed'));
		assert.ok(!PRODUCT_CALENDAR_READ_DEFAULTS.statuses.includes('draft'));
		assert.match(localCalendarMonthKey(new Date('2026-07-15T12:00:00')), /^2026-07$/);
	});

	it('maps Scheduled Items into Dashboard calendarJobs widget fields', () => {
		const rows = mapScheduledItemsToDashboardCalendarJobs([
			{
				id: 'pinterest:job1',
				channel: 'pinterest',
				title: 'Pin A',
				status: 'scheduled',
				scheduledAt: '2026-07-15T10:00:00.000Z',
				timezone: 'UTC',
				websiteId: 'w1',
				refId: 'job1',
			},
		]);
		assert.equal(rows[0].id, 'pinterest:job1');
		assert.equal(rows[0].title, 'Pin A');
		assert.equal(rows[0].eventType, 'publish');
		assert.equal(rows[0].scheduledAt, '2026-07-15T10:00:00.000Z');
	});

	it('Dashboard and Calendar facade return the exact same scheduled item set', async () => {
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
				scheduled_at: '2026-07-20T10:00:00.000Z',
				websiteId: 'site-b',
				title: 'B',
			},
			{
				id: 'c',
				status: 'published',
				scheduled_at: '2026-07-21T10:00:00.000Z',
				title: 'Published included in C4 defaults',
			},
			{
				id: 'd',
				status: 'scheduled',
				scheduled_at: '2026-08-02T10:00:00.000Z',
				title: 'Next month',
			},
		];
		const manualEvents = [
			{
				id: 'ce1',
				title: 'Manual should be excluded',
				status: 'scheduled',
				scheduled_at: '2026-07-11T10:00:00.000Z',
				ref_type: '',
			},
		];
		const providers = stubProviders(jobs, manualEvents);
		const req = { workspace: { id: 'ws1' }, pocketbaseUserId: 'u1' };
		const assertCapability = () => {};

		const calendar = await listUnifiedCalendarEvents(
			req,
			{ month: '2026-07', includeManual: 'false' },
			{ providers, assertCapability },
		);
		const dashboard = await loadDashboardCalendarJobs(req, {
			month: '2026-07',
			providers,
			assertCapability,
		});
		const product = await loadProductCalendarMonth(req, {
			month: '2026-07',
			providers,
			assertCapability,
		});

		const calendarIds = calendar.items.map((item) => item.id).sort();
		const dashboardIds = dashboard.calendarJobs.map((job) => job.id).sort();
		const productIds = product.items.map((item) => item.id).sort();

		assert.deepEqual(calendarIds, ['pinterest:a', 'pinterest:b', 'pinterest:c']);
		assert.deepEqual(dashboardIds, calendarIds);
		assert.deepEqual(productIds, calendarIds);

		assert.deepEqual(
			dashboard.calendarJobs.map((job) => ({
				id: job.id,
				title: job.title,
				status: job.status,
				scheduledAt: job.scheduledAt,
			})).sort((a, b) => a.id.localeCompare(b.id)),
			calendar.items.map((item) => ({
				id: item.id,
				title: item.title,
				status: item.status,
				scheduledAt: item.scheduledAt,
			})).sort((a, b) => a.id.localeCompare(b.id)),
		);

		assert.equal(dashboard.meta.source, 'unified_calendar_facade');
		assert.equal(dashboard.filters.includeManual, false);
	});

	it('does not prefer calendar_events over channel jobs (manual overlay off)', async () => {
		const providers = stubProviders(
			[{
				id: 'ppj1',
				status: 'scheduled',
				scheduled_at: '2026-07-10T10:00:00.000Z',
				title: 'Channel job',
			}],
			[{
				id: 'ce-only',
				title: 'CE-first legacy row',
				status: 'scheduled',
				scheduled_at: '2026-07-10T11:00:00.000Z',
				ref_type: '',
			}],
		);

		const dashboard = await loadDashboardCalendarJobs(
			{ workspace: { id: 'ws1' }, pocketbaseUserId: 'u1' },
			{ month: '2026-07', providers, assertCapability: () => {} },
		);

		assert.deepEqual(dashboard.calendarJobs.map((job) => job.id), ['pinterest:ppj1']);
		assert.ok(!dashboard.calendarJobs.some((job) => String(job.id).includes('ce-only')));
	});
});
