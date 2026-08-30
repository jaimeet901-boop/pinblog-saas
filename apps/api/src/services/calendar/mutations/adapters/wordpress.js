/**
 * WordPress channel mutation adapter (pure factory).
 * Calendar mutation router dispatches here; this module owns WordPress write rules.
 * Pass deps explicitly — live PocketBase wiring lives in wordpress-live.js.
 *
 * Collection: publish_jobs (WordPress).
 */

import { mapWordpressJobToScheduledItem } from '../../providers/wordpress.js';

function freezeError(status, message, errorCode = 'VALIDATION_ERROR') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function resolveOwner(req, deps) {
	if (typeof deps.getOwner === 'function') return deps.getOwner(req);
	return req?.workspaceOwnerId || req?.pocketbaseUserId || '';
}

async function assertOwnedJob(deps, req, jobId) {
	const owner = resolveOwner(req, deps);
	const job = await deps.getJob(jobId);
	if (!job) {
		throw freezeError(404, 'Publish job not found', 'NOT_FOUND');
	}
	if (job.owner !== owner) {
		throw freezeError(403, 'You do not have access to this publish job', 'FORBIDDEN');
	}
	return { job, owner };
}

/**
 * @param {{
 *   getJob: Function,
 *   updateJob: Function,
 *   sanitize?: Function,
 *   resolveScheduledAtUtc: Function,
 *   getOwner?: Function,
 * }} deps
 */
export function createWordpressMutationAdapter(deps) {
	if (!deps?.getJob || !deps?.updateJob || !deps?.resolveScheduledAtUtc) {
		throw new Error('createWordpressMutationAdapter requires getJob, updateJob, resolveScheduledAtUtc');
	}

	const d = {
		sanitize: async ({ payload }) => payload,
		...deps,
	};

	return {
		channel: 'wordpress',
		supportedActions: Object.freeze(['reschedule', 'cancel', 'retry']),

		supports(action) {
			return this.supportedActions.includes(String(action || '').toLowerCase());
		},

		async reschedule(req, refId, payload = {}) {
			const { job } = await assertOwnedJob(d, req, refId);
			if (job.status !== 'scheduled') {
				throw freezeError(422, 'Only scheduled WordPress jobs can be rescheduled');
			}

			const scheduledAt = payload.scheduledAt ?? payload.scheduled_at;
			if (!scheduledAt) {
				throw freezeError(422, 'scheduledAt is required');
			}
			const timezone = String(payload.timezone || job.timezone || 'UTC').trim() || 'UTC';
			const scheduledAtUtc = d.resolveScheduledAtUtc({
				scheduledAt,
				timezone,
			});

			const sanitizedUpdates = await d.sanitize({
				collection: 'publish_jobs',
				context: 'calendar:wordpress:reschedule',
				payload: {
					timezone,
					scheduled_at: scheduledAtUtc,
					status: 'scheduled',
				},
			});

			const updated = await d.updateJob(job.id, sanitizedUpdates);
			return {
				channel: 'wordpress',
				refId: updated.id,
				item: mapWordpressJobToScheduledItem(updated),
			};
		},

		async cancel(req, refId) {
			const { job } = await assertOwnedJob(d, req, refId);
			if (job.status === 'publishing') {
				throw freezeError(409, 'Job is already publishing and cannot be cancelled', 'JOB_PUBLISHING');
			}
			if (['published', 'cancelled'].includes(job.status)) {
				throw freezeError(400, 'Job cannot be cancelled', 'INVALID_STATUS');
			}

			const cancelledPayload = await d.sanitize({
				collection: 'publish_jobs',
				context: 'calendar:wordpress:cancel',
				payload: {
					status: 'cancelled',
					completed_at: new Date().toISOString(),
					last_error: 'Cancelled by user',
				},
			});

			const updated = await d.updateJob(job.id, cancelledPayload);
			return {
				channel: 'wordpress',
				refId: updated.id,
				item: mapWordpressJobToScheduledItem(updated),
			};
		},

		async retry(req, refId) {
			const { job } = await assertOwnedJob(d, req, refId);
			if (!['failed', 'cancelled'].includes(job.status)) {
				throw freezeError(400, 'Only failed or cancelled jobs can be retried', 'INVALID_STATUS');
			}

			const now = new Date().toISOString();
			const hasSchedule = Boolean(job.scheduled_at || job.scheduledAt);
			const retryPayload = await d.sanitize({
				collection: 'publish_jobs',
				context: 'calendar:wordpress:retry',
				payload: {
					status: hasSchedule ? 'scheduled' : 'queued',
					...(hasSchedule ? { scheduled_at: job.scheduled_at || now } : {}),
					progress: 0,
					dead_letter: false,
					last_error: '',
					next_retry_at: '',
					claim_token: '',
					attempt_count: 0,
				},
			});

			const updated = await d.updateJob(job.id, retryPayload);
			return {
				channel: 'wordpress',
				refId: updated.id,
				item: mapWordpressJobToScheduledItem(updated),
			};
		},
	};
}
