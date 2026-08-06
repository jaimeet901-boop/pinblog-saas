/**
 * Pure query builder for Facebook publishing history reads (F7-3).
 */

/**
 * Build query params for Facebook-only publishing history reads.
 * Always forces channel=facebook so callers cannot pivot to other channels.
 *
 * @param {Record<string, unknown>} [query]
 */
export function buildFacebookPublishingHistoryQuery(query = {}) {
	return {
		...query,
		channel: 'facebook',
	};
}
