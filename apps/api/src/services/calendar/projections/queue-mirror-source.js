/**
 * Optional live queue_jobs mirror lookup for Calendar queue projection (C8).
 * Isolated so unit tests never import PocketBase.
 *
 * Queue mirrors are enrichment only — never Calendar SoT.
 */

import { findBySource } from '../../queue/jobs.js';

export async function resolveQueueMirrorForSource(sourceCollection, sourceId) {
	const collection = String(sourceCollection || '').trim();
	const id = String(sourceId || '').trim();
	if (!collection || !id) return null;
	return findBySource(collection, id);
}
