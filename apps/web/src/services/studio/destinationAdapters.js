/**
 * Destination adapters for Content Studio publish / schedule / queue.
 * Pinterest and Facebook share the same Studio contract.
 */

import apiServerClient from '@/lib/apiServerClient';
import {
	runPublishNowFlow as runPinterestPublishNowFlow,
	publishNow as pinterestPublishNow,
	watchPublishProgress as watchPinterestPublishProgress,
	fetchScheduledJobs as fetchPinterestScheduledJobs,
	summarizePublishResult as summarizePinterestPublishResult,
	schedulePins as pinterestSchedulePins,
	scheduleRecurrenceSeries as pinterestScheduleRecurrenceSeries,
	addPinsToQueue as pinterestAddPinsToQueue,
	loadOccupiedSlots as pinterestLoadOccupiedSlots,
	formatPinterestPublishError,
} from '@/services/ai-pins';
import {
	runPublishNowFlow as runFacebookPublishNowFlow,
	publishNow as facebookPublishNow,
	watchPublishProgress as watchFacebookPublishProgress,
	fetchScheduledJobs as fetchFacebookScheduledJobs,
	summarizePublishResult as summarizeFacebookPublishResult,
	schedulePins as facebookSchedulePins,
	scheduleRecurrenceSeries as facebookScheduleRecurrenceSeries,
	addPinsToQueue as facebookAddPinsToQueue,
	loadOccupiedSlots as facebookLoadOccupiedSlots,
	formatFacebookPublishError,
	cancelFacebookJob,
	retryFacebookJob,
	publishNowFacebookJob,
	rescheduleFacebookJob,
} from '@/services/ai-facebook';
import { FACEBOOK_CHANNEL_CAPABILITIES } from '@/lib/facebook/channelCapabilities.js';
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

export const pinterestDestinationAdapter = {
	id: 'pinterest',
	channelCapabilities: {
		connect: true,
		publishNow: true,
		queueImplemented: true,
		schedule: true,
	},
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
	summarizePublishResult: summarizePinterestPublishResult,
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
	channelCapabilities: { ...FACEBOOK_CHANNEL_CAPABILITIES },
	accountsPath: '/facebook/accounts?filter=active',
	connectedPath: '/facebook/accounts?filter=connected',
	destinationsPath: (accountId) => `/facebook/pages?accountId=${encodeURIComponent(accountId)}`,
	async listAccounts() {
		const response = await apiServerClient.fetch('/facebook/accounts?filter=active', { method: 'GET' });
		const payload = await parseJson(response);
		if (!response.ok) {
			throw new Error(payload?.message || `Failed to load Facebook accounts (${response.status})`);
		}
		return Array.isArray(payload) ? payload : (payload.items || payload.accounts || []);
	},
	async listDestinations(accountId) {
		const response = await apiServerClient.fetch(`/facebook/pages?accountId=${encodeURIComponent(accountId)}`, { method: 'GET' });
		const payload = await parseJson(response);
		if (response.status === 404 || response.status === 401) {
			return { items: [], unavailable: true, message: payload?.message };
		}
		if (!response.ok) {
			throw new Error(payload?.message || `Failed to load Facebook Pages (${response.status})`);
		}
		const raw = Array.isArray(payload) ? payload : (payload.items || payload.pages || []);
		return { items: raw.map(mapFacebookPageToBoard), unavailable: false };
	},
	validateItem(pin) {
		return validatePinPublish(pin);
	},
	formatPublishError: formatFacebookPublishError,
	runPublishNowFlow: runFacebookPublishNowFlow,
	publishNow: facebookPublishNow,
	watchPublishProgress: watchFacebookPublishProgress,
	fetchScheduledJobs: fetchFacebookScheduledJobs,
	summarizePublishResult: summarizeFacebookPublishResult,
	schedulePins: facebookSchedulePins,
	scheduleRecurrenceSeries: facebookScheduleRecurrenceSeries,
	addPinsToQueue: facebookAddPinsToQueue,
	loadOccupiedSlots: facebookLoadOccupiedSlots,
	cancelJob: cancelFacebookJob,
	retryJob: retryFacebookJob,
	publishJobNow: publishNowFacebookJob,
	rescheduleJob: rescheduleFacebookJob,
	normalizeProgressResult(result, progress) {
		return result?.facebookResponses || progress?.jobs?.map((job) => ({
			jobId: job.id,
			status: job.status,
			pinId: job.facebookPostId || '',
			pinUrl: job.facebookPostUrl || '',
			error: job.lastError || '',
			attemptCount: job.attemptCount || 0,
			boardName: job.pageName || '',
			accountLabel: job.accountLabel || '',
		})) || [];
	},
};

export function getDestinationAdapter(destinationId) {
	if (destinationId === 'facebook') return facebookDestinationAdapter;
	return pinterestDestinationAdapter;
}
