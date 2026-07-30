import { describe, expect, it } from 'vitest';
import { buildCalendarMutationUrl, resolveCalendarEventId } from '../mutations.js';

describe('calendar mutations (C5)', () => {
	it('builds facade mutation URLs from facadeId', () => {
		const job = {
			id: 'job42',
			facadeId: 'pinterest:job42',
			channel: 'pinterest',
			refId: 'job42',
		};
		expect(resolveCalendarEventId(job)).toBe('pinterest:job42');
		expect(buildCalendarMutationUrl(job, 'reschedule')).toBe(
			'/workspace/v1/calendar/events/pinterest%3Ajob42/reschedule',
		);
		expect(buildCalendarMutationUrl(job, 'cancel')).toContain('/cancel');
		expect(buildCalendarMutationUrl(job, 'retry')).toContain('/retry');
	});
});
