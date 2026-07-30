/**
 * Live PocketBase source for calendar_events manual overlay.
 * Isolated so facade unit tests never import this module.
 */

import pocketbaseClient from '../../../utils/pocketbaseClient.js';

export async function fetchCalendarEventsForOverlay(ctx = {}) {
	const req = ctx.req;
	const workspaceId = req?.workspace?.id;
	if (!workspaceId) return [];

	const events = await pocketbaseClient.collection('calendar_events').getFullList({
		filter: pocketbaseClient.filter('workspace = {:ws}', { ws: workspaceId }),
		sort: 'scheduled_at',
		requestKey: null,
	}).catch(() => []);

	return events || [];
}
