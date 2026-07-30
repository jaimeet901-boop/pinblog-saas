/**
 * Calendar architecture lock (Phase C0).
 *
 * Product Calendar = channel-agnostic Unified Calendar Facade (C1+).
 * Channel job tables remain write SoT. calendar_events is demoted.
 *
 * See docs/calendar-architecture.md.
 */

/** Lightweight error matching apps/api httpError shape (avoid importing PocketBase-backed middleware). */
function freezeError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

/** Current consolidation phase. Do not advance without explicit approval. */
export const CALENDAR_CONSOLIDATION_PHASE = 'C10';

/** Product read API introduced in C1 (UI cutover is C2). */
export const UNIFIED_CALENDAR_EVENTS_PATH = '/workspace/v1/calendar/events';

/**
 * Channel job collections that own publish/schedule writes.
 * Calendar must project these via adapters — never dual-write into calendar_events.
 */
export const CHANNEL_JOB_REF_TYPES = Object.freeze([
	'pinterest_publish_jobs',
	'publish_jobs',
	'wordpress_publish_jobs',
	'facebook_publish_jobs',
]);

/**
 * Only these modules may call calendar_events create/update/delete.
 * Add entries only after architecture review (see docs/calendar-architecture.md).
 */
export const CALENDAR_EVENTS_WRITE_ALLOWLIST = Object.freeze([
	'apps/api/src/services/workspace-calendar.js',
]);

/**
 * Known readers of calendar_events (inventory; not a security boundary).
 */
export const CALENDAR_EVENTS_READERS = Object.freeze([
	'apps/api/src/services/workspace-calendar.js',
	'apps/api/src/services/website-control-center.js',
	'apps/api/src/services/calendar/providers/manual-overlay-source.js',
]);

/**
 * Current dual calendar surfaces (C0 inventory).
 */
export const CALENDAR_SYSTEMS = Object.freeze({
	uiCalendar: Object.freeze({
		id: 'ui_calendar',
		ui: '/app/calendar',
		readApi: 'GET /workspace/v1/calendar/events',
		writeApis: [
			'POST /workspace/v1/calendar/events/:eventId/{reschedule,cancel,retry}',
			'POST /pinterest/jobs/:id/*',
			'POST /wordpress/jobs/:id/*',
		],
		store: 'channel_job_providers',
		channelSpecific: false,
		notes: 'C10: Unified Calendar complete; channel adapters + facade; no CE publish merge',
	}),
	unifiedFacade: Object.freeze({
		id: 'unified_calendar_facade',
		ui: '/app/calendar',
		readApi: 'GET /workspace/v1/calendar/events',
		writeApis: ['POST /workspace/v1/calendar/events/:eventId/{reschedule,cancel,retry}'],
		store: 'channel_job_providers',
		channelSpecific: false,
		notes: 'Sole product Calendar read/mutation API (C10 finalized)',
	}),
	dashboardCalendar: Object.freeze({
		id: 'dashboard_calendar',
		ui: '/app/dashboard',
		readApi: 'GET /workspace/v1/dashboard → calendarJobs via facade',
		writeApis: [],
		store: 'channel_job_providers',
		channelSpecific: false,
		notes: 'Same product calendar month query as CalendarPage; CE-first removed (C3)',
	}),
	legacyPinterestCalendar: Object.freeze({
		id: 'legacy_pinterest_calendar',
		ui: null,
		readApi: 'GET /pinterest/calendar',
		writeApis: [],
		store: 'pinterest_publish_jobs',
		channelSpecific: true,
		notes: 'Preserved for backward compatibility; CalendarPage no longer uses it (C2)',
	}),
	workspaceCalendarEvents: Object.freeze({
		id: 'workspace_calendar_events',
		ui: null,
		readApi: 'GET /workspace/v1/calendar',
		writeApis: ['POST /workspace/v1/calendar', 'PATCH /workspace/v1/calendar/:id', 'DELETE /workspace/v1/calendar/:id'],
		store: 'calendar_events',
		channelSpecific: false,
		notes: 'C10: manual/planned CE only; PPJ interim merge retired; dual-write freeze remains',
	}),
});

/**
 * Target generic Scheduled Item fields for the facade (C1+).
 * Calendar core must not grow channel-specific fields beyond opaque channel + meta.
 */
export const SCHEDULED_ITEM_CONTRACT_FIELDS = Object.freeze([
	'id',
	'channel',
	'status',
	'scheduledAt',
	'timezone',
	'websiteId',
	'website',
	'title',
	'previewUrl',
	'refType',
	'refId',
	'actions',
	'readOnly',
	'deepLinks',
	'performance',
]);

export function normalizeRefType(value) {
	return String(value || '').trim().toLowerCase();
}

export function isChannelJobRefType(refType) {
	const normalized = normalizeRefType(refType);
	return CHANNEL_JOB_REF_TYPES.some((item) => item === normalized);
}

/**
 * True when a calendar_events row is a leftover channel-job mirror (pre-freeze orphan).
 * Legacy CE list and manual overlay must exclude these; channel providers own the schedule.
 */
export function isOrphanChannelJobMirrorEvent(event = {}) {
	return isChannelJobRefType(event.refType || event.ref_type);
}

/**
 * Reject dual-writes that would store a channel job schedule inside calendar_events.
 * Manual / planned events without a channel job ref remain allowed.
 *
 * On update, only inspect fields present on the payload (orphan mirror rows may still
 * be rescheduled/deleted for cleanup; they cannot gain a new channel-job ref).
 * C10: legacy CE list no longer merges or surfaces channel-job mirrors as publishes.
 */
export function assertCalendarEventsNotChannelJobMirror(payload = {}, { operation = 'write' } = {}) {
	const hasRef = Object.prototype.hasOwnProperty.call(payload, 'refType')
		|| Object.prototype.hasOwnProperty.call(payload, 'ref_type');
	if (hasRef || operation === 'create') {
		const refType = payload.refType ?? payload.ref_type;
		if (isChannelJobRefType(refType)) {
			throw freezeError(
				422,
				`calendar_events ${operation} rejected: ref_type "${normalizeRefType(refType)}" mirrors a channel job. `
				+ 'Channel jobs remain the write Source of Truth; Calendar will project them via the Unified Facade (C1+).',
				'CALENDAR_DUAL_WRITE_FROZEN',
			);
		}
	}

	const hasMeta = Object.prototype.hasOwnProperty.call(payload, 'meta');
	const hasEventType = Object.prototype.hasOwnProperty.call(payload, 'eventType')
		|| Object.prototype.hasOwnProperty.call(payload, 'event_type');
	if (hasMeta || hasEventType || operation === 'create') {
		const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : null;
		const metaSource = normalizeRefType(meta?.source || meta?.channel || '');
		const eventType = normalizeRefType(payload.eventType ?? payload.event_type);
		if (eventType === 'publish' && ['pinterest', 'wordpress', 'facebook'].includes(metaSource)) {
			throw freezeError(
				422,
				`calendar_events ${operation} rejected: channel publish schedules must be written to channel job tables, not calendar_events.`,
				'CALENDAR_DUAL_WRITE_FROZEN',
			);
		}
	}
}

export function getCalendarArchitectureSnapshot() {
	return {
		phase: CALENDAR_CONSOLIDATION_PHASE,
		channelAgnostic: true,
		productApi: 'unified_calendar_facade',
		productReadPath: UNIFIED_CALENDAR_EVENTS_PATH,
		writeSourceOfTruth: 'channel_job_collections',
		calendarEventsRole: 'optional_manual_overlay_demoted',
		channelJobRefTypes: [...CHANNEL_JOB_REF_TYPES],
		calendarEventsWriteAllowlist: [...CALENDAR_EVENTS_WRITE_ALLOWLIST],
		calendarEventsReaders: [...CALENDAR_EVENTS_READERS],
		systems: CALENDAR_SYSTEMS,
		scheduledItemContractFields: [...SCHEDULED_ITEM_CONTRACT_FIELDS],
		docs: 'docs/calendar-architecture.md',
	};
}
