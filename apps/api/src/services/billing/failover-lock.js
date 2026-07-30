/**
 * In-process single-flight for Control Plane failover mutations (BP-4).
 * Pure — no PocketBase side effects.
 */

let failoverWriteFlight = Promise.resolve();

/**
 * Serialize failover/recovery/override/policy write critical sections
 * within one Node process. Complements expectedUpdatedAt OCC.
 */
export function withFailoverWriteLock(fn) {
	const run = failoverWriteFlight.then(() => fn());
	failoverWriteFlight = run.then(() => undefined, () => undefined);
	return run;
}

/** @internal test helper */
export function __resetFailoverWriteLockForTests() {
	failoverWriteFlight = Promise.resolve();
}
