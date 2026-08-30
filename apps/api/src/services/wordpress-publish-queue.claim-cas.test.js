/**
 * P0 #2 — WordPress publish_jobs atomic claim (DB-side conditional UPDATE).
 * Run: node --test src/services/wordpress-publish-queue.claim-cas.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
	WORDPRESS_PUBLISH_JOB_CLAIM_PATH,
	claimJob,
} from './wordpress-publish-claim.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const claimSource = readFileSync(
	path.join(root, 'apps/api/src/services/wordpress-publish-claim.js'),
	'utf8',
);
const queueSource = readFileSync(
	path.join(root, 'apps/api/src/services/wordpress-publish-queue.js'),
	'utf8',
);
const hookSource = readFileSync(
	path.join(root, 'apps/pocketbase/pb_hooks/wordpress-publish-jobs-claim.pb.js'),
	'utf8',
);

/**
 * Simulates PocketBase conditional UPDATE: only one concurrent claim wins.
 */
function createAtomicClaimStore(initialJob) {
	let record = { ...initialJob };
	let claimInFlight = Promise.resolve();

	function serialize(work) {
		const run = claimInFlight.then(work, work);
		claimInFlight = run.then(() => undefined, () => undefined);
		return run;
	}

	return {
		getRecord: () => ({ ...record }),
		async getJob(id) {
			await Promise.resolve();
			if (String(record.id) !== String(id)) return null;
			return { ...record };
		},
		async sendClaim(body) {
			return serialize(async () => {
				await Promise.resolve();
				const id = String(body?.id || '').trim();
				const token = String(body?.claim_token || '').trim();
				const startedAt = String(body?.started_at || '').trim();
				if (!id || !token || !startedAt || String(record.id) !== id) {
					const err = new Error('WordPress publish job could not be claimed.');
					err.status = 400;
					throw err;
				}
				if (!['queued', 'scheduled'].includes(record.status)) {
					const err = new Error('WordPress publish job could not be claimed.');
					err.status = 400;
					throw err;
				}
				record = {
					...record,
					status: 'publishing',
					claim_token: token,
					claim_version: Number(record.claim_version || 0) + 1,
					started_at: record.started_at || startedAt,
					progress: 10,
				};
				return { ok: true, id };
			});
		},
	};
}

describe('wordpress publish queue atomic claim (P0 #2)', () => {
	it('claimJob allows only one concurrent winner', async () => {
		const store = createAtomicClaimStore({
			id: 'job_cas',
			status: 'scheduled',
			claim_token: '',
			claim_version: 0,
			started_at: '',
			progress: 0,
		});

		const outcomes = await Promise.all([
			claimJob('job_cas', { getJob: (id) => store.getJob(id), sendClaim: (body) => store.sendClaim(body) }),
			claimJob('job_cas', { getJob: (id) => store.getJob(id), sendClaim: (body) => store.sendClaim(body) }),
		]);

		const winners = outcomes.filter(Boolean);
		assert.equal(winners.length, 1);
		assert.equal(winners[0].status, 'publishing');
		assert.ok(winners[0].claim_token);
		assert.equal(Number(winners[0].claim_version), 1);
		assert.equal(outcomes.filter((v) => v === null).length, 1);
		assert.equal(store.getRecord().claim_token, winners[0].claim_token);
	});

	it('claimJob returns null when job is not claimable', async () => {
		const store = createAtomicClaimStore({
			id: 'job_pub',
			status: 'publishing',
			claim_token: 'held',
			claim_version: 2,
			started_at: '2026-01-01T00:00:00.000Z',
			progress: 10,
		});
		const result = await claimJob('job_pub', {
			getJob: (id) => store.getJob(id),
			sendClaim: (body) => store.sendClaim(body),
		});
		assert.equal(result, null);
		assert.equal(store.getRecord().claim_token, 'held');
	});

	it('claim helper uses PocketBase send hook path, not unconditional update', () => {
		assert.match(claimSource, /WORDPRESS_PUBLISH_JOB_CLAIM_PATH/);
		assert.match(claimSource, /\/api\/wordpress\/publish-jobs\/claim/);
		assert.match(claimSource, /claim_token: claimToken/);
		assert.match(claimSource, /started_at: startedAt/);
		assert.doesNotMatch(claimSource, /\.update\(/);
		assert.doesNotMatch(claimSource, /collection\(['"]publish_jobs['"]\)\.update/);
		assert.match(queueSource, /from '\.\/wordpress-publish-claim\.js'/);
		assert.match(queueSource, /claimJob\(/);
	});

	it('exports claim path constant', () => {
		assert.equal(WORDPRESS_PUBLISH_JOB_CLAIM_PATH, '/api/wordpress/publish-jobs/claim');
	});
});

describe('wordpress publish-jobs claim hook contract (P0 #2)', () => {
	it('registers POST claim with superuser auth and conditional SQL', () => {
		assert.match(hookSource, /routerAdd\("POST", "\/api\/wordpress\/publish-jobs\/claim"/);
		assert.match(hookSource, /\$apis\.requireSuperuserAuth\(\)/);
		assert.match(hookSource, /\$app\.db\(\)/);
		assert.match(hookSource, /newQuery\(/);
		assert.match(hookSource, /UPDATE publish_jobs SET/);
		assert.match(hookSource, /status = 'publishing'/);
		assert.match(hookSource, /claim_token = \{:token\}/);
		assert.match(hookSource, /claim_version = COALESCE\(claim_version, 0\) \+ 1/);
		assert.match(hookSource, /WHERE id = \{:id\} AND status IN \('queued', 'scheduled'\)/);
		assert.match(hookSource, /rowsAffected/);
		assert.match(hookSource, /affected !== 1/);
		assert.doesNotMatch(hookSource, /collection\(['"]publish_jobs['"]\)\.update/);
	});
});
