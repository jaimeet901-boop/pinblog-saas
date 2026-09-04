/**
 * Writer article-images orchestration (M3-A / M3-B0).
 * Pure side-channel: plan + resolve after article JSON exists.
 * M3-B0: enrich resolved assets with Planner placement via slotId join.
 * Does not call the LLM, mutate article text, or compose HTML.
 */

import { planArticleImages } from './writer-image-planner/index.js';
import { resolveArticleImages } from './writer-image-resolver/index.js';

export const WRITER_IMAGE_COUNT_MAX = 5;

/**
 * @param {unknown} value
 * @returns {number} integer 0–5
 */
export function normalizeWriterImageCount(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(WRITER_IMAGE_COUNT_MAX, Math.floor(n)));
}

/**
 * Soft readiness check — matches Planner’s tolerance, not a strict schema.
 * @param {unknown} article
 */
export function isPlannerReadyArticle(article) {
	if (!article || typeof article !== 'object' || Array.isArray(article)) {
		return false;
	}
	const hasTitle = String(article.seo_title || '').trim().length > 0;
	const hasIntro = String(article.introduction || '').trim().length > 0;
	const sections = Array.isArray(article.sections) ? article.sections : [];
	const hasSection = sections.some((s) => s && typeof s === 'object'
		&& (String(s.heading || '').trim() || String(s.content || '').trim()));
	return hasTitle || hasIntro || hasSection;
}

export function emptyWriterImagesResult(requestedCount = 0) {
	const requested = normalizeWriterImageCount(requestedCount);
	return {
		requestedCount: requested,
		plannedCount: 0,
		resolvedCount: 0,
		failedCount: 0,
		skippedCount: 0,
		falAttempts: 0,
		pexelsAttempts: 0,
		assets: [],
	};
}

/**
 * Deterministic heading fingerprint for later HTML placement checks.
 * Tolerates whitespace / case only — no fuzzy matching.
 * @param {unknown} heading
 * @returns {string|null}
 */
export function normalizeHeadingFingerprint(heading) {
	const normalized = String(heading ?? '')
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase();
	return normalized || null;
}

/**
 * Build slotId → planner slot map. Exact id match only; first wins.
 * @param {unknown} plan
 * @returns {Map<string, object>}
 */
export function buildPlannerSlotIndex(plan) {
	const map = new Map();
	const slots = Array.isArray(plan?.imageSlots) ? plan.imageSlots : [];
	for (const slot of slots) {
		if (!slot || typeof slot !== 'object') continue;
		const id = String(slot.id || '').trim();
		if (!id || map.has(id)) continue;
		map.set(id, slot);
	}
	return map;
}

/**
 * Normalize sectionIndex from a planner slot without inventing values.
 * @param {unknown} raw
 * @returns {number|null}
 */
function readSlotSectionIndex(raw) {
	if (raw == null || raw === '') return null;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 0) return null;
	return n;
}

/**
 * Join resolved assets to originating planner slots by exact slotId.
 * Adds placement fields only when a matching slot exists.
 * Does not parse placement from slotId strings.
 *
 * @param {unknown} assets
 * @param {unknown} plan
 * @param {unknown} article
 * @returns {object[]}
 */
export function enrichAssetsWithPlannerPlacement(assets, plan, article) {
	const list = Array.isArray(assets) ? assets : [];
	const slotById = buildPlannerSlotIndex(plan);
	const sections = Array.isArray(article?.sections) ? article.sections : [];

	return list.map((asset) => {
		if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
			return asset;
		}

		const slotId = String(asset.slotId || '').trim();
		const slot = slotId ? slotById.get(slotId) : null;
		if (!slot) {
			// No matching planner slot — do not invent placement metadata
			return { ...asset };
		}

		const type = String(slot.type || '').trim() || null;
		const sectionIndex = readSlotSectionIndex(slot.sectionIndex);
		const afterRaw = String(slot.after ?? '').trim();
		const after = afterRaw || null;

		let headingFingerprint = null;
		if (type === 'inline' && Number.isInteger(sectionIndex)) {
			const heading = sections[sectionIndex]?.heading;
			headingFingerprint = normalizeHeadingFingerprint(heading);
		}

		return {
			...asset,
			type,
			sectionIndex,
			after,
			headingFingerprint,
		};
	});
}

/**
 * @param {{
 *   article: object,
 *   imageCount: unknown,
 *   requestId?: string,
 *   workspaceKey: string,
 *   allowFal?: boolean,
 *   maxFalImages?: number,
 * }} input
 * @param {{
 *   planArticleImages?: Function,
 *   resolveArticleImages?: Function,
 *   getFalApiKey?: Function,
 *   getPexelsApiKey?: Function,
 * }} [deps]
 * @returns {Promise<{ images: object|null, skipped: boolean, reason?: string }>}
 */
export async function runWriterArticleImages(input = {}, deps = {}) {
	const imageCount = normalizeWriterImageCount(input.imageCount);
	if (imageCount === 0) {
		return { images: null, skipped: true, reason: 'imageCount=0' };
	}

	const workspaceKey = String(input.workspaceKey || '').trim();
	if (!workspaceKey) {
		const error = new Error('workspaceKey is required');
		error.status = 422;
		error.errorCode = 'WORKSPACE_KEY_REQUIRED';
		throw error;
	}

	const requestId = String(input.requestId || '').trim()
		|| `writer-images:${Date.now()}`;

	if (!isPlannerReadyArticle(input.article)) {
		return {
			images: emptyWriterImagesResult(imageCount),
			skipped: false,
			reason: 'article_not_ready',
		};
	}

	const planFn = typeof deps.planArticleImages === 'function'
		? deps.planArticleImages
		: planArticleImages;
	const resolveFn = typeof deps.resolveArticleImages === 'function'
		? deps.resolveArticleImages
		: resolveArticleImages;

	const allowFal = input.allowFal !== false;
	const maxFalImages = Number.isFinite(Number(input.maxFalImages))
		? Math.max(0, Math.min(WRITER_IMAGE_COUNT_MAX, Math.floor(Number(input.maxFalImages))))
		: Math.min(imageCount, 3);

	const plan = planFn(input.article, { imageCount });
	const resolved = await resolveFn(plan, {
		workspaceKey,
		allowFal,
		allowStock: true,
		maxFalImages,
		requestId,
		deps: {
			getFalApiKey: deps.getFalApiKey,
			getPexelsApiKey: deps.getPexelsApiKey,
			generateWithFal: deps.generateWithFal,
			beginFeatureReservation: deps.beginFeatureReservation,
			settleFeatureReservation: deps.settleFeatureReservation,
			fetchFn: deps.fetchFn,
			pexelsFetchFn: deps.pexelsFetchFn,
		},
	});

	const rawAssets = Array.isArray(resolved?.assets) ? resolved.assets : [];
	const assets = enrichAssetsWithPlannerPlacement(rawAssets, plan, input.article);

	return {
		images: {
			requestedCount: imageCount,
			plannedCount: Number(resolved?.plannedCount) || 0,
			resolvedCount: Number(resolved?.resolvedCount) || 0,
			failedCount: Number(resolved?.failedCount) || 0,
			skippedCount: Number(resolved?.skippedCount) || 0,
			falAttempts: Number(resolved?.falAttempts) || 0,
			pexelsAttempts: Number(resolved?.pexelsAttempts) || 0,
			assets,
		},
		skipped: false,
	};
}
