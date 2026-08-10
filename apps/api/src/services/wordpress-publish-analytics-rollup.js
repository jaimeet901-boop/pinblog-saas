/**
 * Pure WordPress publish analytics rollup (P1-12).
 * No PocketBase or route dependencies — safe for unit tests.
 */

/**
 * publish_history is canonical for terminal outcomes; failed publish_jobs
 * supplement only when no matching history row exists for that job id.
 *
 * @param {object[]} historyRows
 * @param {object[]} failedJobRows
 */
export function rollupWordpressPublishAnalytics(historyRows = [], failedJobRows = []) {
	const history = Array.isArray(historyRows) ? historyRows : [];
	const failedJobs = Array.isArray(failedJobRows) ? failedJobRows : [];

	const published = history.filter((row) => row.result === 'published').length;
	const drafts = history.filter((row) => row.result === 'draft').length;
	const scheduled = history.filter((row) => row.result === 'scheduled').length;
	const historyFailed = history.filter((row) => row.result === 'failed').length;

	const historyJobIds = new Set(
		history.map((row) => String(row.job || '').trim()).filter(Boolean),
	);

	const orphanFailedJobs = failedJobs.filter((job) => {
		const id = String(job.id || '').trim();
		return id && !historyJobIds.has(id);
	}).length;

	const failed = historyFailed + orphanFailedJobs;
	const attempts = published + drafts + scheduled + failed;
	const successRate = attempts
		? Math.round((published / attempts) * 1000) / 10
		: 0;

	return {
		published,
		drafts,
		scheduled,
		failed,
		attempts,
		successRate,
	};
}
