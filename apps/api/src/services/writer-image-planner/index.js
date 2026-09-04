/**
 * Writer Image Planner (M1.1) — pure in-memory deterministic planning.
 *
 * Does NOT call external AI, stock providers, CMS publishing, or Writer generation.
 * Optional semanticPlanner hook reserved for later milestones.
 */

import { MAX_IMAGE_COUNT } from './constants.js';
import { detectArticleType } from './detect-article-type.js';
import { buildImageCandidates } from './candidates.js';
import { enrichCandidates, applySemanticPlanner } from './queries.js';
import { selectImageSlots } from './select.js';
import { normalizeImagePlan, validateImagePlan } from './validate.js';

/**
 * @param {object} article — existing Writer article JSON (read-only)
 * @param {{ imageCount?: number, semanticPlanner?: Function }} [options]
 * @returns {{
 *   requestedCount: number,
 *   plannedCount: number,
 *   articleType: string,
 *   imageSlots: Array<object>,
 * }}
 */
export function planArticleImages(article = {}, options = {}) {
	const rawCount = Number(options.imageCount);
	const requestedCount = Number.isFinite(rawCount)
		? Math.min(MAX_IMAGE_COUNT, Math.max(0, Math.floor(rawCount)))
		: 0;

	const articleType = detectArticleType(article);

	if (requestedCount === 0) {
		return {
			requestedCount: 0,
			plannedCount: 0,
			articleType,
			imageSlots: [],
		};
	}

	try {
		const candidates = buildImageCandidates(article, articleType);
		let enriched = enrichCandidates(candidates, article, articleType);

		const semantic = typeof options.semanticPlanner === 'function'
			? options.semanticPlanner
			: applySemanticPlanner;
		enriched = semantic(enriched, article, { articleType, imageCount: requestedCount }) || enriched;

		const selected = selectImageSlots(enriched, { imageCount: requestedCount });
		const draft = {
			requestedCount,
			plannedCount: selected.length,
			articleType,
			imageSlots: selected,
		};

		return normalizeImagePlan(draft, { article });
	} catch {
		// Planner must never break Writer — empty safe plan
		return {
			requestedCount,
			plannedCount: 0,
			articleType,
			imageSlots: [],
		};
	}
}

export {
	MAX_IMAGE_COUNT,
	detectArticleType,
	buildImageCandidates,
	enrichCandidates,
	applySemanticPlanner,
	selectImageSlots,
	validateImagePlan,
	normalizeImagePlan,
};
