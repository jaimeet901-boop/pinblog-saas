import pocketbaseClient from '../utils/pocketbaseClient.js';

function redact(value) {
	if (value == null) return value;
	if (typeof value === 'string') {
		if (/authorization|password|ciphertext|secret|token/i.test(value)) return '[redacted]';
		return value.length > 500 ? `${value.slice(0, 500)}…` : value;
	}
	if (Array.isArray(value)) return value.slice(0, 20).map(redact);
	if (typeof value === 'object') {
		const out = {};
		for (const [key, item] of Object.entries(value)) {
			if (/password|authorization|ciphertext|secret|token|cookie/i.test(key)) {
				out[key] = '[redacted]';
			} else {
				out[key] = redact(item);
			}
		}
		return out;
	}
	return value;
}

/**
 * Persist every WordPress REST attempt for auditing / retries / analytics.
 * Never stores credentials or full HTML bodies.
 */
export async function writeWordpressApiLog({
	ownerId,
	workspaceKey = '',
	siteId = '',
	jobId = '',
	method = 'GET',
	path = '',
	statusCode = 0,
	durationMs = 0,
	ok = false,
	error = '',
	requestMeta = {},
	responseMeta = {},
} = {}) {
	if (!ownerId) return null;
	const payload = {
		owner: ownerId,
		workspace_key: workspaceKey || ownerId,
		site_id: siteId || '',
		job_id: jobId || '',
		method: String(method || 'GET').toUpperCase().slice(0, 20),
		path: String(path || '').slice(0, 1000),
		status_code: Number(statusCode) || 0,
		duration_ms: Math.max(0, Number(durationMs) || 0),
		ok: Boolean(ok),
		error: String(error || '').slice(0, 4000),
		request_meta: redact(requestMeta || {}),
		response_meta: redact(responseMeta || {}),
	};
	if (siteId) payload.site = siteId;

	return pocketbaseClient.collection('wordpress_api_logs').create(payload).catch(() => null);
}

export async function listWordpressApiLogs(ownerId, query = {}) {
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
	const parts = [pocketbaseClient.filter('owner = {:owner}', { owner: ownerId })];
	if (query.siteId) {
		parts.push(pocketbaseClient.filter('(site = {:site} || site_id = {:site})', { site: query.siteId }));
	}
	if (query.jobId) {
		parts.push(pocketbaseClient.filter('job_id = {:job}', { job: query.jobId }));
	}
	const result = await pocketbaseClient.collection('wordpress_api_logs').getList(page, perPage, {
		filter: parts.join(' && '),
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [], page, perPage, totalItems: 0, totalPages: 0 }));

	return {
		items: (result.items || []).map((row) => ({
			id: row.id,
			siteId: row.site || row.site_id || '',
			jobId: row.job_id || '',
			method: row.method,
			path: row.path,
			statusCode: row.status_code,
			durationMs: row.duration_ms,
			ok: Boolean(row.ok),
			error: row.error || '',
			created: row.created,
		})),
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 0,
	};
}
