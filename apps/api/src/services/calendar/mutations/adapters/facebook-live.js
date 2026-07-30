/**
 * Live PocketBase wiring for the Facebook calendar mutation adapter.
 *
 * Collection may be absent until Facebook publish pipeline ships —
 * getJob returns null (404 via adapter); updateJob will throw if called
 * against a missing collection (same as any missing SoT write).
 */

import pocketbaseClient from '../../../../utils/pocketbaseClient.js';
import { sanitizeCollectionPayload } from '../../../../utils/pocketbase-safe-query.js';
import { resolveScheduledAtUtc } from '../../../../utils/timezone.js';
import { getWorkspaceActor } from '../../../workspace-ownership.js';
import { FACEBOOK_JOB_REF_TYPE } from '../../providers/facebook.js';
import { createFacebookMutationAdapter } from './facebook.js';

export function createLiveFacebookMutationAdapter() {
	return createFacebookMutationAdapter({
		getOwner: (req) => getWorkspaceActor(req).workspaceOwnerId || req.pocketbaseUserId,
		getJob: async (jobId) => pocketbaseClient.collection(FACEBOOK_JOB_REF_TYPE).getOne(jobId).catch(() => null),
		updateJob: async (jobId, payload) => pocketbaseClient.collection(FACEBOOK_JOB_REF_TYPE).update(jobId, payload),
		sanitize: sanitizeCollectionPayload,
		resolveScheduledAtUtc,
	});
}
