/**
 * Live PocketBase wiring for the Facebook calendar mutation adapter.
 *
 * Delegates all writes to shared job-mutations.js (F5-3).
 */

import pocketbaseClient from '../../../../utils/pocketbaseClient.js';
import { andWorkspaceScope, getWorkspaceActor, recordBelongsToWorkspace } from '../../../workspace-ownership.js';
import { createFacebookMutationAdapter } from './facebook.js';

export function createLiveFacebookMutationAdapter() {
	return createFacebookMutationAdapter({
		getOwner: (req) => getWorkspaceActor(req).workspaceOwnerId || req.pocketbaseUserId,
		mutationDeps: {
			pocketbaseClient,
			recordBelongsToWorkspace,
			andWorkspaceScope,
		},
	});
}
