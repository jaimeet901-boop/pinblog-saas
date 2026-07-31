/**
 * Synchronous async-operation lock for Writer publish / schedule (High Priority #3).
 * React `publishing` state alone cannot stop double-clicks before re-render.
 */

/**
 * @returns {{ tryAcquire: () => boolean, release: () => void, isLocked: () => boolean, reset: () => void }}
 */
export function createPublishLock() {
	let locked = false;
	return {
		tryAcquire() {
			if (locked) return false;
			locked = true;
			return true;
		},
		release() {
			locked = false;
		},
		isLocked() {
			return locked;
		},
		reset() {
			locked = false;
		},
	};
}

/**
 * Run `fn` only if the lock can be acquired. Always releases afterward.
 * @returns {Promise<{ started: boolean, result?: unknown, error?: unknown }>}
 */
export async function runWithPublishLock(lock, fn) {
	if (!lock || typeof lock.tryAcquire !== 'function') {
		throw new TypeError('runWithPublishLock requires a publish lock');
	}
	if (!lock.tryAcquire()) {
		return { started: false };
	}
	try {
		const result = await fn();
		return { started: true, result };
	} catch (error) {
		return { started: true, error };
	} finally {
		lock.release();
	}
}

/**
 * Simulate N concurrent publish/schedule clicks sharing one lock.
 * @returns {Promise<{ startedCount: number, skippedCount: number, errors: unknown[] }>}
 */
export async function simulateConcurrentPublishClicks(clickCount, work) {
	const lock = createPublishLock();
	const outcomes = await Promise.all(
		Array.from({ length: clickCount }, () => runWithPublishLock(lock, work)),
	);
	return {
		startedCount: outcomes.filter((o) => o.started).length,
		skippedCount: outcomes.filter((o) => !o.started).length,
		errors: outcomes.filter((o) => o.error).map((o) => o.error),
		lockReleased: !lock.isLocked(),
	};
}
