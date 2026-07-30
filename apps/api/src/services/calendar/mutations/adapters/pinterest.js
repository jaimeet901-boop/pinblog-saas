/**
 * Pinterest channel mutation adapter (pure factory).
 * Calendar mutation router dispatches here; this module owns Pinterest write rules.
 * Pass deps explicitly — live PocketBase wiring lives in pinterest-live.js.
 */

import { mapPinterestJobToScheduledItem } from '../../providers/pinterest.js';

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
		throw freezeError(404, 'Scheduled job not found', 'NOT_FOUND');
	}
	if (job.owner !== owner) {
		throw freezeError(403, 'You do not have access to this scheduled job', 'FORBIDDEN');
	}
	return { job, owner };
}

/**
 * @param {{
 *   getJob: Function,
 *   updateJob: Function,
 *   updatePin?: Function,
 *   createEvent?: Function,
 *   sanitize: Function,
 *   resolveScheduledAtUtc: Function,
 *   assertPinterestConnected: Function,
 *   getOwner?: Function,
 * }} deps
 */
export function createPinterestMutationAdapter(deps) {
	if (!deps?.getJob || !deps?.updateJob || !deps?.sanitize || !deps?.resolveScheduledAtUtc || !deps?.assertPinterestConnected) {
		throw new Error('createPinterestMutationAdapter requires getJob, updateJob, sanitize, resolveScheduledAtUtc, assertPinterestConnected');
	}

	const d = {
		updatePin: async () => null,
		createEvent: async () => null,
		...deps,
	};

	return {
		channel: 'pinterest',
		supportedActions: Object.freeze(['reschedule', 'cancel', 'retry']),

		supports(action) {
			return this.supportedActions.includes(String(action || '').toLowerCase());
		},

		async reschedule(req, refId, payload = {}) {
			const { job, owner } = await assertOwnedJob(d, req, refId);
			if (job.status !== 'scheduled') {
				throw freezeError(422, 'Only scheduled jobs can be edited');
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
				collection: 'pinterest_publish_jobs',
				context: 'calendar:pinterest:reschedule',
				payload: {
					timezone,
					scheduled_at: scheduledAtUtc,
				},
			});

			const updated = await d.updateJob(job.id, sanitizedUpdates);
			if (job.ai_pin) {
				await d.updatePin(job.ai_pin, {
					scheduled_at: scheduledAtUtc,
					scheduled_timezone: timezone,
				}).catch(() => null);
			}
			await d.createEvent({
				owner,
				job: updated.id,
				event_type: 'schedule_updated',
				message: 'Scheduled job updated via Calendar mutation router',
				payload: sanitizedUpdates,
			}).catch(() => null);

			return {
				channel: 'pinterest',
				refId: updated.id,
				item: mapPinterestJobToScheduledItem(updated),
			};
		},

		async cancel(req, refId) {
			const { job, owner } = await assertOwnedJob(d, req, refId);
			if (!['scheduled', 'failed'].includes(job.status)) {
				throw freezeError(422, 'Only scheduled or failed jobs can be cancelled');
			}

			const cancelledPayload = await d.sanitize({
				collection: 'pinterest_publish_jobs',
				context: 'calendar:pinterest:cancel',
				payload: {
					status: 'cancelled',
					next_retry_at: '',
				},
			});

			const updated = await d.updateJob(job.id, cancelledPayload);
			if (job.ai_pin) {
				await d.updatePin(job.ai_pin, {
					status: 'draft',
					scheduled_at: '',
					scheduled_timezone: '',
					publish_job_id: '',
					pinterest_account_id: '',
					pinterest_account_label: '',
					pinterest_board_id: '',
					pinterest_board_name: '',
					publish_error: '',
				}).catch(() => null);
			}
			await d.createEvent({
				owner,
				job: updated.id,
				event_type: 'cancelled',
				message: 'Scheduled job cancelled via Calendar mutation router',
				payload: null,
			}).catch(() => null);

			return {
				channel: 'pinterest',
				refId: updated.id,
				item: mapPinterestJobToScheduledItem(updated),
			};
		},

		async retry(req, refId) {
			const { job, owner } = await assertOwnedJob(d, req, refId);
			if (job.status !== 'failed') {
				throw freezeError(422, 'Only failed jobs can be retried manually');
			}

			await d.assertPinterestConnected(owner, job.account, req);

			const now = new Date().toISOString();
			const retryPayload = await d.sanitize({
				collection: 'pinterest_publish_jobs',
				context: 'calendar:pinterest:retry',
				payload: {
					status: 'scheduled',
					scheduled_at: now,
					next_retry_at: now,
					last_error: '',
				},
			});

			const updated = await d.updateJob(job.id, retryPayload);
			if (job.ai_pin) {
				await d.updatePin(job.ai_pin, {
					status: 'scheduled',
					scheduled_at: now,
					publish_error: '',
				}).catch(() => null);
			}
			await d.createEvent({
				owner,
				job: updated.id,
				event_type: 'retry_manual',
				message: 'Failed job moved back to queue via Calendar mutation router',
				payload: null,
			}).catch(() => null);

			return {
				channel: 'pinterest',
				refId: updated.id,
				item: mapPinterestJobToScheduledItem(updated),
			};
		},
	};
}
