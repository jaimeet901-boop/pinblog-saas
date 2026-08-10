/**
 * Sprint 3 — Content Studio preview image pipeline.
 * Image provider selection, job queue, polling, fallback, and compose live here.
 * Text copy is resolved separately (aiPinsPinCopy); this module never chooses copy.
 *
 * Article images are fallback-only (AI failure / timeout / quota / unavailable).
 */

import { listArticleImageCandidates } from '@/lib/imageSourceStrategy';
import { resolveDefaultImageProvider } from '@/lib/aiPinsWorkspaceConfig';
import { composeAndUploadFeaturedPins } from '@/services/ai-pins/featuredComposeService';
import { withUpdatedImageSourceMeta } from '@/lib/aiPinsPinCopy';

export const IMAGE_JOB_TERMINAL = new Set(['completed', 'fallback', 'failed']);
export const IMAGE_JOB_PENDING = new Set(['queued', 'processing', 'rendering', 'pending', 'running']);

const POLL_ATTEMPTS = 48;
const POLL_INTERVAL_MS = 2500;

export function resolvePreviewImageProvider({
	imageProviderOverride = '',
	panelImageProvider = '',
	config = {},
} = {}) {
	return String(
		imageProviderOverride
		|| panelImageProvider
		|| resolveDefaultImageProvider(config)
		|| '',
	).trim();
}

/**
 * Resolve background URL for template compose.
 * Article candidates are used only when AI did not succeed.
 */
export function resolvePinBackgroundFromJob({ pin, job, pollTimedOut = false } = {}) {
	const articleCandidates = listArticleImageCandidates(pin);
	const aiUrl = String(job?.imageUrl || '').trim();
	const status = String(job?.status || '').toLowerCase();
	const aiError = String(job?.lastError || '').trim();

	if (status === 'completed' && aiUrl) {
		return {
			background: aiUrl,
			usedArticleFallback: false,
			aiStatus: 'completed',
			aiError: '',
			hasArticleCandidates: articleCandidates.length > 0,
		};
	}

	if (status === 'fallback' && aiUrl) {
		return {
			background: aiUrl,
			usedArticleFallback: true,
			aiStatus: 'fallback',
			aiError: aiError || 'Image provider unavailable — article image used.',
			hasArticleCandidates: articleCandidates.length > 0,
		};
	}

	const shouldFallback = pollTimedOut
		|| status === 'failed'
		|| IMAGE_JOB_PENDING.has(status);

	if (shouldFallback && articleCandidates.length > 0) {
		return {
			background: articleCandidates[0],
			usedArticleFallback: true,
			aiStatus: pollTimedOut ? 'failed' : (status || 'failed'),
			aiError: aiError
				|| (pollTimedOut
					? 'Image generation timed out — article image used.'
					: 'Image generation failed — article image used.'),
			hasArticleCandidates: true,
		};
	}

	return {
		background: aiUrl || '',
		usedArticleFallback: false,
		aiStatus: status || (pollTimedOut ? 'failed' : ''),
		aiError: aiError
			|| (pollTimedOut ? 'Image generation timed out and no article image was available.' : ''),
		hasArticleCandidates: articleCandidates.length > 0,
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
	return {
		...pin,
		imageJobId: job.id,
		backgroundImageUrl: job.imageUrl || pin.backgroundImageUrl || '',
		imageGenerationStatus: job.status,
		imageGenerationError: job.lastError || '',
		imageSource: job.status === 'completed'
			? 'ai_generated'
			: job.status === 'fallback'
				? 'featured_fallback'
				: pin.imageSource,
		generationMeta: (job.status === 'completed' || job.status === 'fallback')
			? withUpdatedImageSourceMeta(
				pin.generationMeta || {
					copySource: pin.copySource,
					fallbackReason: pin.fallbackReason,
				},
				job.status === 'completed' ? 'ai_generated' : 'featured_fallback',
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

	const usedFallback = input._usedArticleFallback || input._aiStatus === 'fallback';
	return {
		...pin,
		imageUrl: result.imageUrl,
		imageSource: usedFallback ? 'featured_fallback' : 'ai_generated',
		imageOrigin: usedFallback ? (pin.fallbackImageOrigin || 'featured') : 'ai',
		generationMeta: withUpdatedImageSourceMeta(
			pin.generationMeta || {
				copySource: pin.copySource,
				fallbackReason: pin.fallbackReason,
			},
			usedFallback ? 'featured_fallback' : 'ai_generated',
		),
		imageGenerationStatus: 'completed',
		imageGenerationError: usedFallback
			? (input._aiError || 'AI unavailable — article image composed with template.')
			: (result.hosted === false ? (result.error || '') : ''),
	};
}

export async function queuePreviewImageJobs({
	fetchFn,
	pins,
	imageProvider = '',
	channel = '',
	exportProfileId = '',
} = {}) {
	if (!Array.isArray(pins) || pins.length === 0) {
		return [];
	}

	const normalizedChannel = String(channel || '').trim();
	const normalizedExportProfileId = String(exportProfileId || '').trim();

	const response = await fetchFn('/ai-pin-images/jobs', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			items: pins.map((pin) => ({
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
				...(imageProvider ? { provider: imageProvider } : {}),
				...(normalizedChannel ? { channel: normalizedChannel } : {}),
				...(normalizedExportProfileId ? { exportProfileId: normalizedExportProfileId } : {}),
			})),
		}),
	});

	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(payload?.message || `Failed to queue image jobs (${response.status})`);
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
 * Full image pipeline: queue → poll → fallback compose → template overlay.
 * Returns pin patches for the UI layer to apply.
 */
export async function runPreviewImagePipeline({
	fetchFn,
	pins,
	imageProvider = '',
	brandKit = null,
	exportProfileId = 'pinterest_standard',
	channel = '',
	onJobsUpdate,
	isCancelled = () => false,
} = {}) {
	if (!Array.isArray(pins) || pins.length === 0) {
		return { pinPatches: [], pollTimedOut: false, lastResort: null };
	}

	const pinPatches = [];
	const queuedJobs = await queuePreviewImageJobs({
		fetchFn,
		pins,
		imageProvider,
		channel,
		exportProfileId,
	});
	if (isCancelled()) {
		return { pinPatches: [], pollTimedOut: false, lastResort: null };
	}

	for (const pin of pins) {
		const job = queuedJobs.find((item) => item.clientToken === pin.tempId);
		if (job) {
			pinPatches.push({ tempId: pin.tempId, patch: mapPollJobToPinPatch(pin, job) });
		}
	}

	const jobIds = queuedJobs.map((job) => job.id).filter(Boolean);
	const { jobs: finishedJobs, pollTimedOut } = await pollPreviewImageJobs({
		fetchFn,
		jobIds,
		onJobsUpdate: (jobs) => {
			if (isCancelled()) {
				return;
			}
			if (typeof onJobsUpdate === 'function') {
				onJobsUpdate(jobs);
			}
		},
	});

	if (isCancelled()) {
		return { pinPatches: [], pollTimedOut, lastResort: null };
	}

	const composeInputs = buildComposeInputsFromJobs({
		pins,
		queuedJobs,
		finishedJobs,
		pollTimedOut,
	});

	const withBackground = composeInputs.filter((pin) => pin.featuredImage || pin._hasArticleCandidates);
	const withoutBackground = composeInputs.filter((pin) => !pin.featuredImage && !pin._hasArticleCandidates);

	for (const missed of withoutBackground) {
		pinPatches.push({
			tempId: missed.tempId,
			patch: {
				imageUrl: '',
				imageGenerationStatus: 'failed',
				imageGenerationError: missed._aiError
					|| 'AI image generation failed and no article image was available for fallback.',
			},
		});
	}

	if (withBackground.length > 0) {
		const composed = await composeAndUploadFeaturedPins(withBackground, {
			brandKit,
			exportProfileId,
		});
		for (const input of withBackground) {
			const result = composed.find((item) => item.tempId === input.tempId);
			const basePin = pins.find((item) => item.tempId === input.tempId) || {};
			pinPatches.push({
				tempId: input.tempId,
				patch: mapComposeResultToPinPatch(basePin, input, result),
			});
		}
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
