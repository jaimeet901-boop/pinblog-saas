/**
 * Facebook schedule API calls for Content Studio.
 */

import apiServerClient from '@/lib/apiServerClient';

export {
	RECURRENCE_MODES,
	expandRecurrence,
	datetimeLocalToIso,
	isoToDatetimeLocal,
} from '@/services/ai-pins/scheduleService.js';

async function parseJson(response) {
	return response.json().catch(() => ({}));
}

function mapPerPinTargets(perPinTargets = {}) {
	const mapped = {};
	for (const [pinId, target] of Object.entries(perPinTargets || {})) {
		if (!target || typeof target !== 'object') continue;
		mapped[pinId] = {
			accountId: target.accountId,
			pageId: target.pageId || target.boardId,
		};
	}
	return mapped;
}

async function postSchedule({
	pinIds,
	accountId,
	boardId,
	timezone,
	scheduledAt,
	perPinTargets,
}) {
	const response = await apiServerClient.fetch('/facebook/schedule', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			aiPinIds: pinIds,
			accountId,
			pageId: boardId,
			timezone,
			scheduledAt,
			...(perPinTargets && Object.keys(perPinTargets).length
				? { perPinTargets: mapPerPinTargets(perPinTargets) }
				: {}),
		}),
	});
	const body = await parseJson(response);
	if (!response.ok) {
		throw new Error(body?.message || `Schedule failed (${response.status})`);
	}
	return body;
}

export async function schedulePins({
	pinIds,
	accountId,
	boardId,
	timezone,
	scheduledAt,
	perPinTargets,
}) {
	if (!Array.isArray(pinIds) || pinIds.length === 0) {
		throw new Error('Select at least one post to schedule');
	}
	if (!accountId) throw new Error('Select a Facebook account');
	if (!boardId) throw new Error('Select a Facebook Page');
	if (!timezone) throw new Error('Timezone is required');
	if (!scheduledAt) throw new Error('Schedule date/time is required');

	return postSchedule({
		pinIds,
		accountId,
		boardId,
		timezone,
		scheduledAt,
		perPinTargets,
	});
}

export async function scheduleRecurrenceSeries({
	occurrenceDates,
	pinIdsByOccurrence,
	accountId,
	boardId,
	timezone,
	perPinTargets,
}) {
	const jobs = [];
	for (let i = 0; i < occurrenceDates.length; i += 1) {
		const pinIds = pinIdsByOccurrence[i] || pinIdsByOccurrence[0];
		const result = await postSchedule({
			pinIds,
			accountId,
			boardId,
			timezone,
			scheduledAt: occurrenceDates[i],
			perPinTargets,
		});
		jobs.push(...(result.jobs || []));
	}
	return { jobs, occurrenceCount: occurrenceDates.length };
}
