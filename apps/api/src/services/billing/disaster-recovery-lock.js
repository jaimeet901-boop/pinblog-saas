/**
 * In-process single-flight for Control Plane Disaster Recovery mutations (BP-6).
 * Pure — no PocketBase side effects.
 */

let disasterRecoveryWriteFlight = Promise.resolve();

/**
 * Serialize backup/restore/rollback write critical sections within one Node process.
 * Complements expectedUpdatedAt OCC.
 */
export function withDisasterRecoveryWriteLock(fn) {
	const run = disasterRecoveryWriteFlight.then(() => fn());
	disasterRecoveryWriteFlight = run.then(() => undefined, () => undefined);
	return run;
}

/** @internal test helper */
export function __resetDisasterRecoveryWriteLockForTests() {
	disasterRecoveryWriteFlight = Promise.resolve();
}
