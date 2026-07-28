/**
 * Optimistic CAS job claim for PocketBase-backed queues.
 *
 * PocketBase REST updates are by id only (no UPDATE … WHERE status=…).
 * Semantics match Pinterest / WordPress publish queues:
 * 1. Read job; require claimable status
 * 2. Write claimedStatus + unique claim_token + claim_version++
 * 3. Re-fetch; proceed only if claim_token still matches this worker
 *
 * Concurrent claimers: last writer wins; losers abort after re-fetch.
 * A worker that already lost cannot execute (token mismatch).
 */

import { randomBytes } from 'node:crypto';
import pocketbaseClient from '../../utils/pocketbaseClient.js';

/**
 * @param {object} options
 * @param {string} options.collection
 * @param {string} options.jobId
 * @param {string[]} options.claimableStatuses
 * @param {string} options.claimedStatus
 * @param {Record<string, unknown>} [options.extraUpdate]
 * @param {(payload: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>} [options.sanitize]
 * @param {{ collection: (name: string) => { getOne: Function, update: Function } }} [options.client] test inject
 * @returns {Promise<object|null>} verified claimed record or null
 */
export async function claimJobByCas({
	collection,
	jobId,
	claimableStatuses,
	claimedStatus,
	extraUpdate = {},
	sanitize = null,
	client = pocketbaseClient,
}) {
	const col = client.collection(collection);
	const current = await col.getOne(jobId).catch(() => null);
	if (!current || !claimableStatuses.includes(String(current.status || ''))) {
		return null;
	}

	const claimToken = randomBytes(16).toString('hex');
	const nextVersion = Number(current.claim_version || 0) + 1;
	let payload = {
		status: claimedStatus,
		claim_token: claimToken,
		claim_version: nextVersion,
		...extraUpdate,
	};

	if (typeof sanitize === 'function') {
		payload = await sanitize(payload);
	}

	const locked = await col.update(jobId, payload).catch(() => null);
	if (!locked || String(locked.status || '') !== claimedStatus) {
		return null;
	}

	// Critical: do not trust the update response alone (two writers both "succeed").
	const verified = await col.getOne(jobId).catch(() => null);
	if (
		!verified
		|| String(verified.status || '') !== claimedStatus
		|| String(verified.claim_token || '') !== claimToken
	) {
		return null;
	}

	return verified;
}

/**
 * In-memory concurrent store for stress tests (simulates last-write-wins PB updates).
 */
export function createMemoryClaimStore(initialRecord) {
	let record = { ...initialRecord };
	let seq = 0;

	return {
		getRecord: () => ({ ...record }),
		collection() {
			return {
				async getOne() {
					// Yield so concurrent claimers interleave.
					await Promise.resolve();
					return { ...record };
				},
				async update(_id, data) {
					await Promise.resolve();
					seq += 1;
					record = {
						...record,
						...data,
						_writeSeq: seq,
						updated: new Date().toISOString(),
					};
					return { ...record };
				},
			};
		},
	};
}
