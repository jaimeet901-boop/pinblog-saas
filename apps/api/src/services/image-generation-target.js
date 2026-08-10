/**
 * Channel-aware image generation targets for AI background jobs.
 * Compose/export may still resize later; this module only drives provider generation.
 */

export const OPENAI_PINTEREST_SIZE = '1024x1536';
export const OPENAI_FACEBOOK_POST_SIZE = '1536x1024'; // closest supported landscape (~1.5:1)
export const OPENAI_FACEBOOK_STORY_SIZE = '1024x1536'; // closest supported portrait (provider has no 9:16)

/** @typedef {'pinterest' | 'facebook'} ImageGenerationChannel */
/** @typedef {'portrait' | 'landscape'} ImageGenerationOrientation */

/**
 * @typedef {{
 *   channel: ImageGenerationChannel,
 *   exportProfileId: string,
 *   targetWidth: number,
 *   targetHeight: number,
 *   aspectRatio: string,
 *   orientation: ImageGenerationOrientation,
 *   promptOrientation: string,
 *   openaiSize: string,
 *   falImageSize: { width: number, height: number },
 *   geminiAspectRatio: string,
 * }} ImageGenerationTarget
 */

/** @type {ImageGenerationTarget} */
export const PINTEREST_GENERATION_TARGET = Object.freeze({
	channel: 'pinterest',
	exportProfileId: 'pinterest_standard',
	targetWidth: 1000,
	targetHeight: 1500,
	aspectRatio: '2:3',
	orientation: 'portrait',
	promptOrientation: 'vertical 2:3 aspect ratio, full bleed',
	openaiSize: OPENAI_PINTEREST_SIZE,
	falImageSize: Object.freeze({ width: 1000, height: 1500 }),
	geminiAspectRatio: '2:3',
});

/** @type {ImageGenerationTarget} */
export const FACEBOOK_POST_GENERATION_TARGET = Object.freeze({
	channel: 'facebook',
	exportProfileId: 'facebook_post',
	targetWidth: 1200,
	targetHeight: 630,
	aspectRatio: '1.91:1',
	orientation: 'landscape',
	promptOrientation: 'landscape 1.91:1 aspect ratio (target 1200×630), full bleed',
	openaiSize: OPENAI_FACEBOOK_POST_SIZE,
	falImageSize: Object.freeze({ width: 1200, height: 630 }),
	geminiAspectRatio: '16:9',
});

/** @type {ImageGenerationTarget} */
export const FACEBOOK_STORY_GENERATION_TARGET = Object.freeze({
	channel: 'facebook',
	exportProfileId: 'facebook_story',
	targetWidth: 1080,
	targetHeight: 1920,
	aspectRatio: '9:16',
	orientation: 'portrait',
	promptOrientation: 'portrait 9:16 aspect ratio (target 1080×1920), full bleed',
	openaiSize: OPENAI_FACEBOOK_STORY_SIZE,
	falImageSize: Object.freeze({ width: 1080, height: 1920 }),
	geminiAspectRatio: '9:16',
});

function normalizeChannel(value) {
	return String(value || '').trim().toLowerCase();
}

function normalizeExportProfileId(value) {
	return String(value || '').trim().toLowerCase();
}

/**
 * Resolve generation target from channel + export profile.
 * Defaults to Pinterest when channel is not facebook.
 *
 * @param {{ channel?: string, exportProfileId?: string }} [params]
 * @returns {ImageGenerationTarget}
 */
export function resolveImageGenerationTarget({
	channel = '',
	exportProfileId = '',
} = {}) {
	const normalizedChannel = normalizeChannel(channel);
	const normalizedProfile = normalizeExportProfileId(exportProfileId);

	if (normalizedProfile === 'facebook_story') {
		return FACEBOOK_STORY_GENERATION_TARGET;
	}

	if (normalizedProfile === 'facebook_post') {
		return FACEBOOK_POST_GENERATION_TARGET;
	}

	if (normalizedChannel === 'facebook') {
		return FACEBOOK_POST_GENERATION_TARGET;
	}

	return PINTEREST_GENERATION_TARGET;
}

/**
 * Rehydrate a stored generationTarget snapshot from prompt_payload.
 *
 * @param {Record<string, unknown> | null | undefined} snapshot
 * @param {{ channel?: string, exportProfileId?: string }} [fallback]
 * @returns {ImageGenerationTarget}
 */
export function resolveImageGenerationTargetFromPayload(snapshot, fallback = {}) {
	if (snapshot && typeof snapshot === 'object') {
		const profileId = normalizeExportProfileId(snapshot.exportProfileId || fallback.exportProfileId);
		const channel = normalizeChannel(snapshot.channel || fallback.channel);
		return resolveImageGenerationTarget({ channel, exportProfileId: profileId });
	}
	return resolveImageGenerationTarget(fallback);
}

/**
 * Compact snapshot for prompt_payload storage.
 *
 * @param {ImageGenerationTarget} target
 */
export function serializeImageGenerationTarget(target) {
	return {
		channel: target.channel,
		exportProfileId: target.exportProfileId,
		targetWidth: target.targetWidth,
		targetHeight: target.targetHeight,
		aspectRatio: target.aspectRatio,
		orientation: target.orientation,
		openaiSize: target.openaiSize,
		falImageSize: { ...target.falImageSize },
		geminiAspectRatio: target.geminiAspectRatio,
	};
}
