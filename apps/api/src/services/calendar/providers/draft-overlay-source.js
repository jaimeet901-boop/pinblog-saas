/**
 * Live PocketBase source for Studio draft overlay projection.
 * Isolated so facade unit tests never import this module.
 */

import pocketbaseClient from '../../../utils/pocketbaseClient.js';
import { andWorkspaceScope } from '../../workspace-ownership.js';

/**
 * Fetch workspace-scoped Studio drafts (ai_pins status=draft).
 * includeDrafts / channel filtering is applied by the draft overlay provider.
 */
export async function fetchStudioDraftsForCalendar(ctx = {}) {
	const req = ctx.req;
	if (!req) return [];

	const scope = andWorkspaceScope(req, 'status = "draft"');
	const pins = await pocketbaseClient.collection('ai_pins').getFullList({
		filter: scope,
		sort: '-updated',
		requestKey: null,
	}).catch(() => []);

	return pins || [];
}
