/**
 * Facebook publish job persistence — create job + created event with job-scoped idempotency.
 */

import { FACEBOOK_JOB_COLLECTION } from './channel-pack.js';
import { recordFacebookPublishCreatedEvent } from './publish-events.js';

export { buildFacebookPublishCreatedEventForJob } from './publish-events.js';

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

	const resolvedDeps = {
		...deps,
		pocketbaseClient,
		sanitizeCollectionPayload,
		eventCreateContext: deps.eventCreateContext || 'facebook:publish-created-event',
	};

	const jobCreatePayload = await sanitizeCollectionPayload({
		collection: FACEBOOK_JOB_COLLECTION,
		context: deps.jobCreateContext || 'facebook:create-publish-job',
		payload: prepared.jobPayload,
	});

	const job = await pocketbaseClient.collection(FACEBOOK_JOB_COLLECTION).create(jobCreatePayload);

	await recordFacebookPublishCreatedEvent({
		job,
		prepared,
		publishMode,
		deps: resolvedDeps,
	});

	return job;
}
