/**
 * Facebook job mutation API calls for Studio + Hub.
 */

import apiServerClient from '@/lib/apiServerClient';

async function parseJson(response) {
	return response.json().catch(() => ({}));
}

function mutationError(response, body, fallback) {
	throw new Error(body?.message || `${fallback} (${response.status})`);
}

export async function rescheduleFacebookJob(jobId, { scheduledAt, timezone } = {}) {
	const response = await apiServerClient.fetch(`/facebook/jobs/${encodeURIComponent(jobId)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			...(scheduledAt ? { scheduledAt } : {}),
			...(timezone ? { timezone } : {}),
		}),
	});
	const body = await parseJson(response);
	if (!response.ok) mutationError(response, body, 'Reschedule failed');
	return body;
}

export async function cancelFacebookJob(jobId) {
	const response = await apiServerClient.fetch(`/facebook/jobs/${encodeURIComponent(jobId)}/cancel`, {
		method: 'POST',
	});
	const body = await parseJson(response);
	if (!response.ok) mutationError(response, body, 'Cancel failed');
	return body;
}

export async function retryFacebookJob(jobId) {
	const response = await apiServerClient.fetch(`/facebook/jobs/${encodeURIComponent(jobId)}/retry`, {
		method: 'POST',
	});
	const body = await parseJson(response);
	if (!response.ok) mutationError(response, body, 'Retry failed');
	return body;
}

export async function publishNowFacebookJob(jobId) {
	const response = await apiServerClient.fetch(`/facebook/jobs/${encodeURIComponent(jobId)}/publish-now`, {
		method: 'POST',
	});
	const body = await parseJson(response);
	if (!response.ok) mutationError(response, body, 'Publish now failed');
	return body;
}
