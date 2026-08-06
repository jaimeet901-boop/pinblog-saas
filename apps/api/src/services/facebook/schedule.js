/**
 * Facebook Channel Pack — scheduling service (F5-1).
 * Creates future scheduled publish jobs via prepareFacebookPublishJob + persistence.
 * No Graph calls, credits, queue, or calendar mutations.
 */

import { resolveScheduledAtUtc } from '../../utils/timezone.js';
import {
	mapFacebookPublishJobDto,
	prepareFacebookPublishJob,
} from './publish.js';
import { persistFacebookPublishJobWithCreatedEvent } from './publish-persist.js';
import { throwForFacebookPublishValidation } from './publish-validation.js';

export const FACEBOOK_SCHEDULE_MIN_LEAD_MS = 30 * 1000;

function scheduleError(status, message, errorCode = 'VALIDATION_ERROR') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeAiPinIds(value) {
	if (Array.isArray(value) && value.length > 0) {
		const ids = value
			.map((item) => (typeof item === 'string' ? item.trim() : ''))
			.filter(Boolean);
		if (ids.length === 0) {
			throw scheduleError(422, 'aiPinIds must contain valid ids');
		}
		return [...new Set(ids)];
	}

	if (typeof value === 'string' && value.trim()) {
		return [value.trim()];
	}

	throw scheduleError(422, 'aiPinIds must be a non-empty array', 'FACEBOOK_AI_PIN_REQUIRED');
}

/**
 * @param {unknown} value
 */
export function normalizePerPinTargets(value) {
	if (value == null) return {};
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw scheduleError(422, 'perPinTargets must be an object');
	}
	return value;
}

/**
 * Resolve wall-clock schedule input to UTC and enforce minimum lead time.
 *
 * @param {{ scheduledAt: string, timezone: string }} input
 */
export function resolveFacebookScheduleTime({ scheduledAt, timezone }) {
	const tz = String(timezone || '').trim();
	if (!tz) {
		throw scheduleError(422, 'timezone is required');
	}

	const scheduledAtUtc = resolveScheduledAtUtc({ scheduledAt, timezone: tz });
	if (new Date(scheduledAtUtc).getTime() <= Date.now() + FACEBOOK_SCHEDULE_MIN_LEAD_MS) {
		throw scheduleError(422, 'scheduledAt must be at least 30 seconds in the future');
	}

	return scheduledAtUtc;
}

/**
 * Schedule one or more Facebook publish jobs for a future time.
 *
 * @param {{
 *   owner: string,
 *   aiPinIds: string[],
 *   accountId?: string,
 *   pageId?: string,
 *   timezone: string,
 *   scheduledAt: string,
 *   post?: object,
 *   perPinTargets?: object,
 *   req?: object,
 *   deps?: object,
 * }} input
 */
export async function scheduleFacebookPublishJobs({
	owner,
	aiPinIds,
	accountId = '',
	pageId = '',
	timezone,
	scheduledAt,
	post = {},
	perPinTargets = {},
	req = null,
	deps = null,
} = {}) {
	const pinIds = normalizeAiPinIds(aiPinIds);
	const targets = normalizePerPinTargets(perPinTargets);
	const defaultAccountId = String(accountId || '').trim();
	const defaultPageId = String(pageId || '').trim();
	const sharedPost = post && typeof post === 'object' ? post : {};
	const scheduledAtUtc = resolveFacebookScheduleTime({ scheduledAt, timezone });
	const tz = String(timezone || 'UTC').trim() || 'UTC';

	if (!defaultPageId && Object.keys(targets).length === 0) {
		throw scheduleError(422, 'pageId is required when perPinTargets are not provided', 'FACEBOOK_PAGE_ID_REQUIRED');
	}
	if (!defaultAccountId && Object.keys(targets).length === 0) {
		throw scheduleError(422, 'accountId is required when perPinTargets are not provided', 'FACEBOOK_ACCOUNT_ID_REQUIRED');
	}

	const preparedJobs = [];
	const prepareFacebookPublishJobFn = deps?.prepareFacebookPublishJob || prepareFacebookPublishJob;

	for (const aiPinId of pinIds) {
		const target = targets[aiPinId] && typeof targets[aiPinId] === 'object' ? targets[aiPinId] : {};
		const pinAccountId = String(target.accountId || defaultAccountId || '').trim();
		const pinPageId = String(target.pageId || defaultPageId || '').trim();

		if (!pinAccountId) {
			throw scheduleError(422, 'accountId is required for each scheduled pin', 'FACEBOOK_ACCOUNT_ID_REQUIRED');
		}
		if (!pinPageId) {
			throw scheduleError(422, 'pageId is required for each scheduled pin', 'FACEBOOK_PAGE_ID_REQUIRED');
		}

		const prepared = await prepareFacebookPublishJobFn({
			owner,
			accountId: pinAccountId,
			pageId: pinPageId,
			aiPinId,
			post: sharedPost,
			timezone: tz,
			scheduledAt: scheduledAtUtc,
			req,
			deps,
		});

		throwForFacebookPublishValidation(prepared);
		preparedJobs.push(prepared);
	}

	const jobs = [];
	for (const prepared of preparedJobs) {
		const job = await persistFacebookPublishJobWithCreatedEvent({
			prepared,
			publishMode: 'schedule',
			deps: {
				...(deps || {}),
				jobCreateContext: 'facebook:create-schedule-job',
				eventCreateContext: 'facebook:schedule-created-event',
			},
		});
		jobs.push(mapFacebookPublishJobDto(job));
	}

	return { jobs };
}
