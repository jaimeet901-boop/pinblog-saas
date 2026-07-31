/**
 * Per-workspace in-process lock for credit balance mutations.
 * Serializes reserve / burn / release / refund within one Node process
 * (matches single-instance API deployment). Complements re-read checks in credits-engine.
 */

/** @type {Map<string, Promise<void>>} */
const flights = new Map();

function normalizeKey(workspaceKey) {
	const key = String(workspaceKey || '').trim();
	return key || '__missing_workspace__';
}

/**
 * Run `fn` exclusively for this workspaceKey.
 * Independent workspaces do not block each other.
 */
export function withWorkspaceCreditLock(workspaceKey, fn) {
	if (typeof fn !== 'function') {
		return Promise.reject(new TypeError('withWorkspaceCreditLock requires a function'));
	}
	const key = normalizeKey(workspaceKey);
	const previous = flights.get(key) || Promise.resolve();
	let release = () => {};
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const tail = previous.catch(() => {}).then(() => gate);
	flights.set(key, tail);

	return previous.catch(() => {}).then(async () => {
		try {
			return await fn();
		} finally {
			release();
			if (flights.get(key) === tail) {
				flights.delete(key);
			}
		}
	});
}

/** @internal test helper */
export function __resetWorkspaceCreditLocksForTests() {
	flights.clear();
}

/** @internal test helper — how many workspace locks are pending/active */
export function __workspaceCreditLockSizeForTests() {
	return flights.size;
}
