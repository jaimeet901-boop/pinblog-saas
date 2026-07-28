/**
 * Phase 4.1 — CAS claim stress + regression tests.
 * Run: node apps/api/src/services/queue/claim.cas.stress.test.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimJobByCas, createMemoryClaimStore } from './claim.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const results = [];

function check(name, pass, detail = '') {
	results.push({ name, pass: Boolean(pass), detail });
	console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
}

function read(rel) {
	return readFileSync(path.join(root, rel), 'utf8');
}

async function stressClaimers(workerCount) {
	const store = createMemoryClaimStore({
		id: 'job_stress',
		status: 'queued',
		claim_token: '',
		claim_version: 0,
	});

	const outcomes = await Promise.all(
		Array.from({ length: workerCount }, (_, i) =>
			claimJobByCas({
				collection: 'jobs',
				jobId: 'job_stress',
				claimableStatuses: ['queued'],
				claimedStatus: 'processing',
				extraUpdate: { worker_id: `w${i}` },
				client: store,
			}),
		),
	);

	const winners = outcomes.filter(Boolean);
	const final = store.getRecord();
	const winnerTokens = new Set(winners.map((w) => w.claim_token));

	return {
		workerCount,
		winnerCount: winners.length,
		finalToken: final.claim_token,
		finalStatus: final.status,
		winnerTokensMatchFinal: winners.every((w) => w.claim_token === final.claim_token),
		uniqueWinnerTokens: winnerTokens.size,
	};
}

// --- Stress: 2 workers ---
{
	const r = await stressClaimers(2);
	check('2 workers → exactly one winner', r.winnerCount === 1, `winners=${r.winnerCount}`);
	check('2 workers → final status processing', r.finalStatus === 'processing');
	check('2 workers → winner token is final token', r.winnerTokensMatchFinal);
}

// --- Stress: 3 workers ---
{
	const r = await stressClaimers(3);
	check('3 workers → exactly one winner', r.winnerCount === 1, `winners=${r.winnerCount}`);
	check('3 workers → final status processing', r.finalStatus === 'processing');
	check('3 workers → winner token is final token', r.winnerTokensMatchFinal);
}

// --- Stress: 10 workers (extra confidence) ---
{
	const r = await stressClaimers(10);
	check('10 workers → exactly one winner', r.winnerCount === 1, `winners=${r.winnerCount}`);
	check('10 workers → unique winner tokens = 1', r.uniqueWinnerTokens === 1);
}

// --- Non-claimable status cannot be claimed ---
{
	const store = createMemoryClaimStore({
		id: 'job_done',
		status: 'completed',
		claim_token: 'old',
		claim_version: 2,
	});
	const claimed = await claimJobByCas({
		collection: 'jobs',
		jobId: 'job_done',
		claimableStatuses: ['queued'],
		claimedStatus: 'processing',
		client: store,
	});
	check('Completed job cannot be claimed', claimed === null);
}

// --- Second claim after first winner fails ---
{
	const store = createMemoryClaimStore({
		id: 'job_seq',
		status: 'queued',
		claim_token: '',
		claim_version: 0,
	});
	const first = await claimJobByCas({
		collection: 'jobs',
		jobId: 'job_seq',
		claimableStatuses: ['queued'],
		claimedStatus: 'processing',
		client: store,
	});
	const second = await claimJobByCas({
		collection: 'jobs',
		jobId: 'job_seq',
		claimableStatuses: ['queued'],
		claimedStatus: 'processing',
		client: store,
	});
	check('Sequential second claim loses', first && second === null, `first=${Boolean(first)} second=${second}`);
}

// --- Static regression: image queue + native claim use CAS ---
{
	const image = read('apps/api/src/services/ai-pin-image-queue.js');
	const controls = read('apps/api/src/services/queue/controls.js');
	const claim = read('apps/api/src/services/queue/claim.js');

	check('claim.js exports claimJobByCas', claim.includes('export async function claimJobByCas'));
	check('claim.js re-fetches before win', claim.includes('getOne(jobId)') && claim.includes('claim_token'));
	check('Image queue uses claimJobByCas', image.includes('claimJobByCas') && image.includes('claimImageJob'));
	check('Image queue no longer soft-locks status alone', !/payload:\s*\{\s*status:\s*'processing',\s*\}/.test(image));
	check('Image queue clears claim_token on retry', image.includes("claim_token: ''") || image.includes('claim_token: ""'));
	check('Native claimNativeJob uses claimJobByCas', controls.includes('claimJobByCas'));
	check('Native claim re-fetch semantics (via claim.js)', !/if\s*\(\s*!locked\s*\|\|\s*locked\.claim_token\s*!==\s*claimToken\s*\)\s*return null/.test(controls));
	check('Migration adds image claim fields', read('apps/pocketbase/pb_migrations/1783995200_ai_pin_image_jobs_claim_fields.js').includes('claim_token'));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n=== Phase 4.1 Summary: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
	for (const f of failed) console.log(' -', f.name, f.detail);
	process.exit(1);
}
console.log('Phase 4.1 CAS gate: PASS — stop for review before High severity fixes');
process.exit(0);
