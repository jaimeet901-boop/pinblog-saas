/**
 * Generic Scheduled Item model for the Unified Calendar Facade.
 * Calendar core may only depend on these fields — never channel-specific business logic.
 */

import { SCHEDULED_ITEM_CONTRACT_FIELDS } from './calendar-architecture.js';

/**
 * Canonical Scheduled Item statuses — channel-agnostic.
 * Providers must map native job statuses into this set via normalizeScheduledItemStatus.
 */
export const SCHEDULED_ITEM_STATUSES = Object.freeze([
	'scheduled',
	'publishing',
	'published',
	'failed',
	'cancelled',
	/** Informational draft overlay only (C7) — never a publish job. */
	'draft',
]);

/**
 * Default product-calendar status set (C4): month feed includes publish lifecycle states.
 * Drafts are excluded by default; enable via includeDrafts / channels=draft (C7).
 * Callers may still pass statuses=scheduled for legacy narrow feeds.
 */
export const PRODUCT_CALENDAR_STATUSES = Object.freeze([
	'scheduled',
	'publishing',
	'published',
	'failed',
	'cancelled',
]);

/**
 * Cross-channel status aliases → canonical Scheduled Item status.
 * Keep this map channel-agnostic (no Pinterest/WordPress/Facebook branches in Calendar core).
 * Note: native `draft` is a first-class status (C7 overlay) — do not alias to scheduled.
 */
export const SCHEDULED_ITEM_STATUS_ALIASES = Object.freeze({
	queued: 'publishing',
	queue: 'publishing',
	processing: 'publishing',
	running: 'publishing',
	waiting: 'publishing',
	waiting_provider: 'publishing',
	in_progress: 'publishing',
	error: 'failed',
	errored: 'failed',
	failure: 'failed',
	canceled: 'cancelled',
	complete: 'published',
	completed: 'published',
	success: 'published',
	succeeded: 'published',
	pending: 'scheduled',
	ready: 'scheduled',
});

/**
 * Normalize any channel-native status string into a canonical Scheduled Item status.
 */
export function normalizeScheduledItemStatus(rawStatus) {
	const value = String(rawStatus || '').trim().toLowerCase();
	if (!value) return 'scheduled';
	if (SCHEDULED_ITEM_STATUSES.includes(value)) return value;
	if (SCHEDULED_ITEM_STATUS_ALIASES[value]) return SCHEDULED_ITEM_STATUS_ALIASES[value];
	return 'scheduled';
}

/**
 * Normalize website context for Scheduled Items.
 * websiteId remains the stable filter key; website is a future-proof object for labels.
 *
 * @returns {{ websiteId: string, website: { id: string, name: string|null, domain: string|null }|null }}
 */
export function normalizeWebsiteContext(input = {}) {
	const nested = input.website && typeof input.website === 'object' ? input.website : null;
	const id = String(
		input.websiteId
		|| input.website_id
		|| nested?.id
		|| '',
	).trim();
	const name = String(
		input.websiteName
		|| input.website_name
		|| nested?.name
		|| '',
	).trim() || null;
	const domain = String(
		input.websiteDomain
		|| input.website_domain
		|| nested?.domain
		|| nested?.url
		|| '',
	).trim() || null;

	if (!id && !name && !domain) {
		return { websiteId: '', website: null };
	}

	return {
		websiteId: id,
		website: {
			id,
			name,
			domain,
		},
	};
}

/**
 * Build a stable projection id: `${channel}:${refId}`.
 */
export function buildScheduledItemId(channel, refId) {
	const ch = String(channel || '').trim();
	const id = String(refId || '').trim();
	if (!ch || !id) {
		throw new Error('buildScheduledItemId requires channel and refId');
	}
	return `${ch}:${id}`;
}

/**
 * Normalize a partial item into the facade Scheduled Item DTO.
 * Extra keys are dropped so channel providers cannot leak proprietary fields into Calendar core.
 */
export function normalizeScheduledItem(input = {}) {
	const channel = String(input.channel || '').trim();
	const refId = String(input.refId || input.ref_id || '').trim();
	const id = String(input.id || '').trim() || (channel && refId ? buildScheduledItemId(channel, refId) : '');

	const status = normalizeScheduledItemStatus(input.status);
	const scheduledAt = input.scheduledAt || input.scheduled_at || null;
	const { websiteId, website } = normalizeWebsiteContext(input);

	const actions = Array.isArray(input.actions)
		? input.actions.map((item) => String(item || '').trim()).filter(Boolean)
		: [];

	const item = {
		id,
		channel,
		status,
		scheduledAt: scheduledAt ? String(scheduledAt) : null,
		timezone: String(input.timezone || 'UTC').trim() || 'UTC',
		websiteId,
		website,
		title: String(input.title || '').trim() || 'Scheduled item',
		previewUrl: String(input.previewUrl || input.preview_url || '').trim(),
		refType: String(input.refType || input.ref_type || '').trim(),
		refId,
		actions,
		readOnly: input.readOnly !== false,
		deepLinks: input.deepLinks && typeof input.deepLinks === 'object' ? { ...input.deepLinks } : {},
		performance: input.performance && typeof input.performance === 'object' ? { ...input.performance } : null,
	};

	return item;
}

export function assertScheduledItemContract(item) {
	for (const field of SCHEDULED_ITEM_CONTRACT_FIELDS) {
		if (!Object.prototype.hasOwnProperty.call(item, field)) {
			throw new Error(`Scheduled Item missing contract field: ${field}`);
		}
	}
	if (!item.id || !item.channel || !item.refId) {
		throw new Error('Scheduled Item requires id, channel, and refId');
	}
	if (!item.scheduledAt) {
		throw new Error('Scheduled Item requires scheduledAt');
	}
	if (!SCHEDULED_ITEM_STATUSES.includes(String(item.status || ''))) {
		throw new Error(`Scheduled Item status must be canonical: ${SCHEDULED_ITEM_STATUSES.join(', ')}`);
	}
	return true;
}

export function defaultActionsForStatus(status) {
	const normalized = normalizeScheduledItemStatus(status);
	if (normalized === 'draft') return [];
	if (normalized === 'scheduled') return ['reschedule', 'cancel'];
	if (normalized === 'failed') return ['retry', 'cancel'];
	if (normalized === 'publishing') return [];
	if (normalized === 'published') return [];
	if (normalized === 'cancelled') return [];
	return [];
}
