/**
 * Facebook Channel Pack — shared publish job mutations (F5-2).
 * Used by channel routes and calendar mutation adapter (F5-2/F5-3).
 */

import { FACEBOOK_JOB_COLLECTION } from './channel-pack.js';
import { validateFacebookDestinationPost } from './destinations.js';
import { mapFacebookPublishJobDto } from './publish.js';
import {
	buildFacebookPublishCancelledEventPayload,
	buildFacebookPublishRetryManualEventPayload,
	buildFacebookPublishScheduleUpdatedEventPayload,
	recordFacebookPublishUserEvent,
} from './publish-events.js';
import { resolveFacebookScheduleTime } from './schedule.js';

function mutationError(status, message, errorCode = 'VALIDATION_ERROR') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function recordFieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

async function resolveMutationDeps(deps = {}) {
	let pocketbaseClient = deps.pocketbaseClient;
	if (!pocketbaseClient) {
		pocketbaseClient = (await import('../../utils/pocketbaseClient.js')).default;
	}

	let sanitizeCollectionPayload = deps.sanitizeCollectionPayload;
	if (!sanitizeCollectionPayload) {
		({ sanitizeCollectionPayload } = await import('../../utils/pocketbase-safe-query.js'));
	}

	let recordBelongsToWorkspace = deps.recordBelongsToWorkspace;
	let andWorkspaceScope = deps.andWorkspaceScope;
	if (!recordBelongsToWorkspace || !andWorkspaceScope) {
		({ recordBelongsToWorkspace, andWorkspaceScope } = await import('../workspace-ownership.js'));
	}

	let getOwnedFacebookAccountById = deps.getOwnedFacebookAccountById;
	if (!getOwnedFacebookAccountById) {
		({ getOwnedFacebookAccountById } = await import('./api.js'));
	}

	return {
		pocketbaseClient,
		sanitizeCollectionPayload,
		recordBelongsToWorkspace,
		andWorkspaceScope,
		getOwnedFacebookAccountById,
	};
}

function resolveOwner(req) {
	return req?.workspaceOwnerId || req?.pocketbaseUserId || '';
}

async function loadFacebookPageRecord({
	pocketbaseClient,
	andWorkspaceScope,
	req,
	owner,
	accountId,
	pageId,
}) {
	const filter = req
		? andWorkspaceScope(req, pocketbaseClient.filter('account = {:account} && page_id = {:pageId}', {
			account: accountId,
			pageId,
		}))
		: pocketbaseClient.filter('owner = {:owner} && account = {:account} && page_id = {:pageId}', {
			owner,
			account: accountId,
			pageId,
		});

	return pocketbaseClient.collection('facebook_pages').getFirstListItem(filter, { requestKey: null }).catch(() => null);
}

export async function assertOwnedFacebookPublishJob({ req, jobId, deps = {} }) {
	const resolved = await resolveMutationDeps(deps);
	const owner = resolveOwner(req);
	const id = String(jobId || '').trim();
	if (!id) {
		throw mutationError(404, 'Facebook publish job not found', 'FACEBOOK_PUBLISH_JOB_NOT_FOUND');
	}

	const job = await resolved.pocketbaseClient.collection(FACEBOOK_JOB_COLLECTION).getOne(id, { requestKey: null }).catch(() => null);
	if (!job) {
		throw mutationError(404, 'Facebook publish job not found', 'FACEBOOK_PUBLISH_JOB_NOT_FOUND');
	}
	if (job.owner !== owner) {
		throw mutationError(403, 'You do not have access to this Facebook publish job', 'FORBIDDEN');
	}
	if (req && !resolved.recordBelongsToWorkspace(req, job)) {
		throw mutationError(403, 'You do not have access to this Facebook publish job', 'FORBIDDEN');
	}

	return { job, owner, ...resolved };
}

async function updateFacebookPublishJob({
	job,
	updates,
	context,
	deps,
}) {
	const { pocketbaseClient, sanitizeCollectionPayload } = await resolveMutationDeps(deps);
	const payload = await sanitizeCollectionPayload({
		collection: FACEBOOK_JOB_COLLECTION,
		context,
		payload: updates,
	});
	return pocketbaseClient.collection(FACEBOOK_JOB_COLLECTION).update(job.id, payload);
}

async function emitUserPublishEvent({ job, eventRecord, deps }) {
	await recordFacebookPublishUserEvent({
		job,
		eventRecord,
		deps,
	});
}

/**
 * PATCH semantics — reschedule or edit destination on a scheduled job.
 */
export async function rescheduleFacebookPublishJob({ req, jobId, body = {}, deps = {} } = {}) {
	const { job, ...resolved } = await assertOwnedFacebookPublishJob({ req, jobId, deps });

	if (job.status !== 'scheduled') {
		throw mutationError(422, 'Only scheduled Facebook jobs can be rescheduled', 'INVALID_STATUS');
	}

	const updates = {};
	const payload = body && typeof body === 'object' ? body : {};

	if ('scheduledAt' in payload || 'scheduled_at' in payload || 'timezone' in payload) {
		const timezone = String(
			payload.timezone
			|| job.scheduled_timezone
			|| job.timezone
			|| 'UTC',
		).trim() || 'UTC';
		const scheduledAt = payload.scheduledAt ?? payload.scheduled_at ?? job.scheduled_at;
		updates.timezone = timezone;
		updates.scheduled_timezone = timezone;
		updates.scheduled_at = resolveFacebookScheduleTime({ scheduledAt, timezone });
	}

	const nextAccountId = 'accountId' in payload
		? String(payload.accountId || '').trim()
		: recordFieldId(job.account);
	const nextPageId = 'pageId' in payload
		? String(payload.pageId || '').trim()
		: String(job.page_id || job.pageId || '').trim();

	if ('accountId' in payload || 'pageId' in payload) {
		if (!nextAccountId) {
			throw mutationError(422, 'accountId is required', 'FACEBOOK_ACCOUNT_ID_REQUIRED');
		}
		if (!nextPageId) {
			throw mutationError(422, 'pageId is required', 'FACEBOOK_PAGE_ID_REQUIRED');
		}

		const validation = await validateFacebookDestinationPost({
			owner: job.owner,
			accountId: nextAccountId,
			pageId: nextPageId,
			post: {
				message: job.message,
				imageUrl: job.image_url || job.imageUrl,
				linkUrl: job.destination_url || job.destinationUrl,
			},
			req,
			deps,
		});

		if (!validation.ok) {
			throw mutationError(
				422,
				validation.errors?.[0] || 'Facebook destination validation failed',
				'FACEBOOK_VALIDATION_FAILED',
			);
		}

		const account = await resolved.getOwnedFacebookAccountById({
			owner: job.owner,
			accountId: nextAccountId,
			req,
		});
		if (!account) {
			throw mutationError(404, 'Facebook account not found', 'FACEBOOK_ACCOUNT_NOT_FOUND');
		}

		const pageRecord = await loadFacebookPageRecord({
			pocketbaseClient: resolved.pocketbaseClient,
			andWorkspaceScope: resolved.andWorkspaceScope,
			req,
			owner: job.owner,
			accountId: nextAccountId,
			pageId: validation.normalized?.pageId || nextPageId,
		});
		if (!pageRecord) {
			throw mutationError(404, 'Facebook destination not found', 'FACEBOOK_DESTINATION_NOT_FOUND');
		}

		const pageName = String(pageRecord.name || pageRecord.page_name || '').trim();
		updates.account = nextAccountId;
		updates.page_id = validation.normalized?.pageId || nextPageId;
		updates.page_name = pageName;
		updates.page_label = pageName;
		updates.account_label = String(
			account.label || account.account_name || account.username || '',
		).trim();
		if (pageRecord.id) updates.page = pageRecord.id;
	}

	if (Object.keys(updates).length === 0) {
		return { job: mapFacebookPublishJobDto(job) };
	}

	updates.status = 'scheduled';

	const updated = await updateFacebookPublishJob({
		job,
		updates,
		context: 'facebook:patch-publish-job',
		deps: resolved,
	});

	await emitUserPublishEvent({
		job: updated,
		eventRecord: buildFacebookPublishScheduleUpdatedEventPayload({
			job: updated,
			updates,
		}),
		deps: resolved,
	});

	return { job: mapFacebookPublishJobDto(updated) };
}

export async function cancelFacebookPublishJob({ req, jobId, deps = {} } = {}) {
	const { job, ...resolved } = await assertOwnedFacebookPublishJob({ req, jobId, deps });

	if (!['scheduled', 'failed'].includes(job.status)) {
		throw mutationError(422, 'Only scheduled or failed jobs can be cancelled', 'INVALID_STATUS');
	}

	const updated = await updateFacebookPublishJob({
		job,
		updates: {
			status: 'cancelled',
			next_retry_at: '',
			last_error: 'Cancelled by user',
		},
		context: 'facebook:cancel-publish-job',
		deps: resolved,
	});

	await emitUserPublishEvent({
		job: updated,
		eventRecord: buildFacebookPublishCancelledEventPayload({ job: updated }),
		deps: resolved,
	});

	return { job: mapFacebookPublishJobDto(updated) };
}

export async function retryFacebookPublishJob({ req, jobId, deps = {} } = {}) {
	const { job, ...resolved } = await assertOwnedFacebookPublishJob({ req, jobId, deps });

	if (!['failed', 'cancelled'].includes(job.status)) {
		throw mutationError(422, 'Only failed or cancelled jobs can be retried', 'INVALID_STATUS');
	}

	const now = new Date().toISOString();
	const scheduledAt = job.scheduled_at || job.scheduledAt || now;

	const updated = await updateFacebookPublishJob({
		job,
		updates: {
			status: 'scheduled',
			scheduled_at: scheduledAt,
			next_retry_at: '',
			last_error: '',
			claim_token: '',
			attempt_count: 0,
		},
		context: 'facebook:retry-publish-job',
		deps: resolved,
	});

	await emitUserPublishEvent({
		job: updated,
		eventRecord: buildFacebookPublishRetryManualEventPayload({ job: updated }),
		deps: resolved,
	});

	return { job: mapFacebookPublishJobDto(updated) };
}

export async function publishNowFacebookPublishJob({ req, jobId, deps = {} } = {}) {
	const { job, ...resolved } = await assertOwnedFacebookPublishJob({ req, jobId, deps });

	if (!['scheduled', 'failed'].includes(job.status)) {
		throw mutationError(422, 'Only scheduled or failed jobs can be published now', 'INVALID_STATUS');
	}

	const now = new Date().toISOString();
	const updated = await updateFacebookPublishJob({
		job,
		updates: {
			status: 'scheduled',
			scheduled_at: now,
			next_retry_at: '',
			last_error: '',
		},
		context: 'facebook:publish-now-job',
		deps: resolved,
	});

	await emitUserPublishEvent({
		job: updated,
		eventRecord: buildFacebookPublishScheduleUpdatedEventPayload({
			job: updated,
			updates: { scheduled_at: now },
			publishNow: true,
		}),
		deps: resolved,
	});

	return { job: mapFacebookPublishJobDto(updated) };
}
