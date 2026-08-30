/**
 * P0 #2 — PocketBase wordpress publish-jobs claim hook contract.
 * Repository/PB-side only (not shipped in the API Docker image).
 * Run from repo root:
 *   node --test apps/pocketbase/pb_hooks/wordpress-publish-jobs-claim.contract.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(path.join(here, 'wordpress-publish-jobs-claim.pb.js'), 'utf8');

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
