/**
 * Notification state projection for Unified Calendar (Phase C8).
 *
 * Notifications remain their own subsystem (workspace_notifications via workers).
 * Calendar only exposes policy/state — it does not write notification records.
 */

import { normalizeScheduledItemStatus } from '../scheduled-item.js';

/** Default upcoming window for schedule reminders (hours). */
export const UPCOMING_NOTIFICATION_HOURS = 24;

/**
 * Resolve which notification policy applies to a scheduled item.
 * Pure — does not emit notifications.
 */
export function resolveNotificationPolicy(input = {}, { now = new Date(), upcomingHours = UPCOMING_NOTIFICATION_HOURS } = {}) {
	const status = normalizeScheduledItemStatus(input.status);
	const scheduledAt = input.scheduledAt || input.scheduled_at || null;

	if (status === 'failed') {
		return {
			kind: 'publishing_failed',
			eligible: true,
			reason: 'failed_publish_job',
		};
	}

	if (status === 'scheduled' && scheduledAt) {
		const at = new Date(scheduledAt);
		const current = now instanceof Date ? now : new Date(now);
		if (!Number.isNaN(at.getTime()) && !Number.isNaN(current.getTime())) {
			const deltaMs = at.getTime() - current.getTime();
			const windowMs = Math.max(1, Number(upcomingHours) || UPCOMING_NOTIFICATION_HOURS) * 60 * 60 * 1000;
			if (deltaMs >= 0 && deltaMs <= windowMs) {
				return {
					kind: 'upcoming_scheduled',
					eligible: true,
					reason: 'within_upcoming_window',
				};
			}
		}
	}

	if (status === 'published') {
		return {
			kind: 'publishing_completed',
			eligible: false,
			reason: 'completed_informational',
		};
	}

	return {
		kind: null,
		eligible: false,
		reason: 'none',
	};
}

/**
 * Project notification state for Calendar (opaque deepLinks.notification).
 * Does not create workspace_notifications rows.
 */
export function projectNotificationState(input = {}, options = {}) {
	const policy = resolveNotificationPolicy(input, options);
	return {
		kind: policy.kind,
		eligible: Boolean(policy.eligible),
		reason: policy.reason,
		/** Workers own emission; Calendar only surfaces policy state. */
		subsystem: 'workspace_notifications',
		emittedByCalendar: false,
		projected: true,
	};
}
