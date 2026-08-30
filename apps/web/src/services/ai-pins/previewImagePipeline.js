/**
 * Sprint 3 — Content Studio preview image pipeline.
 * Image provider selection, job queue, polling, and compose live here.
 * Text copy is resolved separately (aiPinsPinCopy); this module never chooses copy.
 *
 * Featured / Always Featured (imageMode use_featured) composes the article image
 * and does not enqueue AI image jobs.
 * generate_ai requires a real AI image job success — never silently substitutes
 * the article featured image on failure, timeout, or pending.
 */

import { listArticleImageCandidates, pinsNeedingAiImageJobs } from '@/lib/imageSourceStrategy';
import { composeAndUploadFeaturedPins } from '@/services/ai-pins/featuredComposeService';
import { withUpdatedImageSourceMeta } from '@/lib/aiPinsPinCopy';

export const IMAGE_JOB_TERMINAL = new Set(['completed', 'fallback', 'failed']);
export const IMAGE_JOB_PENDING = new Set(['queued', 'processing', 'rendering', 'pending', 'running']);

/** Match server AI_IMAGE_JOB_TIMEOUT_MS default (180s) with margin. */
const POLL_INTERVAL_MS = 2500;
const POLL_ATTEMPTS = 80;
const PREVIEW_COMPOSE_CONCURRENCY = 2;

async function runWithConcurrency(items, concurrency, workerFn) {
	const list = Array.isArray(items) ? items : [];
	if (list.length === 0) {
		return [];
	}
	const results = new Array(list.length);
	let cursor = 0;
	const workerCount = Math.min(Math.max(1, concurrency), list.length);

	async function worker() {
		while (cursor < list.length) {
			const index = cursor;
			cursor += 1;
			results[index] = await workerFn(list[index], index);
		}
	}

	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}

/**
 * Compose pins whose jobs reached a terminal state and are not yet composed.
 * @returns {Promise<Array<{ tempId: string, patch: object }>>}
 */
export async function composeTerminalPreviewPins({
	aiPins = [],
	jobs = [],
	queuedJobs = [],
	composedTempIds = new Set(),
	pollTimedOut = false,
	brandKit = null,
	exportProfileId = 'pinterest_standard',
	isCancelled = () => false,
	missedError = 'AI image generation failed. Please try again.',
} = {}) {
	if (isCancelled()) {
		return [];
	}

	const pendingPins = aiPins.filter((pin) => {
		if (composedTempIds.has(pin.tempId)) {
			return false;
		}
		const job = jobs.find((item) => item.clientToken === pin.tempId || item.id === pin.imageJobId);
		if (!job) {
			return pollTimedOut;
		}
		const status = String(job.status || '').toLowerCase();
		if (IMAGE_JOB_TERMINAL.has(status)) {
			return true;
		}
		// Still pending after poll budget: surface failure, do not wait forever.
		return pollTimedOut;
	});

	if (pendingPins.length === 0) {
		return [];
	}

	const composeInputs = buildComposeInputsFromJobs({
		pins: pendingPins,
		queuedJobs,
		finishedJobs: jobs,
		pollTimedOut,
	});

	// generate_ai: only compose when we have a real AI background URL (completed).
	const withBackground = composeInputs.filter((pin) => (
		pin.featuredImage
		&& !pin._usedArticleFallback
		&& String(pin._aiStatus || '').toLowerCase() === 'completed'
	));
	const withoutBackground = composeInputs.filter((pin) => !withBackground.includes(pin));
	const patches = [];

	for (const missed of withoutBackground) {
		composedTempIds.add(missed.tempId);
		patches.push({
			tempId: missed.tempId,
			patch: {
				imageUrl: '',
				backgroundImageUrl: '',
				imageGenerationStatus: 'failed',
				imageGenerationError: missed._aiError || missedError,
				imageSource: missed.imageSource || 'ai_generated',
			},
		});
	}

	if (withBackground.length === 0 || isCancelled()) {
		return patches;
	}

	const composedResults = await runWithConcurrency(withBackground, PREVIEW_COMPOSE_CONCURRENCY, async (input) => {
		if (isCancelled()) {
			return { input, result: null };
		}
		const [result] = await composeAndUploadFeaturedPins([input], {
			brandKit,
			exportProfileId,
		});
		return { input, result: result || null };
	});

	for (const { input, result } of composedResults) {
		if (!input?.tempId || composedTempIds.has(input.tempId)) {
			continue;
		}
		composedTempIds.add(input.tempId);
		const basePin = aiPins.find((pin) => pin.tempId === input.tempId) || {};
		patches.push({
			tempId: input.tempId,
			patch: mapComposeResultToPinPatch(basePin, input, result),
		});
	}

	return patches;
}

async function pollAndComposePreviewImageJobs({
	fetchFn,
	jobIds,
	aiPins,
	queuedJobs,
	brandKit,
	exportProfileId,
	onJobsUpdate,
	onPinPatch,
	isCancelled = () => false,
} = {}) {
	if (!Array.isArray(jobIds) || jobIds.length === 0) {
		return { jobs: [], pollTimedOut: false, pinPatches: [] };
	}

	const composedTempIds = new Set();
	const pinPatches = [];
	let jobs = [];
	let finishedCleanly = false;

	for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
		if (isCancelled()) {
			break;
		}

		const response = await fetchFn(
			`/ai-pin-images/jobs?ids=${encodeURIComponent(jobIds.join(','))}`,
			{ method: 'GET' },
		);
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(payload?.message || `Failed to poll image jobs (${response.status})`);
		}

		jobs = Array.isArray(payload.items) ? payload.items : [];
		if (typeof onJobsUpdate === 'function') {
			onJobsUpdate(jobs);
		}

		const composePatches = await composeTerminalPreviewPins({
			aiPins,
			jobs,
			queuedJobs,
			composedTempIds,
			pollTimedOut: false,
			brandKit,
			exportProfileId,
			isCancelled,
		});
		for (const item of composePatches) {
			pinPatches.push(item);
			if (typeof onPinPatch === 'function') {
				onPinPatch(item);
			}
		}

		if (jobs.length > 0 && jobs.every((job) => IMAGE_JOB_TERMINAL.has(String(job.status || '').toLowerCase()))) {
			finishedCleanly = true;
			break;
		}

		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}

	const pollTimedOut = !finishedCleanly;
	const remainingPatches = await composeTerminalPreviewPins({
		aiPins,
		jobs,
		queuedJobs,
		composedTempIds,
		pollTimedOut,
		brandKit,
		exportProfileId,
		isCancelled,
	});
	for (const item of remainingPatches) {
		pinPatches.push(item);
		if (typeof onPinPatch === 'function') {
			onPinPatch(item);
		}
	}

	return {
		jobs,
		pollTimedOut,
		pinPatches,
		composedTempIds,
	};
}

export function resolvePreviewImageProvider({
} = {}) {
	return '';
}

/**
 * Resolve background URL for template compose (generate_ai jobs only).
 * Article candidates must never replace a failed/pending/timed-out AI image.
 */
export function resolvePinBackgroundFromJob({ pin, job, pollTimedOut = false } = {}) {
	const articleCandidates = listArticleImageCandidates(pin);
	const aiUrl = String(job?.imageUrl || '').trim();
	const status = String(job?.status || '').toLowerCase();
	const hasArticleCandidates = articleCandidates.length > 0;

	if (status === 'completed' && aiUrl) {
		return {
			background: aiUrl,
			usedArticleFallback: false,
			aiStatus: 'completed',
			aiError: '',
			hasArticleCandidates,
		};
	}

	if (status === 'fallback') {
		return {
			background: '',
			usedArticleFallback: false,
			aiStatus: 'failed',
			aiError: String(job?.lastError || '').trim()
				|| 'AI image generation failed. The article image was not used as a substitute.',
			hasArticleCandidates,
		};
	}

	if (status === 'failed') {
		return {
			background: '',
			usedArticleFallback: false,
			aiStatus: 'failed',
			aiError: String(job?.lastError || '').trim()
				|| 'AI image generation failed. Please try again.',
			hasArticleCandidates,
		};
	}

	if (pollTimedOut || IMAGE_JOB_PENDING.has(status) || !job) {
		return {
			background: '',
			usedArticleFallback: false,
			aiStatus: 'failed',
			aiError: pollTimedOut
				? 'AI image generation timed out. Please try again.'
				: 'AI image generation is still in progress or unavailable.',
			hasArticleCandidates,
		};
	}

	return {
		background: '',
		usedArticleFallback: false,
		aiStatus: status || 'failed',
		aiError: 'AI image generation failed. Please try again.',
		hasArticleCandidates,
	};
}

export function buildComposeInputsFromJobs({ pins, queuedJobs = [], finishedJobs = [], pollTimedOut = false }) {
	return pins.map((pin) => {
		const job = finishedJobs.find((item) => item.clientToken === pin.tempId || item.id === pin.imageJobId)
			|| queuedJobs.find((item) => item.clientToken === pin.tempId);
		const resolved = resolvePinBackgroundFromJob({ pin, job, pollTimedOut });
		return {
			...pin,
			featuredImage: resolved.background,
			contentImages: Array.isArray(pin.contentImages) ? pin.contentImages : [],
			_usedArticleFallback: resolved.usedArticleFallback,
			_aiStatus: resolved.aiStatus,
			_aiError: resolved.aiError,
			_hasArticleCandidates: resolved.hasArticleCandidates,
		};
	});
}

export function mapPollJobToPinPatch(pin, job) {
	if (!job) {
		return pin;
	}
	const status = String(job.status || '').toLowerCase();
	const failed = status === 'failed' || status === 'fallback';
	return {
		...pin,
		imageJobId: job.id,
		backgroundImageUrl: status === 'completed' ? (job.imageUrl || pin.backgroundImageUrl || '') : '',
		imageGenerationStatus: failed ? 'failed' : job.status,
		imageGenerationError: failed
			? (job.lastError || 'AI image generation failed. Please try again.')
			: (job.lastError || ''),
		imageSource: status === 'completed'
			? 'ai_generated'
			: pin.imageSource,
		generationMeta: status === 'completed'
			? withUpdatedImageSourceMeta(
				pin.generationMeta || {
					copySource: pin.copySource,
					fallbackReason: pin.fallbackReason,
				},
				'ai_generated',
			)
			: pin.generationMeta,
	};
}

export function mapComposeResultToPinPatch(pin, input, result) {
	if (!input) {
		return pin;
	}
	if (!result?.ok || !result.imageUrl) {
		if (input._hasArticleCandidates && input._usedArticleFallback) {
			return {
				...pin,
				imageUrl: '',
				imageGenerationStatus: 'failed',
				imageGenerationError: result?.error || input._aiError || 'Template compose failed',
			};
		}
		return {
			...pin,
			imageUrl: '',
			imageGenerationStatus: 'failed',
			imageGenerationError: result?.error || input._aiError || 'Template compose failed',
		};
	}

	if (input._featuredDirect) {
		return {
			...pin,
			imageUrl: result.imageUrl,
			imageSource: 'featured_composed',
			imageOrigin: pin.fallbackImageOrigin || 'featured',
			generationMeta: withUpdatedImageSourceMeta(
				pin.generationMeta || {
					copySource: pin.copySource,
					fallbackReason: pin.fallbackReason,
				},
				'featured_composed',
			),
			imageGenerationStatus: 'completed',
			imageGenerationError: result.hosted === false ? (result.error || '') : '',
			imageJobId: '',
		};
	}

	const usedFallback = input._usedArticleFallback || input._aiStatus === 'fallback';
	if (usedFallback || String(input._aiStatus || '').toLowerCase() === 'failed') {
		return {
			...pin,
			imageUrl: '',
			backgroundImageUrl: '',
			imageSource: 'ai_generated',
			imageOrigin: 'ai',
			generationMeta: withUpdatedImageSourceMeta(
				pin.generationMeta || {
					copySource: pin.copySource,
					fallbackReason: pin.fallbackReason,
				},
				'ai_generated',
			),
			imageGenerationStatus: 'failed',
			imageGenerationError: input._aiError
				|| 'AI image generation failed. Please try again.',
		};
	}

	return {
		...pin,
		imageUrl: result.imageUrl,
		imageSource: 'ai_generated',
		imageOrigin: 'ai',
		generationMeta: withUpdatedImageSourceMeta(
			pin.generationMeta || {
				copySource: pin.copySource,
				fallbackReason: pin.fallbackReason,
			},
			'ai_generated',
		),
		imageGenerationStatus: 'completed',
		imageGenerationError: result.hosted === false ? (result.error || '') : '',
	};
}

export function buildDirectFeaturedComposeInputs(pins = []) {
	return pins.map((pin) => {
		const articleCandidates = listArticleImageCandidates(pin);
		const background = articleCandidates[0] || String(pin?.featuredImage || pin?.sourceImageUrl || '').trim();
		return {
			...pin,
			featuredImage: background,
			contentImages: Array.isArray(pin.contentImages) ? pin.contentImages : [],
			_featuredDirect: true,
			_usedArticleFallback: false,
			_aiStatus: 'skipped',
			_aiError: '',
			_hasArticleCandidates: articleCandidates.length > 0 || Boolean(background),
		};
	});
}

/**
 * Build an Error from /ai-pin-images/jobs (or regenerate) API failure payloads.
 * Preserves FEATURE_LOCKED fields so callers can open UpgradeModal without
 * falling back to featured-image compose.
 */
export function createImageJobsApiError(payload = {}, status = 0, fallbackMessage = '') {
	const message = String(
		payload?.message
		|| fallbackMessage
		|| (status ? `Failed to queue image jobs (${status})` : 'Failed to queue image jobs'),
	).trim();
	const error = new Error(message);
	const errorCode = String(payload?.errorCode || payload?.code || '').trim();
	if (errorCode) {
		error.errorCode = errorCode;
	}
	if (payload?.access && typeof payload.access === 'object') {
		error.access = payload.access;
	}
	if (payload?.featureKey) {
		error.featureKey = payload.featureKey;
	}
	if (Array.isArray(payload?.requiredKeys) && payload.requiredKeys.length) {
		error.requiredKeys = [...payload.requiredKeys];
	}
	if (Array.isArray(payload?.requiredFeatureKeys) && payload.requiredFeatureKeys.length) {
		error.requiredFeatureKeys = [...payload.requiredFeatureKeys];
	}
	if (status) {
		error.status = status;
	}
	return error;
}

export async function queuePreviewImageJobs({
	fetchFn,
	pins,
	channel = '',
	exportProfileId = '',
} = {}) {
	if (!Array.isArray(pins) || pins.length === 0) {
		return [];
	}

	const aiPins = pinsNeedingAiImageJobs(pins);
	if (aiPins.length === 0) {
		return [];
	}

	const normalizedChannel = String(channel || '').trim();
	const normalizedExportProfileId = String(exportProfileId || '').trim();

	const response = await fetchFn('/ai-pin-images/jobs', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			items: aiPins.map((pin) => ({
				clientToken: pin.tempId,
				articleId: pin.articleId,
				title: pin.title,
				description: pin.description,
				overlayText: pin.overlayText,
				keywords: Array.isArray(pin.suggestedKeywords) ? pin.suggestedKeywords : [],
				imagePrompt: pin.imagePrompt,
				category: pin.category,
				featuredImageUrl: pin.featuredImage || pin.sourceImageUrl || '',
				imageMode: 'generate_ai',
				...(normalizedChannel ? { channel: normalizedChannel } : {}),
				...(normalizedExportProfileId ? { exportProfileId: normalizedExportProfileId } : {}),
			})),
		}),
	});

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw createImageJobsApiError(
			payload,
			response.status,
			`Failed to queue image jobs (${response.status})`,
		);
	}

	return Array.isArray(payload.items) ? payload.items : [];
}

export async function pollPreviewImageJobs({
	fetchFn,
	jobIds,
	onJobsUpdate,
} = {}) {
	if (!Array.isArray(jobIds) || jobIds.length === 0) {
		return { jobs: [], pollTimedOut: false };
	}

	let jobs = [];
	let finishedCleanly = false;

	for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
		const response = await fetchFn(
			`/ai-pin-images/jobs?ids=${encodeURIComponent(jobIds.join(','))}`,
			{ method: 'GET' },
		);
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(payload?.message || `Failed to poll image jobs (${response.status})`);
		}

		jobs = Array.isArray(payload.items) ? payload.items : [];
		if (typeof onJobsUpdate === 'function') {
			onJobsUpdate(jobs);
		}

		if (jobs.length > 0 && jobs.every((job) => IMAGE_JOB_TERMINAL.has(String(job.status || '').toLowerCase()))) {
			finishedCleanly = true;
			break;
		}

		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}

	return {
		jobs,
		pollTimedOut: !finishedCleanly,
	};
}

/**
 * Full image pipeline: featured compose and/or queue → poll → fallback compose.
 * Returns pin patches for the UI layer to apply.
 */
export async function runPreviewImagePipeline({
	fetchFn,
	pins,
	brandKit = null,
	exportProfileId = 'pinterest_standard',
	channel = '',
	onJobsUpdate,
	onPinPatch,
	isCancelled = () => false,
} = {}) {
	if (!Array.isArray(pins) || pins.length === 0) {
		return { pinPatches: [], pollTimedOut: false, lastResort: null };
	}

	const aiPins = pinsNeedingAiImageJobs(pins);
	const featuredPins = pins.filter((pin) => !aiPins.includes(pin));
	const pinPatches = [];

	const applyComposeGroup = async (composeInputs, sourcePins, missedError) => {
		const withBackground = composeInputs.filter((pin) => pin.featuredImage || pin._hasArticleCandidates);
		const withoutBackground = composeInputs.filter((pin) => !pin.featuredImage && !pin._hasArticleCandidates);
		for (const missed of withoutBackground) {
			pinPatches.push({
				tempId: missed.tempId,
				patch: {
					imageUrl: '',
					imageGenerationStatus: 'failed',
					imageGenerationError: missed._aiError || missedError,
				},
			});
		}
		if (withBackground.length === 0) {
			return;
		}
		const composed = await composeAndUploadFeaturedPins(withBackground, {
			brandKit,
			exportProfileId,
		});
		for (const input of withBackground) {
			const result = composed.find((item) => item.tempId === input.tempId);
			const basePin = sourcePins.find((item) => item.tempId === input.tempId) || {};
			pinPatches.push({
				tempId: input.tempId,
				patch: mapComposeResultToPinPatch(basePin, input, result),
			});
		}
	};

	if (featuredPins.length > 0) {
		await applyComposeGroup(
			buildDirectFeaturedComposeInputs(featuredPins),
			featuredPins,
			'Article image is required for Featured Image mode.',
		);
		for (const item of pinPatches) {
			if (typeof onPinPatch === 'function') {
				onPinPatch(item);
			}
		}
		if (isCancelled()) {
			return { pinPatches: [], pollTimedOut: false, lastResort: null };
		}
	}

	if (aiPins.length === 0) {
		return { pinPatches, pollTimedOut: false, lastResort: null };
	}

	const queuedJobs = await queuePreviewImageJobs({
		fetchFn,
		pins: aiPins,
		channel,
		exportProfileId,
	});
	if (isCancelled()) {
		return { pinPatches: [], pollTimedOut: false, lastResort: null };
	}

	for (const pin of aiPins) {
		const job = queuedJobs.find((item) => item.clientToken === pin.tempId);
		if (job) {
			pinPatches.push({ tempId: pin.tempId, patch: mapPollJobToPinPatch(pin, job) });
		}
	}

	const jobIds = queuedJobs.map((job) => job.id).filter(Boolean);
	const {
		pollTimedOut,
		pinPatches: polledComposePatches,
	} = await pollAndComposePreviewImageJobs({
		fetchFn,
		jobIds,
		aiPins,
		queuedJobs,
		brandKit,
		exportProfileId,
		onJobsUpdate: (jobs) => {
			if (isCancelled()) {
				return;
			}
			if (typeof onJobsUpdate === 'function') {
				onJobsUpdate(jobs);
			}
		},
		onPinPatch: (item) => {
			if (isCancelled()) {
				return;
			}
			const existing = pinPatches.find((patch) => patch.tempId === item.tempId);
			if (!existing) {
				pinPatches.push(item);
			}
			if (typeof onPinPatch === 'function') {
				onPinPatch(item);
			}
		},
		isCancelled,
	});

	for (const item of polledComposePatches) {
		if (!pinPatches.some((patch) => patch.tempId === item.tempId)) {
			pinPatches.push(item);
		}
	}

	if (isCancelled()) {
		return { pinPatches: [], pollTimedOut, lastResort: null };
	}

	return {
		pinPatches,
		pollTimedOut,
		lastResort: null,
	};
}

export async function runLastResortArticleCompose({
	pins,
	brandKit = null,
	exportProfileId = 'pinterest_standard',
} = {}) {
	const fallbackPins = pins.filter((pin) => String(pin.sourceImageUrl || pin.featuredImage || '').trim());
	if (fallbackPins.length === 0) {
		return null;
	}
	const composed = await composeAndUploadFeaturedPins(
		fallbackPins.map((pin) => ({
			...pin,
			featuredImage: pin.sourceImageUrl || pin.featuredImage,
			contentImages: Array.isArray(pin.contentImages) ? pin.contentImages : [],
		})),
		{ brandKit, exportProfileId },
	);
	return composed;
}
