/**
 * Pexels stock provider for Writer Image Resolver (M2-B).
 *
 * Server-side only. Uses planner slot.query as the search string.
 * No CMS upload, no Fal calls, no credit accounting (0 ai_image).
 *
 * Relevance scoring is a deterministic token-overlap heuristic — not AI semantics.
 */

import {
	isAcceptableStockAsset,
	isHttpsUrl,
	scoreStockRelevance,
} from '../acceptability.js';
import {
	ASSET_SOURCE,
	ASSET_STATUS,
	DEFAULT_PEXELS_PER_PAGE,
	DEFAULT_PEXELS_TIMEOUT_MS,
	MIN_STOCK_LONG_EDGE,
	STOCK_MIN_CONFIDENCE,
	emptyAsset,
} from '../types.js';

const PEXELS_SEARCH_URL = 'https://api.pexels.com/v1/search';
const MAX_QUERY_CHARS = 200;
const MAX_RESPONSE_CHARS = 1_500_000;

function trimStr(value) {
	return String(value || '').trim();
}

/**
 * Build Pexels search query from planner slot — prefer query, never invent SEO titles.
 */
export function buildPexelsSearchQuery(slot = {}) {
	const query = trimStr(slot.query);
	const concept = trimStr(slot.concept);
	const altHint = trimStr(slot.altHint);
	const primary = query || concept || altHint;
	return primary.slice(0, MAX_QUERY_CHARS);
}

/**
 * Prefer a stable HTTPS image URL suitable for later media upload pipelines.
 * Order: large2x → large → landscape → original → medium.
 */
export function selectPexelsImageUrl(photo = {}) {
	const src = photo?.src && typeof photo.src === 'object' ? photo.src : {};
	const candidates = [
		src.large2x,
		src.large,
		src.landscape,
		src.original,
		src.medium,
	];
	for (const url of candidates) {
		if (isHttpsUrl(url)) return trimStr(url);
	}
	return '';
}

/**
 * Normalize one Pexels photo into a ResolverAsset candidate (may still fail acceptability).
 */
export function normalizePexelsPhoto(slot, photo, { confidence = null, query = '' } = {}) {
	const slotId = trimStr(slot?.id || slot?.slotId);
	const url = selectPexelsImageUrl(photo);
	const width = Number(photo?.width) || null;
	const height = Number(photo?.height) || null;
	const photographer = trimStr(photo?.photographer);
	const photographerUrl = trimStr(photo?.photographer_url);
	const pageUrl = trimStr(photo?.url);
	const photoId = photo?.id != null ? String(photo.id) : '';
	const alt = trimStr(photo?.alt) || trimStr(slot?.altHint) || trimStr(slot?.concept) || query;

	return emptyAsset({
		status: ASSET_STATUS.RESOLVED,
		source: ASSET_SOURCE.STOCK_PEXELS,
		slotId,
		url,
		width,
		height,
		alt,
		attribution: photographer
			? `Photo by ${photographer} on Pexels`
			: 'Photo on Pexels',
		license: 'Pexels License',
		confidence: confidence == null ? null : Number(confidence),
		providerMeta: {
			provider: 'pexels',
			photoId,
			photographer,
			photographerUrl,
			pexelsPageUrl: pageUrl,
			searchQuery: query,
			srcKeys: photo?.src && typeof photo.src === 'object' ? Object.keys(photo.src) : [],
		},
	});
}

/**
 * Rank + filter Pexels photos for a slot.
 * @returns {{ asset: object|null, candidatesEvaluated: number, reasons: string[] }}
 */
export function pickBestPexelsCandidate(slot, photos, {
	usedPhotoIds = new Set(),
	usedUrls = new Set(),
	minConfidence = STOCK_MIN_CONFIDENCE,
	minLongEdge = MIN_STOCK_LONG_EDGE,
} = {}) {
	const query = buildPexelsSearchQuery(slot);
	const list = Array.isArray(photos) ? photos : [];
	const reasons = [];
	let best = null;
	let bestScore = -1;
	let evaluated = 0;

	for (const photo of list) {
		if (!photo || typeof photo !== 'object') continue;
		evaluated += 1;

		const photoId = photo.id != null ? String(photo.id) : '';
		if (photoId && usedPhotoIds.has(photoId)) {
			reasons.push(`skip duplicate photoId ${photoId}`);
			continue;
		}

		const url = selectPexelsImageUrl(photo);
		if (!url) {
			reasons.push(`skip photo ${photoId || '?'} missing https url`);
			continue;
		}
		if (usedUrls.has(url)) {
			reasons.push(`skip duplicate url for ${photoId || '?'}`);
			continue;
		}

		const width = Number(photo.width) || 0;
		const height = Number(photo.height) || 0;
		const longEdge = Math.max(width, height);
		if (longEdge > 0 && longEdge < minLongEdge) {
			reasons.push(`skip ${photoId}: long edge ${longEdge} < ${minLongEdge}`);
			continue;
		}

		const relevance = scoreStockRelevance({
			query,
			concept: trimStr(slot.concept),
			alt: trimStr(photo.alt),
			photographer: trimStr(photo.photographer),
		});

		if (relevance.score < minConfidence) {
			reasons.push(`skip ${photoId}: confidence ${relevance.score.toFixed(2)} < ${minConfidence}`);
			continue;
		}

		const asset = normalizePexelsPhoto(slot, photo, {
			confidence: relevance.score,
			query,
		});

		if (!isAcceptableStockAsset(asset, { minConfidence, minLongEdge })) {
			reasons.push(`skip ${photoId}: failed acceptability`);
			continue;
		}

		if (relevance.score > bestScore) {
			bestScore = relevance.score;
			best = {
				...asset,
				providerMeta: {
					...asset.providerMeta,
					relevance: relevance.breakdown,
				},
			};
		}
	}

	return {
		asset: best,
		candidatesEvaluated: evaluated,
		reasons,
	};
}

async function readJsonBounded(response, maxChars = MAX_RESPONSE_CHARS) {
	const text = await response.text();
	if (text.length > maxChars) {
		const error = new Error('Pexels response too large');
		error.errorCode = 'PEXELS_RESPONSE_TOO_LARGE';
		throw error;
	}
	try {
		return JSON.parse(text);
	} catch {
		const error = new Error('Pexels returned invalid JSON');
		error.errorCode = 'PEXELS_INVALID_JSON';
		throw error;
	}
}

/**
 * Resolve one planner slot via Pexels search.
 *
 * @param {object} slot
 * @param {{
 *   apiKey?: string,
 *   timeoutMs?: number,
 *   perPage?: number,
 *   orientation?: string,
 *   usedPhotoIds?: Set<string>,
 *   usedUrls?: Set<string>,
 *   fetchFn?: typeof fetch,
 *   minConfidence?: number,
 * }} [context]
 */
export async function resolvePexelsSlot(slot, context = {}) {
	const slotId = trimStr(slot?.id || slot?.slotId);
	if (!slotId) {
		return emptyAsset({
			status: ASSET_STATUS.FAILED,
			source: ASSET_SOURCE.STOCK_PEXELS,
			errorCode: 'INVALID_SLOT',
			errorMessage: 'slot id missing',
		});
	}

	const query = buildPexelsSearchQuery(slot);
	if (!query) {
		return emptyAsset({
			status: ASSET_STATUS.FAILED,
			source: ASSET_SOURCE.STOCK_PEXELS,
			slotId,
			errorCode: 'EMPTY_QUERY',
			errorMessage: 'slot has no query/concept for Pexels',
		});
	}

	const apiKey = trimStr(context.apiKey);
	if (!apiKey) {
		return emptyAsset({
			status: ASSET_STATUS.FAILED,
			source: ASSET_SOURCE.STOCK_PEXELS,
			slotId,
			errorCode: 'PEXELS_API_KEY_MISSING',
			errorMessage: 'Pexels API key is not configured',
		});
	}

	const perPage = Math.max(1, Math.min(15, Number(context.perPage) || DEFAULT_PEXELS_PER_PAGE));
	const orientation = trimStr(context.orientation) || 'landscape';
	const timeoutMs = Number.isFinite(context.timeoutMs) && context.timeoutMs > 0
		? context.timeoutMs
		: DEFAULT_PEXELS_TIMEOUT_MS;

	const url = new URL(PEXELS_SEARCH_URL);
	url.searchParams.set('query', query);
	url.searchParams.set('per_page', String(perPage));
	url.searchParams.set('orientation', orientation);
	url.searchParams.set('size', 'large');

	const fetchFn = typeof context.fetchFn === 'function' ? context.fetchFn : fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetchFn(url.toString(), {
			method: 'GET',
			headers: {
				Authorization: apiKey,
				Accept: 'application/json',
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			return emptyAsset({
				status: ASSET_STATUS.FAILED,
				source: ASSET_SOURCE.STOCK_PEXELS,
				slotId,
				errorCode: 'PEXELS_HTTP_ERROR',
				errorMessage: `Pexels search failed (${response.status})`,
				providerMeta: { status: response.status, searchQuery: query },
			});
		}

		const payload = await readJsonBounded(response);
		const photos = Array.isArray(payload?.photos) ? payload.photos : null;
		if (!photos) {
			return emptyAsset({
				status: ASSET_STATUS.FAILED,
				source: ASSET_SOURCE.STOCK_PEXELS,
				slotId,
				errorCode: 'PEXELS_MALFORMED',
				errorMessage: 'Pexels response missing photos array',
				providerMeta: { searchQuery: query },
			});
		}

		const picked = pickBestPexelsCandidate(slot, photos, {
			usedPhotoIds: context.usedPhotoIds instanceof Set ? context.usedPhotoIds : new Set(),
			usedUrls: context.usedUrls instanceof Set ? context.usedUrls : new Set(),
			minConfidence: context.minConfidence,
		});

		if (!picked.asset) {
			return emptyAsset({
				status: ASSET_STATUS.FAILED,
				source: ASSET_SOURCE.STOCK_PEXELS,
				slotId,
				alt: trimStr(slot?.altHint || slot?.concept),
				errorCode: 'PEXELS_NO_ACCEPTABLE',
				errorMessage: 'No acceptable Pexels candidate',
				providerMeta: {
					searchQuery: query,
					candidatesEvaluated: picked.candidatesEvaluated,
					rejectReasons: picked.reasons.slice(0, 12),
				},
			});
		}

		return picked.asset;
	} catch (error) {
		const aborted = error?.name === 'AbortError';
		return emptyAsset({
			status: ASSET_STATUS.FAILED,
			source: ASSET_SOURCE.STOCK_PEXELS,
			slotId,
			errorCode: aborted ? 'PEXELS_TIMEOUT' : (error?.errorCode || 'PEXELS_REQUEST_FAILED'),
			errorMessage: aborted
				? `Pexels timed out after ${Math.round(timeoutMs / 1000)}s`
				: trimStr(error?.message).slice(0, 300) || 'Pexels request failed',
			providerMeta: { searchQuery: query },
		});
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Resolve Pexels API key without logging it.
 * Order: context.apiKey → deps.getPexelsApiKey → process.env.PEXELS_API_KEY
 */
export async function resolvePexelsApiKey(context = {}, deps = {}) {
	const direct = trimStr(context.pexelsApiKey || context.apiKey);
	if (direct) return direct;
	if (typeof deps.getPexelsApiKey === 'function') {
		return trimStr(await deps.getPexelsApiKey());
	}
	return trimStr(process.env.PEXELS_API_KEY);
}
