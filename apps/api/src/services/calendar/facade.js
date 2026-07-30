/**
 * Unified Calendar Facade (Phase C1).
 *
 * Channel-agnostic read API: projects provider Scheduled Items into one feed.
 * Does not own channel jobs. Does not contain Pinterest/WordPress/Facebook logic.
 *
 * Existing APIs remain unchanged:
 * - GET /pinterest/calendar (legacy channel month list)
 * - GET /workspace/v1/calendar (legacy calendar_events only — C10: no PPJ merge)
 *
 * Product:
 * - GET /workspace/v1/calendar/events → listUnifiedCalendarEvents
 */

import { CALENDAR_CONSOLIDATION_PHASE } from './calendar-architecture.js';
import { matchesFacadeFilters, parseCalendarFacadeQuery } from './query.js';
import { assertScheduledItemContract, normalizeScheduledItem } from './scheduled-item.js';

/**
 * Aggregate Scheduled Items from providers.
 * Pure orchestration — providers are injected for testability.
 *
 * @param {object} ctx  { req, workspaceId, ownerId }
 * @param {object} filters  from parseCalendarFacadeQuery
 * @param {Array<{ channel: string, listScheduledItems: Function }>} providers
 */
export async function collectScheduledItems(ctx, filters, providers = []) {
	const selected = filters.channels.length
		? providers.filter((provider) => filters.channels.includes(String(provider.channel || '').toLowerCase()))
		: providers;

	const batches = await Promise.all(
		selected.map(async (provider) => {
			try {
				const items = await provider.listScheduledItems(ctx, filters);
				return Array.isArray(items) ? items : [];
			} catch {
				return [];
			}
		}),
	);

	const byId = new Map();
	for (const item of batches.flat()) {
		const normalized = normalizeScheduledItem(item);
		try {
			assertScheduledItemContract(normalized);
		} catch {
			continue;
		}
		if (!matchesFacadeFilters(normalized, filters)) continue;
		byId.set(normalized.id, normalized);
	}

	return [...byId.values()].sort(
		(a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt),
	);
}

/**
 * Product Calendar read entrypoint (facade).
 *
 * @param {import('express').Request} req
 * @param {object} query
 * @param {{ providers?: object[], parseQuery?: Function }} [options]
 */
export async function listUnifiedCalendarEvents(req, query = {}, options = {}) {
	if (typeof options.assertCapability === 'function') {
		options.assertCapability(req, 'workspace.read');
	} else {
		const { assertCapability } = await import('../workspace-rbac.js');
		assertCapability(req, 'workspace.read');
	}

	const parseQuery = options.parseQuery || parseCalendarFacadeQuery;
	const filters = parseQuery(query);

	let providers = options.providers;
	if (!providers) {
		const { createDefaultCalendarProviders } = await import('./providers/registry.js');
		providers = createDefaultCalendarProviders();
	}

	const items = await collectScheduledItems(
		{
			req,
			workspaceId: req.workspace?.id || '',
			ownerId: req.pocketbaseUserId || '',
		},
		filters,
		providers,
	);

	return {
		items,
		month: filters.month,
		from: filters.from,
		to: filters.to,
		filters: {
			websiteId: filters.websiteId || null,
			channels: filters.channels,
			statuses: filters.statuses,
			includeManual: filters.includeManual,
		},
		meta: {
			phase: CALENDAR_CONSOLIDATION_PHASE,
			source: 'unified_calendar_facade',
			channelAgnostic: true,
		},
	};
}
