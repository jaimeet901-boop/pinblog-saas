/**
 * Destination adapters for Content Studio publish / schedule / queue.
 * Pinterest is live. Facebook mirrors the contract; real Graph APIs are not wired yet.
 */

import apiServerClient from '@/lib/apiServerClient';
import {
	runPublishNowFlow as runPinterestPublishNowFlow,
	publishNow as pinterestPublishNow,
	watchPublishProgress as watchPinterestPublishProgress,
	fetchScheduledJobs as fetchPinterestScheduledJobs,
	summarizePublishResult,
	schedulePins as pinterestSchedulePins,
	scheduleRecurrenceSeries as pinterestScheduleRecurrenceSeries,
	addPinsToQueue as pinterestAddPinsToQueue,
	loadOccupiedSlots as pinterestLoadOccupiedSlots,
	formatPinterestPublishError,
} from '@/services/ai-pins';
import { validatePinForPinterestPublish as validatePinPublish } from '@/lib/pinPublishDestination';

async function parseJson(response) {
	return response.json().catch(() => ({}));
}

function mapFacebookPageToBoard(page) {
	const pageId = String(page.pageId || page.id || '').trim();
	return {
		id: page.id || pageId,
		boardId: pageId,
		name: page.name || page.pageName || 'Facebook Page',
		isDefault: Boolean(page.isDefault),
		...page,
	};
}

const FACEBOOK_API_MISSING = 'Facebook publishing APIs are not available yet. Connect and publish endpoints will land in a later phase.';

async function facebookFetch(path, options) {
	const response = await apiServerClient.fetch(path, options);
	if (response.status === 404) {
		const err = new Error(FACEBOOK_API_MISSING);
		err.code = 'FACEBOOK_API_MISSING';
		err.status = 404;
		throw err;
	}
	return response;
}

export const pinterestDestinationAdapter = {
	id: 'pinterest',
	accountsPath: '/pinterest/accounts?filter=active',
	connectedPath: '/pinterest/accounts?filter=connected',
	destinationsPath: (accountId) => `/pinterest/boards?accountId=${encodeURIComponent(accountId)}`,
	async listAccounts() {
		const response = await apiServerClient.fetch('/pinterest/accounts?filter=active', { method: 'GET' });
		const payload = await parseJson(response);
		if (!response.ok) {
			throw new Error(payload?.message || `Failed to load Pinterest accounts (${response.status})`);
		}
		return Array.isArray(payload) ? payload : (payload.items || payload.accounts || []);
	},
	async listDestinations(accountId) {
		const response = await apiServerClient.fetch(`/pinterest/boards?accountId=${encodeURIComponent(accountId)}`, { method: 'GET' });
		const payload = await parseJson(response);
		if (response.status === 404 || response.status === 401) {
			return { items: [], unavailable: true, message: payload?.message };
		}
		if (!response.ok) {
			throw new Error(payload?.message || `Failed to load Pinterest boards (${response.status})`);
		}
		return { items: Array.isArray(payload) ? payload : (payload.items || []), unavailable: false };
	},
	validateItem: validatePinPublish,
	formatPublishError: formatPinterestPublishError,
	runPublishNowFlow: runPinterestPublishNowFlow,
	publishNow: pinterestPublishNow,
	watchPublishProgress: watchPinterestPublishProgress,
	fetchScheduledJobs: fetchPinterestScheduledJobs,
	summarizePublishResult,
	schedulePins: pinterestSchedulePins,
	scheduleRecurrenceSeries: pinterestScheduleRecurrenceSeries,
	addPinsToQueue: pinterestAddPinsToQueue,
	loadOccupiedSlots: pinterestLoadOccupiedSlots,
	normalizeProgressResult(result, progress) {
		return result?.pinterestResponses || progress?.jobs?.map((job) => ({
			jobId: job.id,
			status: job.status,
			pinId: job.pinterestPinId || '',
			pinUrl: job.pinterestPinUrl || '',
			error: job.lastError || '',
			attemptCount: job.attemptCount || 0,
			boardName: job.boardName || '',
			accountLabel: job.accountLabel || '',
		})) || [];
	},
};

export const facebookDestinationAdapter = {
	id: 'facebook',
	accountsPath: '/facebook/accounts?filter=active',
	connectedPath: '/facebook/accounts?filter=connected',
	destinationsPath: (accountId) => `/facebook/pages?accountId=${encodeURIComponent(accountId)}`,
	async listAccounts() {
		try {
			const response = await facebookFetch('/facebook/accounts?filter=active', { method: 'GET' });
			const payload = await parseJson(response);
			if (!response.ok) {
				if (response.status === 404) return [];
				throw new Error(payload?.message || `Failed to load Facebook accounts (${response.status})`);
			}
			return Array.isArray(payload) ? payload : (payload.items || payload.accounts || []);
		} catch (error) {
			if (error?.code === 'FACEBOOK_API_MISSING') return [];
			throw error;
		}
	},
	async listDestinations(accountId) {
		try {
			const response = await facebookFetch(`/facebook/pages?accountId=${encodeURIComponent(accountId)}`, { method: 'GET' });
			const payload = await parseJson(response);
			if (response.status === 404 || response.status === 401) {
				return { items: [], unavailable: true, message: payload?.message || FACEBOOK_API_MISSING };
			}
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to load Facebook Pages (${response.status})`);
			}
			const raw = Array.isArray(payload) ? payload : (payload.items || payload.pages || []);
			return { items: raw.map(mapFacebookPageToBoard), unavailable: false };
		} catch (error) {
			if (error?.code === 'FACEBOOK_API_MISSING') {
				return { items: [], unavailable: true, message: FACEBOOK_API_MISSING };
			}
			throw error;
		}
	},
	validateItem(pin) {
		// Reuse destination-url rules until Facebook-specific validators exist.
		return validatePinPublish(pin);
	},
	formatPublishError(error) {
		if (error?.code === 'FACEBOOK_API_MISSING' || /not available yet/i.test(String(error?.message || ''))) {
			return FACEBOOK_API_MISSING;
		}
		return error?.message || 'Facebook publish failed';
	},
	async publishNow() {
		const error = new Error(FACEBOOK_API_MISSING);
		error.code = 'FACEBOOK_API_MISSING';
		throw error;
	},
	async runPublishNowFlow() {
		const error = new Error(FACEBOOK_API_MISSING);
		error.code = 'FACEBOOK_API_MISSING';
		throw error;
	},
	async watchPublishProgress() {
		return { phase: 'done', jobs: [], message: FACEBOOK_API_MISSING };
	},
	async fetchScheduledJobs() {
		return [];
	},
	summarizePublishResult,
	async schedulePins() {
		const error = new Error(FACEBOOK_API_MISSING);
		error.code = 'FACEBOOK_API_MISSING';
		throw error;
	},
	async scheduleRecurrenceSeries() {
		const error = new Error(FACEBOOK_API_MISSING);
		error.code = 'FACEBOOK_API_MISSING';
		throw error;
	},
	async addPinsToQueue() {
		const error = new Error(FACEBOOK_API_MISSING);
		error.code = 'FACEBOOK_API_MISSING';
		throw error;
	},
	async loadOccupiedSlots() {
		return [];
	},
	normalizeProgressResult(result, progress) {
		return result?.facebookResponses || result?.pinterestResponses || progress?.jobs?.map((job) => ({
			jobId: job.id,
			status: job.status,
			pinId: job.facebookPostId || job.pinterestPinId || '',
			pinUrl: job.facebookPostUrl || job.pinterestPinUrl || '',
			error: job.lastError || '',
			attemptCount: job.attemptCount || 0,
			boardName: job.pageName || job.boardName || '',
			accountLabel: job.accountLabel || '',
		})) || [];
	},
};

export function getDestinationAdapter(destinationId) {
	if (destinationId === 'facebook') return facebookDestinationAdapter;
	return pinterestDestinationAdapter;
}
