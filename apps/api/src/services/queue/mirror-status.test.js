/**
 * Phase 9d-6 — mirror status helper tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { getQueueMirrorsStatus } from './mirror-status.js';

test('getQueueMirrorsStatus reports retired mirrors', () => {
	const status = getQueueMirrorsStatus();
	assert.deepEqual(status, { retired: true });
});
