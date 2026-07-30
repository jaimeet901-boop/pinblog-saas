/**
 * Live PocketBase wiring for the WordPress calendar mutation adapter.
 */

import pocketbaseClient from '../../../../utils/pocketbaseClient.js';
import { sanitizeCollectionPayload } from '../../../../utils/pocketbase-safe-query.js';
import { resolveScheduledAtUtc } from '../../../../utils/timezone.js';
import { getWorkspaceActor } from '../../../workspace-ownership.js';
import { createWordpressMutationAdapter } from './wordpress.js';

export function createLiveWordpressMutationAdapter() {
	return createWordpressMutationAdapter({
		getOwner: (req) => getWorkspaceActor(req).workspaceOwnerId || req.pocketbaseUserId,
		getJob: async (jobId) => pocketbaseClient.collection('publish_jobs').getOne(jobId).catch(() => null),
		updateJob: async (jobId, payload) => pocketbaseClient.collection('publish_jobs').update(jobId, payload),
		sanitize: sanitizeCollectionPayload,
		resolveScheduledAtUtc,
	});
}
