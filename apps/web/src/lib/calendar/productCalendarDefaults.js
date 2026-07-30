/**
 * Keep web Calendar URL defaults aligned with API PRODUCT_CALENDAR_STATUSES (C4).
 * Duplicated as a plain list to avoid importing API modules into Vite.
 */
export const PRODUCT_CALENDAR_STATUSES = Object.freeze([
	'scheduled',
	'publishing',
	'published',
	'failed',
	'cancelled',
]);
