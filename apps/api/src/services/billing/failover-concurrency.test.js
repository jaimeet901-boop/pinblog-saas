import test from 'node:test';
import assert from 'node:assert/strict';
import {
	__resetFailoverWriteLockForTests,
	withFailoverWriteLock,
} from './failover-lock.js';

test('withFailoverWriteLock serializes concurrent critical sections', async () => {
	__resetFailoverWriteLockForTests();
	const order = [];
	const slow = withFailoverWriteLock(async () => {
		order.push('a-start');
		await new Promise((resolve) => setTimeout(resolve, 30));
		order.push('a-end');
		return 'a';
	});
	const fast = withFailoverWriteLock(async () => {
		order.push('b-start');
		order.push('b-end');
		return 'b';
	});
	const results = await Promise.all([slow, fast]);
	assert.deepEqual(results, ['a', 'b']);
	assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
});
