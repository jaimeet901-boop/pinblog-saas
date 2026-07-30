/**
 * Queue projection for Unified Calendar Scheduled Items (Phase C8).
 *
 * Queue information is projected only. Channel job collections remain write SoT.
 * queue_jobs mirrors are optional enrichment — never authoritative for Calendar.
 */

import { normalizeScheduledItemStatus } from '../scheduled-item.js';
import { buildHistoryHref, buildQueueHref } from '../product-links.js';

/**
 * Map channel / mirror status into a light queue chip state.
 */
export function normalizeQueueChipState(rawStatus) {
	const status = normalizeScheduledItemStatus(rawStatus);
	if (status === 'publishing') return 'running';
	if (status === 'failed') return 'failed';
	if (status === 'published') return 'completed';
	if (status === 'cancelled') return 'cancelled';
	if (status === 'scheduled') return 'queued';
	return 'idle';
}

/**
 * Project light queue state from a channel job (+ optional queue_jobs mirror).
 *
 * @param {object} input
 * @param {string} input.sourceCollection  Channel job collection (SoT)
 * @param {string} input.sourceId          Channel job id
 * @param {string} [input.status]
 * @param {number|string} [input.attemptCount]
 * @param {number|string} [input.maxAttempts]
 * @param {string} [input.nextRetryAt]
 * @param {number|string} [input.progress]
 * @param {boolean} [input.deadLetter]
 * @param {string} [input.queueJobId]       Optional mirrored queue_jobs id
 * @param {string} [input.websiteId]
 * @returns {object} Opaque queue projection (deepLinks.queue)
 */
export function projectQueueState(input = {}) {
	const sourceCollection = String(input.sourceCollection || '').trim();
	const sourceId = String(input.sourceId || '').trim();
	const queueJobId = String(input.queueJobId || input.queueRef || '').trim();
	const websiteId = String(input.websiteId || '').trim();
	const attemptCount = Number(input.attemptCount ?? input.attempt_count ?? 0) || 0;
	const maxAttempts = Number(input.maxAttempts ?? input.max_attempts ?? 0) || 0;
	const progressRaw = input.progress;
	const progress = progressRaw == null || progressRaw === ''
		? null
		: Number(progressRaw);
	const nextRetryAt = input.nextRetryAt || input.next_retry_at || null;
	const deadLetter = Boolean(input.deadLetter ?? input.dead_letter);

	return {
		queueRef: queueJobId || null,
		queueHref: queueJobId
			? buildQueueHref({ queueJobId, websiteId })
			: (sourceId ? buildHistoryHref({ websiteId, jobId: sourceId }) : ''),
		state: normalizeQueueChipState(input.status),
		attemptCount,
		maxAttempts: maxAttempts || null,
		nextRetryAt: nextRetryAt ? String(nextRetryAt) : null,
		progress: Number.isFinite(progress) ? progress : null,
		deadLetter,
		sourceCollection,
		sourceId,
		/** Explicit: Calendar must not treat queue as schedule/publish SoT. */
		sourceOfTruth: false,
		projected: true,
	};
}
