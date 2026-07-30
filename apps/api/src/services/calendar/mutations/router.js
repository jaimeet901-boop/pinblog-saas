/**
 * Unified Calendar Mutation Router (Phase C5).
 *
 * Channel-agnostic dispatch: Calendar never performs channel write logic.
 * Adapters own channel job mutations; PPJ / future job tables remain write SoT.
 */

import { CALENDAR_CONSOLIDATION_PHASE } from '../calendar-architecture.js';
import {
	assertCalendarMutationAction,
	buildCalendarEventId,
	parseCalendarEventId,
} from './ids.js';

function freezeError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

/**
 * @param {Array<{ channel: string, supports: Function, reschedule?: Function, cancel?: Function, retry?: Function }>} adapters
 */
export function createMutationRouter(adapters = []) {
	const byChannel = new Map();
	for (const adapter of adapters) {
		const channel = String(adapter?.channel || '').trim().toLowerCase();
		if (!channel) continue;
		byChannel.set(channel, adapter);
	}

	return {
		listChannels() {
			return [...byChannel.keys()];
		},

		getAdapter(channel) {
			return byChannel.get(String(channel || '').trim().toLowerCase()) || null;
		},

		/**
		 * @param {object} req
		 * @param {{ eventId: string, action: string, payload?: object }} input
		 */
		async dispatch(req, input = {}) {
			const action = assertCalendarMutationAction(input.action);
			const parsed = parseCalendarEventId(input.eventId);
			const adapter = byChannel.get(parsed.channel);

			if (!adapter) {
				throw freezeError(
					422,
					`No calendar mutation adapter registered for channel "${parsed.channel}"`,
					'CHANNEL_NOT_SUPPORTED',
				);
			}

			if (typeof adapter.supports === 'function' && !adapter.supports(action)) {
				throw freezeError(
					422,
					`Channel "${parsed.channel}" does not support action "${action}"`,
					'ACTION_NOT_SUPPORTED',
				);
			}

			const handler = adapter[action];
			if (typeof handler !== 'function') {
				throw freezeError(
					422,
					`Channel "${parsed.channel}" does not support action "${action}"`,
					'ACTION_NOT_SUPPORTED',
				);
			}

			const result = await handler.call(adapter, req, parsed.refId, input.payload || {});
			const refId = result?.refId || parsed.refId;
			const eventId = buildCalendarEventId(parsed.channel, refId);

			return {
				ok: true,
				action,
				channel: parsed.channel,
				refId,
				eventId,
				item: result?.item || null,
				meta: {
					phase: CALENDAR_CONSOLIDATION_PHASE,
					source: 'unified_calendar_mutation_router',
					channelAgnostic: true,
					writeSourceOfTruth: 'channel_job_collections',
				},
			};
		},
	};
}

/**
 * Product entrypoints used by workspace routes.
 */
export async function dispatchCalendarMutation(req, { eventId, action, payload } = {}, options = {}) {
	if (typeof options.assertCapability === 'function') {
		options.assertCapability(req, 'workspace.calendar.manage');
	} else {
		const { assertCapability } = await import('../../workspace-rbac.js');
		assertCapability(req, 'workspace.calendar.manage');
	}

	let adapters = options.adapters;
	if (!adapters) {
		const { createDefaultMutationAdapters } = await import('./registry.js');
		adapters = createDefaultMutationAdapters();
	}

	const router = createMutationRouter(adapters);
	return router.dispatch(req, { eventId, action, payload });
}

export async function rescheduleCalendarScheduledItem(req, eventId, payload = {}, options = {}) {
	return dispatchCalendarMutation(req, { eventId, action: 'reschedule', payload }, options);
}

export async function cancelCalendarScheduledItem(req, eventId, payload = {}, options = {}) {
	return dispatchCalendarMutation(req, { eventId, action: 'cancel', payload }, options);
}

export async function retryCalendarScheduledItem(req, eventId, payload = {}, options = {}) {
	return dispatchCalendarMutation(req, { eventId, action: 'retry', payload }, options);
}
