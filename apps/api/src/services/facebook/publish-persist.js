/**
 * Facebook publish job persistence — create job + created event with job-scoped idempotency.
 */

import { FACEBOOK_JOB_COLLECTION } from './channel-pack.js';
import { buildFacebookPublishCreatedEventPayload } from './publish-events.js';

/**
 * Build a created event record after the job id is known (closes W-1 idempotency gap).
 *
 * @param {object} prepared
 * @param {string} jobId
 * @param {{ publishMode?: string }} [options]
 */
export function buildFacebookPublishCreatedEventForJob(prepared, jobId, { publishMode = 'now' } = {}) {
	const jobPayload = prepared?.jobPayload || {};
	return buildFacebookPublishCreatedEventPayload({
		owner: jobPayload.owner,
		workspaceId: jobPayload.workspace,
		jobId,
		accountId: jobPayload.account,
		pageId: jobPayload.page_id,
		aiPinId: jobPayload.ai_pin,
		scheduledAt: jobPayload.scheduled_at,
		timezone: jobPayload.scheduled_timezone || jobPayload.timezone || 'UTC',
		publishMode,
	});
}

/**
 * Persist facebook_publish_jobs row and matching created event.
 *
 * @param {{
 *   prepared: object,
 *   publishMode?: string,
 *   deps?: object,
 * }} input
 */
export async function persistFacebookPublishJobWithCreatedEvent({
	prepared,
	publishMode = 'now',
	deps = {},
} = {}) {
	let pocketbaseClient = deps.pocketbaseClient;
	if (!pocketbaseClient) {
		pocketbaseClient = (await import('../../utils/pocketbaseClient.js')).default;
	}

	let sanitizeCollectionPayload = deps.sanitizeCollectionPayload;
	if (!sanitizeCollectionPayload) {
		({ sanitizeCollectionPayload } = await import('../../utils/pocketbase-safe-query.js'));
	}

	const jobCreatePayload = await sanitizeCollectionPayload({
		collection: FACEBOOK_JOB_COLLECTION,
		context: deps.jobCreateContext || 'facebook:create-publish-job',
		payload: prepared.jobPayload,
	});

	const job = await pocketbaseClient.collection(FACEBOOK_JOB_COLLECTION).create(jobCreatePayload);

	const eventRecord = buildFacebookPublishCreatedEventForJob(prepared, job.id, { publishMode });
	const eventCreatePayload = await sanitizeCollectionPayload({
		collection: 'facebook_publish_events',
		context: deps.eventCreateContext || 'facebook:publish-created-event',
		payload: eventRecord,
	});

	await pocketbaseClient.collection('facebook_publish_events').create(eventCreatePayload);

	return job;
}
