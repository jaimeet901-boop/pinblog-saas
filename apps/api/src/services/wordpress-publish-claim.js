/**
 * P0 #2 — Atomic WordPress publish_jobs claim via PocketBase conditional SQL hook.
 * PocketBase client is loaded lazily so unit tests can inject fakes without side effects.
 */
import { randomBytes } from 'node:crypto';

/** Superuser PocketBase hook — conditional SQL claim. */
export const WORDPRESS_PUBLISH_JOB_CLAIM_PATH = '/api/wordpress/publish-jobs/claim';

async function defaultGetJob(jobId) {
	const { default: pocketbaseClient } = await import('../utils/pocketbaseClient.js');
	return pocketbaseClient.collection('publish_jobs').getOne(jobId).catch(() => null);
}

async function defaultSendClaim(body) {
	const { default: pocketbaseClient } = await import('../utils/pocketbaseClient.js');
	return pocketbaseClient.send(WORDPRESS_PUBLISH_JOB_CLAIM_PATH, {
		method: 'POST',
		body,
	});
}

/**
 * Atomically claim a publish_jobs row.
 * Optional deps.getJob / deps.sendClaim enable deterministic unit tests.
 *
 * @param {string} jobId
 * @param {{ getJob?: Function, sendClaim?: Function }} [deps]
 * @returns {Promise<object|null>}
 */
export async function claimJob(jobId, deps = {}) {
	const getJob = deps.getJob || defaultGetJob;
	const sendClaim = deps.sendClaim || defaultSendClaim;

	const current = await getJob(jobId);
	if (!current || !['queued', 'scheduled'].includes(current.status)) {
		return null;
	}

	const claimToken = randomBytes(16).toString('hex');
	const startedAt = current.started_at || new Date().toISOString();

	try {
		const result = await sendClaim({
			id: jobId,
			claim_token: claimToken,
			started_at: startedAt,
		});
		if (!result || result.ok !== true || String(result.id || '') !== String(jobId)) {
			return null;
		}
	} catch {
		return null;
	}

	const verified = await getJob(jobId);
	if (!verified || verified.status !== 'publishing' || verified.claim_token !== claimToken) {
		return null;
	}
	return verified;
}
