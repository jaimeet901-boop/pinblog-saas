/**
 * Pure acceptability checks for normalized resolver assets (M2-A/B).
 * No network I/O.
 *
 * Stock relevance scoring is a deterministic token-overlap heuristic.
 * It is NOT semantic AI understanding.
 */

import {
	ASSET_SOURCE,
	ASSET_STATUS,
	MAX_FAL_IMAGE_BYTES,
	MIN_STOCK_LONG_EDGE,
	STOCK_MIN_CONFIDENCE,
} from './types.js';

const ALLOWED_STATUS = new Set(Object.values(ASSET_STATUS));
const IMAGE_MIME = /^image\/(png|jpeg|jpg|webp|gif)$/i;

/** Tokens too common to drive relevance. */
const STOP_WORDS = new Set([
	'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
	'from', 'by', 'is', 'are', 'be', 'as', 'into', 'over', 'under', 'photo',
	'image', 'picture', 'stock', 'being', 'high', 'quality', 'blog',
]);

/**
 * HTTPS URL only (stock / remote). Rejects data:, javascript:, etc.
 */
export function isHttpsUrl(value) {
	const raw = String(value || '').trim();
	if (!raw) return false;
	try {
		const parsed = new URL(raw);
		return parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * data:image/...;base64,... from Fal bytes (M2-A local representation before WP upload).
 */
export function isDataImageUrl(value) {
	const raw = String(value || '').trim();
	return /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(raw);
}

export function hasUsableUrl(asset) {
	const url = String(asset?.url || '').trim();
	if (isHttpsUrl(url) || isDataImageUrl(url)) return true;
	if (asset?.providerMeta?.hasBytes === true && Number(asset?.providerMeta?.byteLength) > 0) {
		return true;
	}
	return false;
}

/**
 * Tokenize for relevance: lowercase alphanumerics, drop stop words & tiny tokens.
 */
export function tokenizeRelevanceText(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.map((t) => t.trim())
		.filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Deterministic stock relevance score in [0, 1].
 *
 * Rewards:
 * - query token overlap with photo alt/description text
 * - concept token overlap
 * - presence of longer subject terms (≥5 chars) from the query
 *
 * Penalizes:
 * - empty/weak alt text
 * - near-zero overlap
 *
 * @param {{ query?: string, concept?: string, alt?: string, photographer?: string }} input
 * @returns {{ score: number, breakdown: object }}
 */
export function scoreStockRelevance(input = {}) {
	const queryTokens = tokenizeRelevanceText(input.query);
	const conceptTokens = tokenizeRelevanceText(input.concept);
	const altTokens = tokenizeRelevanceText(input.alt);
	const corpus = new Set([...altTokens, ...tokenizeRelevanceText(input.photographer)]);

	const breakdown = {
		queryTokenCount: queryTokens.length,
		conceptTokenCount: conceptTokens.length,
		altTokenCount: altTokens.length,
		queryOverlap: 0,
		conceptOverlap: 0,
		subjectHits: 0,
		emptyAltPenalty: 0,
	};

	if (queryTokens.length === 0 && conceptTokens.length === 0) {
		return { score: 0, breakdown: { ...breakdown, note: 'empty query/concept' } };
	}

	let queryHits = 0;
	for (const t of queryTokens) {
		if (corpus.has(t)) queryHits += 1;
	}
	breakdown.queryOverlap = queryTokens.length ? queryHits / queryTokens.length : 0;

	let conceptHits = 0;
	for (const t of conceptTokens) {
		if (corpus.has(t)) conceptHits += 1;
	}
	breakdown.conceptOverlap = conceptTokens.length ? conceptHits / conceptTokens.length : 0;

	const subjectTerms = queryTokens.filter((t) => t.length >= 5);
	let subjectHits = 0;
	for (const t of subjectTerms) {
		if (corpus.has(t)) subjectHits += 1;
	}
	breakdown.subjectHits = subjectTerms.length ? subjectHits / subjectTerms.length : 0;

	if (altTokens.length === 0) {
		breakdown.emptyAltPenalty = 0.25;
	} else if (altTokens.length < 2) {
		breakdown.emptyAltPenalty = 0.1;
	}

	// Weighted blend — query matters most for planner-driven searches.
	let score = (breakdown.queryOverlap * 0.55)
		+ (breakdown.conceptOverlap * 0.2)
		+ (breakdown.subjectHits * 0.25)
		- breakdown.emptyAltPenalty;

	if (queryHits === 0 && conceptHits === 0) {
		score = Math.min(score, 0.15);
	}

	score = Math.max(0, Math.min(1, score));
	return { score: Number(score.toFixed(4)), breakdown };
}

/**
 * @param {object} asset
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function evaluateAssetAcceptability(asset) {
	const reasons = [];
	if (!asset || typeof asset !== 'object') {
		return { ok: false, reasons: ['asset missing'] };
	}

	const status = String(asset.status || '');
	if (!ALLOWED_STATUS.has(status)) {
		reasons.push('invalid status');
	}

	const slotId = String(asset.slotId || '').trim();
	if (!slotId) {
		reasons.push('missing slotId');
	}

	if (status === ASSET_STATUS.RESOLVED) {
		if (!hasUsableUrl(asset)) {
			reasons.push('missing usable url/bytes');
		}
		const contentType = String(asset.providerMeta?.contentType || '');
		if (contentType && !IMAGE_MIME.test(contentType)) {
			reasons.push('unsupported content type');
		}
		const byteLength = Number(asset.providerMeta?.byteLength);
		if (Number.isFinite(byteLength) && byteLength > MAX_FAL_IMAGE_BYTES) {
			reasons.push('image exceeds size limit');
		}
		const width = asset.width;
		const height = asset.height;
		if (width != null && (!Number.isFinite(Number(width)) || Number(width) <= 0)) {
			reasons.push('invalid width');
		}
		if (height != null && (!Number.isFinite(Number(height)) || Number(height) <= 0)) {
			reasons.push('invalid height');
		}
	}

	if (status === ASSET_STATUS.RESOLVED && !String(asset.source || '').trim()) {
		reasons.push('missing source');
	}

	return { ok: reasons.length === 0, reasons };
}

/**
 * Stock acceptability gate (Pexels / future Unsplash).
 * @param {object} asset
 * @param {{ minConfidence?: number, minLongEdge?: number }} [options]
 */
export function isAcceptableStockAsset(asset, options = {}) {
	const result = evaluateAssetAcceptability(asset);
	if (!result.ok) return false;
	if (asset.status !== ASSET_STATUS.RESOLVED) return false;

	const source = String(asset.source || '');
	if (source !== ASSET_SOURCE.STOCK_PEXELS && source !== ASSET_SOURCE.STOCK_UNSPLASH) {
		return false;
	}
	if (!isHttpsUrl(asset.url)) return false;

	const minConfidence = Number.isFinite(options.minConfidence)
		? options.minConfidence
		: STOCK_MIN_CONFIDENCE;
	const confidence = Number(asset.confidence);
	if (!Number.isFinite(confidence) || confidence < minConfidence) return false;

	const minLongEdge = Number.isFinite(options.minLongEdge)
		? options.minLongEdge
		: MIN_STOCK_LONG_EDGE;
	const width = Number(asset.width) || 0;
	const height = Number(asset.height) || 0;
	const longEdge = Math.max(width, height);
	if (longEdge > 0 && longEdge < minLongEdge) return false;

	return true;
}
