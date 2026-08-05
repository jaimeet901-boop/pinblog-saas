/**
 * Channel mirror write layer retired (Phase 9d-6).
 * Legacy queue_jobs rows remain readable via findBySource / dual-read.
 */
export function getQueueMirrorsStatus() {
	return {
		retired: true,
	};
}
