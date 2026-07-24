/**
 * PublishingService — Publish Now + progress polling.
 * History is written by the server queue into pinterest_publish_jobs / history.
 */

import apiServerClient from '@/lib/apiServerClient';

const TERMINAL = new Set(['published', 'failed', 'cancelled']);

async function parseJson(response) {
	return response.json().catch(() => ({}));
}

export async function publishNow({
	pinIds,
	accountId,
	boardId,
	timezone,
	perPinTargets,
}) {
	if (!Array.isArray(pinIds) || pinIds.length === 0) {
		throw new Error('Select at least one pin to publish');
	}
	if (!accountId) throw new Error('Select a Pinterest account');
	if (!boardId) throw new Error('Select a Pinterest board');

	const response = await apiServerClient.fetch('/pinterest/publish', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			pinIds,
			accountId,
			boardId,
			timezone: timezone || 'UTC',
			...(perPinTargets && Object.keys(perPinTargets).length ? { perPinTargets } : {}),
		}),
	});
	const body = await parseJson(response);
	if (!response.ok) {
		throw new Error(body?.message || `Publish failed (${response.status})`);
	}
	return {
		jobs: body.jobs || [],
		message: 'Publish jobs queued',
	};
}

export async function fetchJobsByIds(jobIds = []) {
	if (!jobIds.length) return [];
	const response = await apiServerClient.fetch('/pinterest/jobs?perPage=200&page=1', { method: 'GET' });
	const body = await parseJson(response);
	if (!response.ok) {
		throw new Error(body?.message || 'Failed to load publish jobs');
	}
	const idSet = new Set(jobIds);
	return (body.items || []).filter((job) => idSet.has(job.id));
}

export async function fetchScheduledJobs({ status = 'scheduled', perPage = 200 } = {}) {
	const params = new URLSearchParams({ page: '1', perPage: String(perPage) });
	if (status) params.set('status', status);
	const response = await apiServerClient.fetch(`/pinterest/jobs?${params}`, { method: 'GET' });
	const body = await parseJson(response);
	if (!response.ok) {
		throw new Error(body?.message || 'Failed to load scheduled jobs');
	}
	return body.items || [];
}

/**
 * Poll until jobs reach a terminal state or timeout.
 * onProgress({ phase, jobs, elapsedMs })
 */
export async function watchPublishProgress({
	jobIds,
	pollMs = 2500,
	timeoutMs = 120000,
	onProgress,
	signal,
}) {
	const started = Date.now();
	let jobs = [];

	onProgress?.({
		phase: 'queued',
		jobs: [],
		elapsedMs: 0,
		message: 'Publish jobs created — waiting for Pinterest…',
	});

	while (Date.now() - started < timeoutMs) {
		if (signal?.aborted) {
			throw new Error('Publish watch cancelled');
		}
		jobs = await fetchJobsByIds(jobIds);
		const allTerminal = jobs.length > 0 && jobs.every((job) => TERMINAL.has(job.status));
		const publishing = jobs.some((job) => job.status === 'publishing');
		onProgress?.({
			phase: allTerminal ? 'done' : publishing ? 'publishing' : 'queued',
			jobs,
			elapsedMs: Date.now() - started,
			message: allTerminal
				? 'Publishing finished'
				: publishing
					? 'Publishing to Pinterest…'
					: 'Waiting in queue…',
		});
		if (allTerminal) {
			return summarizePublishResult(jobs);
		}
		await sleep(pollMs, signal);
	}

	jobs = await fetchJobsByIds(jobIds);
	return {
		...summarizePublishResult(jobs),
		timedOut: true,
		message: 'Timed out waiting for Pinterest. Check Publishing History for final status.',
	};
}

export function summarizePublishResult(jobs = []) {
	const published = jobs.filter((j) => j.status === 'published');
	const failed = jobs.filter((j) => j.status === 'failed');
	const pending = jobs.filter((j) => !TERMINAL.has(j.status));
	return {
		ok: failed.length === 0 && pending.length === 0 && published.length > 0,
		published,
		failed,
		pending,
		jobs,
		message: failed.length
			? `${failed.length} failed, ${published.length} published`
			: pending.length
				? `${published.length} published, ${pending.length} still pending`
				: `${published.length} published successfully`,
		pinterestResponses: jobs.map((job) => ({
			jobId: job.id,
			status: job.status,
			pinId: job.pinterestPinId || '',
			pinUrl: job.pinterestPinUrl || '',
			error: job.lastError || '',
			attemptCount: job.attemptCount || 0,
			boardName: job.boardName || '',
			accountLabel: job.accountLabel || '',
			publishedAt: job.publishedAt || '',
		})),
	};
}

function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		if (signal) {
			const onAbort = () => {
				clearTimeout(timer);
				reject(new Error('Publish watch cancelled'));
			};
			if (signal.aborted) {
				onAbort();
				return;
			}
			signal.addEventListener('abort', onAbort, { once: true });
		}
	});
}

/**
 * Full Publish Now flow: create jobs + watch progress.
 */
export async function runPublishNowFlow({
	pinIds,
	accountId,
	boardId,
	timezone,
	perPinTargets,
	pollMs,
	timeoutMs,
	onProgress,
	signal,
}) {
	onProgress?.({ phase: 'submitting', jobs: [], elapsedMs: 0, message: 'Submitting to Pinterest…' });
	const created = await publishNow({ pinIds, accountId, boardId, timezone, perPinTargets });
	const jobIds = (created.jobs || []).map((job) => job.id).filter(Boolean);
	if (jobIds.length === 0) {
		throw new Error('No publish jobs were created');
	}
	onProgress?.({
		phase: 'queued',
		jobs: created.jobs,
		elapsedMs: 0,
		message: `${jobIds.length} job(s) queued`,
	});
	return watchPublishProgress({ jobIds, pollMs, timeoutMs, onProgress, signal });
}
