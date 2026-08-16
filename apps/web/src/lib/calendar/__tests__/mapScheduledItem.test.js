import { describe, expect, it } from 'vitest';
import {
	buildCalendarEventsUrl,
	countCalendarChannelStats,
	mapFacadeCalendarResponse,
	mapScheduledItemToCalendarEvent,
} from '../mapScheduledItem.js';

describe('mapScheduledItem (C2/C4 CalendarPage)', () => {
	it('maps facade Scheduled Items into CalendarPage event rows', () => {
		const row = mapScheduledItemToCalendarEvent({
			id: 'pinterest:job42',
			channel: 'pinterest',
			status: 'publishing',
			scheduledAt: '2026-07-15T10:00:00.000Z',
			timezone: 'Europe/Paris',
			websiteId: 'web1',
			website: { id: 'web1', name: 'Main', domain: 'main.test' },
			title: 'Summer pin',
			previewUrl: 'https://cdn/x.png',
			refType: 'pinterest_publish_jobs',
			refId: 'job42',
			actions: [],
			readOnly: true,
			deepLinks: {
				studioPinId: 'pin9',
				historyJobId: 'job42',
				liveUrl: 'https://pinterest.com/pin/1',
				accountId: 'acc1',
				accountLabel: 'Main',
				boardId: 'b1',
				boardName: 'Ideas',
				destinationUrl: 'https://example.com/post',
				createdAt: '2026-07-01T00:00:00.000Z',
				overlayText: 'Overlay',
				description: 'Desc',
				analyticsHref: '/app/analytics?websiteId=web1&jobId=job42',
				queue: { queueRef: 'qj1', sourceOfTruth: false, projected: true, state: 'running' },
				notification: { kind: null, eligible: false, emittedByCalendar: false },
			},
			performance: { impressions: 4, readOnly: true },
		});

		expect(row.id).toBe('job42');
		expect(row.facadeId).toBe('pinterest:job42');
		expect(row.status).toBe('publishing');
		expect(row.websiteId).toBe('web1');
		expect(row.website.name).toBe('Main');
		expect(row.pin.title).toBe('Summer pin');
		expect(row.pin.imageUrl).toBe('https://cdn/x.png');
		expect(row.studioPinId).toBe('pin9');
		expect(row.studioItemId).toBe('pin9');
		expect(row.analyticsHref).toContain('websiteId=web1');
		expect(row.queue.queueRef).toBe('qj1');
		expect(row.queue.sourceOfTruth).toBe(false);
		expect(row.performance.impressions).toBe(4);
		expect(row.notification.emittedByCalendar).toBe(false);
	});

	it('maps facade envelope items and builds the facade URL with C4/C7 defaults', () => {
		const rows = mapFacadeCalendarResponse({
			items: [{
				id: 'pinterest:a',
				channel: 'pinterest',
				refId: 'a',
				title: 'A',
				status: 'scheduled',
				scheduledAt: '2026-07-01T00:00:00.000Z',
				websiteId: '',
				website: null,
				deepLinks: {
					studioPinId: 'pinA',
					studioHref: '/app/ai-pins?websiteId=web1&pinId=pinA',
				},
			}],
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe('a');
		expect(rows[0].studioHref).toBe('/app/ai-pins?websiteId=web1&pinId=pinA');

		const url = buildCalendarEventsUrl({ month: '2026-07', websiteId: 'web1' });
		expect(url).toContain('/workspace/v1/calendar/events?');
		expect(url).toContain('month=2026-07');
		expect(url).toContain('includeManual=false');
		expect(url).toContain('includeDrafts=false');
		expect(url).toContain('websiteId=web1');
		expect(url).toContain('statuses=scheduled');
		expect(url).toContain('published');
		expect(url).toContain('failed');
	});

	it('maps Facebook Scheduled Items with page/post naming aliases', () => {
		const row = mapScheduledItemToCalendarEvent({
			id: 'facebook:job99',
			channel: 'facebook',
			status: 'scheduled',
			scheduledAt: '2026-08-01T12:00:00.000Z',
			title: 'Summer post',
			previewUrl: 'https://cdn/fb.png',
			refId: 'job99',
			deepLinks: {
				studioItemId: 'pin_fb_1',
				pageId: 'page_1',
				pageName: 'Brand Page',
				liveUrl: 'https://facebook.com/posts/1',
				studioHref: '/app/ai-facebook-pages?pinId=pin_fb_1',
			},
		});

		expect(row.pin.title).toBe('Summer post');
		expect(row.post).toEqual(row.pin);
		expect(row.pageId).toBe('page_1');
		expect(row.pageName).toBe('Brand Page');
		expect(row.boardId).toBe('page_1');
		expect(row.boardName).toBe('Brand Page');
		expect(row.studioItemId).toBe('pin_fb_1');
		expect(row.facebookPostUrl).toBe('https://facebook.com/posts/1');
	});
});

describe('countCalendarChannelStats', () => {
	it('counts wordpress and facebook separately from pinterest', () => {
		const now = new Date('2026-08-16T12:00:00.000Z');
		const stats = countCalendarChannelStats([
			{ channel: 'pinterest', status: 'scheduled', scheduledAt: '2026-08-16T09:00:00.000Z' },
			{ channel: 'pinterest', status: 'published', scheduledAt: '2026-08-15T09:00:00.000Z' },
			{ channel: 'facebook', status: 'scheduled', scheduledAt: '2026-08-16T10:00:00.000Z' },
			{ channel: 'wordpress', status: 'published', scheduledAt: '2026-08-10T10:00:00.000Z' },
			{ channel: 'wordpress', status: 'failed', scheduledAt: '2026-08-12T10:00:00.000Z' },
		], now);

		expect(stats.pinterest).toBe(2);
		expect(stats.facebook).toBe(1);
		expect(stats.wordpress).toBe(2);
		expect(stats.failed).toBe(1);
		expect(stats.pending).toBe(2);
		expect(stats.scheduledToday).toBe(2);
	});

	it('treats untagged jobs as pinterest so legacy feeds stay numeric', () => {
		const stats = countCalendarChannelStats([
			{ status: 'scheduled', scheduledAt: '2026-08-16T09:00:00.000Z' },
		], new Date('2026-08-16T12:00:00.000Z'));
		expect(stats.pinterest).toBe(1);
		expect(stats.wordpress).toBe(0);
		expect(stats.facebook).toBe(0);
	});
});
