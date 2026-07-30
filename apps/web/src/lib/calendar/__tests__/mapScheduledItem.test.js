import { describe, expect, it } from 'vitest';
import {
	buildCalendarEventsUrl,
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
});
