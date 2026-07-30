/**
 * Projection hook registry (Phase C8).
 * Documented entrypoint for Queue / Analytics / Notification projections.
 * Facade core does not import this — channel providers apply projections.
 */

export {
	projectQueueState,
	normalizeQueueChipState,
} from './queue.js';
export {
	projectAnalyticsMetadata,
	slimPerformanceSummary,
} from './analytics.js';
export {
	projectNotificationState,
	resolveNotificationPolicy,
	UPCOMING_NOTIFICATION_HOURS,
} from './notifications.js';
export { applyChannelJobProjections } from './apply.js';

/** Named hooks for tests / inventory (registration, not facade wiring). */
export const CALENDAR_PROJECTION_HOOKS = Object.freeze([
	Object.freeze({ id: 'queue', role: 'projection', sourceOfTruth: false }),
	Object.freeze({ id: 'analytics', role: 'projection', readOnly: true }),
	Object.freeze({ id: 'notifications', role: 'projection', emits: false }),
]);
