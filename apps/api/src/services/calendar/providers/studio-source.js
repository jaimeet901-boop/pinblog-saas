/**
 * Live PocketBase source for Content Studio calendar projection.
 * Isolated so facade unit tests never import this module.
 */

import pocketbaseClient from '../../../utils/pocketbaseClient.js';
import { andWorkspaceScope } from '../../workspace-ownership.js';

/**
 * Fetch workspace-scoped ai_pins that carry a schedule time.
 * Draft filtering / status / range filtering is applied by the provider + facade.
 */
export async function fetchStudioPinsForCalendar(ctx = {}) {
	const req = ctx.req;
	if (!req) return [];

	const scope = andWorkspaceScope(req);
	const pins = await pocketbaseClient.collection('ai_pins').getFullList({
		filter: scope,
		sort: 'scheduled_at',
		requestKey: null,
	}).catch(() => []);

	return (pins || []).filter((pin) => pin?.scheduled_at);
}
