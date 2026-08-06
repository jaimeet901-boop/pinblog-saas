/**
 * Facebook channel mutation adapter (pure factory).
 * Calendar mutation router dispatches here; writes delegate to job-mutations.js (F5-3).
 * Pass deps explicitly — live PocketBase wiring lives in facebook-live.js.
 *
 * Collection: facebook_publish_jobs.
 * Actions: reschedule / cancel / retry (+ publishNow for direct adapter use).
 */

import {
	cancelFacebookPublishJob,
	publishNowFacebookPublishJob,
	rescheduleFacebookPublishJob,
	retryFacebookPublishJob,
} from '../../../facebook/job-mutations.js';
import {
	FACEBOOK_JOB_REF_TYPE,
	mapFacebookJobToScheduledItem,
} from '../../providers/facebook.js';

function freezeError(status, message, errorCode = 'VALIDATION_ERROR') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

/**
 * Map a publish job DTO (from job-mutations) into a record shape for calendar projection.
 *
 * @param {object} dto
 */
export function mapFacebookPublishJobDtoToCalendarRecord(dto = {}) {
	return {
		id: dto.id,
		status: dto.status,
		scheduled_at: dto.scheduledAt,
		scheduledAt: dto.scheduledAt,
		timezone: dto.timezone,
		scheduled_timezone: dto.timezone,
		title: dto.title,
		message: dto.message,
		image_url: dto.imageUrl,
		imageUrl: dto.imageUrl,
		page_id: dto.pageId,
		pageId: dto.pageId,
		page_label: dto.pageName,
		page_name: dto.pageName,
		account: dto.accountId,
		accountId: dto.accountId,
		ai_pin: dto.aiPinId,
		destination_url: dto.destinationUrl,
		facebook_post_id: dto.facebookPostId,
		facebook_post_url: dto.facebookPostUrl,
		attempt_count: dto.attemptCount,
		last_error: dto.lastError,
	};
}

function calendarMutationResult(refId, dto) {
	const record = mapFacebookPublishJobDtoToCalendarRecord(dto);
	return {
		channel: 'facebook',
		refId: String(refId || record.id || '').trim(),
		item: mapFacebookJobToScheduledItem(record),
	};
}

/**
 * Build injectable mutation deps for unit tests that still use getJob/updateJob stubs.
 *
 * @param {{
 *   getJob: Function,
 *   updateJob: Function,
 *   sanitize?: Function,
 *   getOwner?: Function,
 *   recordBelongsToWorkspace?: Function,
 *   andWorkspaceScope?: Function,
 * }} legacyDeps
 */
export function buildFacebookCalendarMutationDepsFromLegacy(legacyDeps = {}) {
	const jobs = new Map();
	const events = [];

	const pocketbaseClient = {
		filter: (template, params = {}) => {
			let result = String(template);
			for (const [key, value] of Object.entries(params)) {
				result = result.replace(new RegExp(`\\{:${key}\\}`, 'g'), String(value));
			}
			return result;
		},
		collection: (name) => {
			if (name === FACEBOOK_JOB_REF_TYPE) {
				return {
					getOne: async (id) => {
						if (typeof legacyDeps.getJob === 'function') {
							const row = await legacyDeps.getJob(id);
							if (!row) throw new Error('not found');
							jobs.set(id, { ...row });
							return { ...row };
						}
						const row = jobs.get(id);
						if (!row) throw new Error('not found');
						return { ...row };
					},
					update: async (id, payload) => {
						if (typeof legacyDeps.updateJob === 'function') {
							const updated = await legacyDeps.updateJob(id, payload);
							jobs.set(id, { ...updated });
							return { ...updated };
						}
						const current = jobs.get(id);
						if (!current) throw new Error('not found');
						const next = { ...current, ...payload };
						jobs.set(id, next);
						return { ...next };
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
			if (name === 'facebook_pages') {
				return {
					getFirstListItem: async () => ({
						id: 'page_rec_1',
						name: 'Chef IA Page',
						page_id: '123456789',
					}),
				};
			}
			throw new Error(`unexpected collection ${name}`);
		},
	};

	return {
		pocketbaseClient,
		sanitizeCollectionPayload: legacyDeps.sanitize
			? legacyDeps.sanitize
			: async ({ payload }) => payload,
		recordBelongsToWorkspace: legacyDeps.recordBelongsToWorkspace || (() => true),
		andWorkspaceScope: legacyDeps.andWorkspaceScope || ((_req, filter) => filter),
		getOwnedFacebookAccountById: legacyDeps.getOwnedFacebookAccountById || (async () => ({
			id: 'acc_1',
			label: 'My Business',
			connected: true,
		})),
		validateFacebookDestinationPost: legacyDeps.validateFacebookDestinationPost || (async () => ({
			ok: true,
			errors: [],
			normalized: { pageId: '123456789', accountId: 'acc_1' },
		})),
		_events: events,
		_jobs: jobs,
	};
}

/**
 * @param {{
 *   mutationDeps?: object,
 *   getJob?: Function,
 *   updateJob?: Function,
 *   sanitize?: Function,
 *   resolveScheduledAtUtc?: Function,
 *   getOwner?: Function,
 *   recordBelongsToWorkspace?: Function,
 *   andWorkspaceScope?: Function,
 *   rescheduleFacebookPublishJob?: Function,
 *   cancelFacebookPublishJob?: Function,
 *   retryFacebookPublishJob?: Function,
 *   publishNowFacebookPublishJob?: Function,
 * }} deps
 */
export function createFacebookMutationAdapter(deps = {}) {
	const rescheduleFn = deps.rescheduleFacebookPublishJob || rescheduleFacebookPublishJob;
	const cancelFn = deps.cancelFacebookPublishJob || cancelFacebookPublishJob;
	const retryFn = deps.retryFacebookPublishJob || retryFacebookPublishJob;
	const publishNowFn = deps.publishNowFacebookPublishJob || publishNowFacebookPublishJob;

	let mutationDeps = deps.mutationDeps;
	if (!mutationDeps && (deps.getJob || deps.updateJob)) {
		mutationDeps = buildFacebookCalendarMutationDepsFromLegacy(deps);
	}
	if (!mutationDeps?.pocketbaseClient) {
		throw new Error('createFacebookMutationAdapter requires mutationDeps.pocketbaseClient or legacy getJob/updateJob');
	}

	return {
		channel: 'facebook',
		supportedActions: Object.freeze(['reschedule', 'cancel', 'retry']),

		supports(action) {
			return this.supportedActions.includes(String(action || '').toLowerCase());
		},

		async reschedule(req, refId, payload = {}) {
			const scheduledAt = payload.scheduledAt ?? payload.scheduled_at;
			if (!scheduledAt) {
				throw freezeError(422, 'scheduledAt is required', 'VALIDATION_ERROR');
			}

			const result = await rescheduleFn({
				req,
				jobId: refId,
				body: payload,
				deps: mutationDeps,
			});

			return calendarMutationResult(refId, result.job);
		},

		async cancel(req, refId) {
			const result = await cancelFn({
				req,
				jobId: refId,
				deps: mutationDeps,
			});

			return calendarMutationResult(refId, result.job);
		},

		async retry(req, refId) {
			const result = await retryFn({
				req,
				jobId: refId,
				deps: mutationDeps,
			});

			return calendarMutationResult(refId, result.job);
		},

		async publishNow(req, refId) {
			const result = await publishNowFn({
				req,
				jobId: refId,
				deps: mutationDeps,
			});

			return calendarMutationResult(refId, result.job);
		},
	};
}
