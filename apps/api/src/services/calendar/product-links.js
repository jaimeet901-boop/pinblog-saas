/**
 * Product deep-link helpers for Calendar projections (C8).
 * Opaque hrefs only — Calendar stays channel-agnostic.
 */

/**
 * Analytics page link preserving websiteId (+ optional pin/job context).
 */
export function buildAnalyticsHref(options = {}) {
	const websiteId = String(options.websiteId || '').trim();
	const pinId = String(options.pinId || '').trim();
	const jobId = String(options.jobId || '').trim();
	const params = new URLSearchParams();
	if (websiteId) params.set('websiteId', websiteId);
	if (pinId) params.set('pinId', pinId);
	if (jobId) params.set('jobId', jobId);
	const query = params.toString();
	return query ? `/app/analytics?${query}` : '/app/analytics';
}

/**
 * Publishing history link-out (workspace surface for job context).
 */
export function buildHistoryHref(options = {}) {
	const websiteId = String(options.websiteId || '').trim();
	const jobId = String(options.jobId || '').trim();
	const params = new URLSearchParams();
	if (websiteId) params.set('websiteId', websiteId);
	if (jobId) params.set('jobId', jobId);
	const query = params.toString();
	return query ? `/app/pinterest-history?${query}` : '/app/pinterest-history';
}

/**
 * Opaque queue mirror link. Queue UI remains ops/admin; this is projection only.
 */
export function buildQueueHref(options = {}) {
	const queueJobId = String(options.queueJobId || options.queueRef || '').trim();
	const websiteId = String(options.websiteId || '').trim();
	const params = new URLSearchParams();
	if (queueJobId) params.set('queueJobId', queueJobId);
	if (websiteId) params.set('websiteId', websiteId);
	const query = params.toString();
	// History is the workspace-facing surface; queue_jobs stay execution telemetry.
	return query ? `/app/pinterest-history?${query}` : '/app/pinterest-history';
}
