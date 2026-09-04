/**
 * Writer Image Resolver (M2-B) — library-first.
 *
 * Consumes validated planner output (plan.imageSlots).
 * Preferred path: Pexels stock → acceptability gate → Fal fallback.
 *
 * Public API: resolveArticleImages(plan, context)
 */

import { randomUUID } from 'node:crypto';
import { evaluateAssetAcceptability, isAcceptableStockAsset } from './acceptability.js';
import { withWriterFalCredits } from './credits.js';
import {
	clampMaxFalImages,
	decideAfterStock,
	normalizeAllowFal,
	normalizeAllowStock,
} from './fallback.js';
import { resolveFalSlot } from './providers/fal-adapter.js';
import {
	resolvePexelsApiKey,
	resolvePexelsSlot,
} from './providers/stock-pexels.js';
import {
	ABSOLUTE_MAX_FAL_IMAGES,
	ASSET_SOURCE,
	ASSET_STATUS,
	DEFAULT_MAX_FAL_IMAGES,
	emptyAsset,
} from './types.js';

function trimStr(value) {
	return String(value || '').trim();
}

function readSlots(plan) {
	if (!plan || typeof plan !== 'object') return [];
	const slots = Array.isArray(plan.imageSlots) ? plan.imageSlots : [];
	return slots.filter((slot) => slot && typeof slot === 'object' && trimStr(slot.id));
}

function skippedAsset(slot, reason, errorCode = 'SKIPPED') {
	return emptyAsset({
		status: ASSET_STATUS.SKIPPED,
		source: ASSET_SOURCE.NONE,
		slotId: trimStr(slot?.id),
		alt: trimStr(slot?.altHint || slot?.concept),
		errorCode,
		errorMessage: reason,
	});
}

function failedAsset(slot, reason, errorCode = 'RESOLVE_FAILED') {
	return emptyAsset({
		status: ASSET_STATUS.FAILED,
		source: ASSET_SOURCE.NONE,
		slotId: trimStr(slot?.id),
		alt: trimStr(slot?.altHint || slot?.concept),
		errorCode,
		errorMessage: reason,
	});
}

/** Drop raw Buffers from the public result; keep hasBytes + data URL. */
function sanitizeAssetForReturn(asset) {
	if (!asset || typeof asset !== 'object') return asset;
	const meta = asset.providerMeta && typeof asset.providerMeta === 'object'
		? { ...asset.providerMeta }
		: {};
	if (meta.bytes != null) {
		meta.hasBytes = true;
		meta.byteLength = meta.byteLength
			|| (Buffer.isBuffer(meta.bytes) ? meta.bytes.length : 0);
		delete meta.bytes;
	}
	return { ...asset, providerMeta: meta };
}

function trackStockSelection(asset, usedPhotoIds, usedUrls) {
	const photoId = trimStr(asset?.providerMeta?.photoId);
	const url = trimStr(asset?.url);
	if (photoId) usedPhotoIds.add(photoId);
	if (url) usedUrls.add(url);
}

/**
 * Resolve planner image slots into assets (stock preferred, Fal fallback).
 *
 * @param {{ imageSlots?: object[], plannedCount?: number, requestedCount?: number }} plan
 * @param {object} [context]
 */
export async function resolveArticleImages(plan, context = {}) {
	const deps = context.deps && typeof context.deps === 'object' ? context.deps : {};
	const requestId = trimStr(context.requestId) || randomUUID();
	const workspaceKey = trimStr(context.workspaceKey);
	const allowFal = normalizeAllowFal(context.allowFal);
	const allowStock = normalizeAllowStock(context.allowStock);
	const maxFalImages = clampMaxFalImages(
		context.maxFalImages ?? DEFAULT_MAX_FAL_IMAGES,
		ABSOLUTE_MAX_FAL_IMAGES,
		DEFAULT_MAX_FAL_IMAGES,
	);

	const baseResult = {
		requestId,
		plannedCount: 0,
		resolvedCount: 0,
		failedCount: 0,
		skippedCount: 0,
		falAttempts: 0,
		pexelsAttempts: 0,
		assets: [],
	};

	try {
		const slots = readSlots(plan);
		baseResult.plannedCount = slots.length;

		if (slots.length === 0) {
			return baseResult;
		}

		const resolveFal = typeof deps.resolveFalSlot === 'function'
			? deps.resolveFalSlot
			: resolveFalSlot;
		const resolvePexels = typeof deps.resolvePexelsSlot === 'function'
			? deps.resolvePexelsSlot
			: resolvePexelsSlot;
		const runCredits = typeof deps.withWriterFalCredits === 'function'
			? deps.withWriterFalCredits
			: withWriterFalCredits;

		let falBudget = allowFal ? maxFalImages : 0;
		const usedPhotoIds = new Set();
		const usedUrls = new Set();
		const assets = [];

		const pexelsApiKey = allowStock
			? await resolvePexelsApiKey(context, deps)
			: '';

		for (const slot of slots) {
			let stockResolved = false;

			// ── 1) Preferred: Pexels stock (0 ai_image credits) ──────────────
			if (allowStock && pexelsApiKey) {
				baseResult.pexelsAttempts += 1;
				let stockAsset;
				try {
					stockAsset = await resolvePexels(slot, {
						apiKey: pexelsApiKey,
						timeoutMs: context.pexelsTimeoutMs,
						perPage: context.pexelsPerPage,
						orientation: context.pexelsOrientation,
						usedPhotoIds,
						usedUrls,
						fetchFn: deps.fetchFn || deps.pexelsFetchFn,
						minConfidence: context.stockMinConfidence,
					});
				} catch {
					stockAsset = emptyAsset({
						status: ASSET_STATUS.FAILED,
						source: ASSET_SOURCE.STOCK_PEXELS,
						slotId: trimStr(slot.id),
						errorCode: 'PEXELS_UNEXPECTED',
						errorMessage: 'Pexels provider threw unexpectedly',
					});
				}

				if (
					stockAsset?.status === ASSET_STATUS.RESOLVED
					&& isAcceptableStockAsset(stockAsset)
				) {
					trackStockSelection(stockAsset, usedPhotoIds, usedUrls);
					assets.push(sanitizeAssetForReturn(stockAsset));
					stockResolved = true;
				}
			} else if (allowStock && !pexelsApiKey) {
				// No key: treat as stock unavailable → may Fal fallback
			}

			if (stockResolved) {
				continue;
			}

			// ── 2) Fal fallback (ai_image credits) ───────────────────────────
			const next = decideAfterStock({
				stockResolved: false,
				allowFal,
				falBudgetRemaining: falBudget,
			});

			if (next !== 'fal') {
				const reason = !allowFal
					? (allowStock
						? 'No acceptable Pexels result; Fal disabled (allowFal=false)'
						: 'Fal disabled (allowFal=false)')
					: 'No acceptable Pexels result; Fal budget exhausted (maxFalImages)';
				assets.push(skippedAsset(
					slot,
					reason,
					!allowFal ? 'FAL_DISABLED' : 'FAL_BUDGET',
				));
				continue;
			}

			if (!workspaceKey) {
				assets.push(failedAsset(slot, 'workspaceKey is required for Fal credits', 'WORKSPACE_KEY_REQUIRED'));
				continue;
			}

			let apiKey = trimStr(context.falApiKey);
			if (!apiKey && typeof deps.getFalApiKey === 'function') {
				apiKey = trimStr(await deps.getFalApiKey());
			}

			let asset;
			try {
				asset = await runCredits(
					{
						workspaceKey,
						requestId,
						slotId: trimStr(slot.id),
						actorUserId: context.actorUserId,
					},
					async () => {
						falBudget -= 1;
						baseResult.falAttempts += 1;

						const result = await resolveFal(slot, {
							apiKey,
							model: context.falModel,
							timeoutMs: context.falTimeoutMs,
							generateWithFal: deps.generateWithFal,
						});

						if (!result || result.status !== ASSET_STATUS.RESOLVED) {
							const error = new Error(
								result?.errorMessage || 'Fal resolve did not return a resolved asset',
							);
							error.errorCode = result?.errorCode || 'FAL_RESOLVE_FAILED';
							error.resolverAsset = result || failedAsset(slot, 'empty Fal result');
							throw error;
						}
						return result;
					},
					{
						beginFeatureReservation: deps.beginFeatureReservation,
						settleFeatureReservation: deps.settleFeatureReservation,
					},
				);
			} catch (error) {
				if (error?.resolverAsset) {
					assets.push(error.resolverAsset);
					continue;
				}
				const code = error?.errorCode || 'CREDIT_OR_FAL_FAILED';
				assets.push(failedAsset(
					slot,
					trimStr(error?.message).slice(0, 300) || 'Credit or Fal resolve failed',
					code,
				));
				continue;
			}

			if (!asset || typeof asset !== 'object') {
				assets.push(failedAsset(slot, 'Provider returned empty asset', 'INVALID_PROVIDER_RESPONSE'));
				continue;
			}

			const check = evaluateAssetAcceptability(asset);
			if (asset.status === ASSET_STATUS.RESOLVED && !check.ok) {
				assets.push(emptyAsset({
					...asset,
					status: ASSET_STATUS.FAILED,
					errorCode: 'ASSET_UNACCEPTABLE',
					errorMessage: check.reasons.join('; '),
					url: '',
					providerMeta: {
						...(asset.providerMeta || {}),
						reasons: check.reasons,
						bytes: undefined,
					},
				}));
				continue;
			}

			assets.push(sanitizeAssetForReturn(asset));
		}

		for (const asset of assets) {
			if (asset.status === ASSET_STATUS.RESOLVED) baseResult.resolvedCount += 1;
			else if (asset.status === ASSET_STATUS.FAILED) baseResult.failedCount += 1;
			else baseResult.skippedCount += 1;
		}

		baseResult.assets = assets;
		return baseResult;
	} catch {
		return {
			...baseResult,
			assets: [],
			failedCount: 0,
			skippedCount: 0,
			resolvedCount: 0,
			errorCode: 'RESOLVER_SAFE_FAILURE',
		};
	}
}

export {
	evaluateAssetAcceptability,
	isAcceptableStockAsset,
	isHttpsUrl,
	scoreStockRelevance,
} from './acceptability.js';
export {
	writerImageCreditIdempotencyKey,
	withWriterFalCredits,
} from './credits.js';
export {
	clampMaxFalImages,
	decideAfterStock,
	decideSlotProviderPath,
	normalizeAllowFal,
	normalizeAllowStock,
} from './fallback.js';
export {
	buildFalPromptFromSlot,
	normalizeFalGeneratedAsset,
	resolveFalSlot,
} from './providers/fal-adapter.js';
export {
	buildPexelsSearchQuery,
	normalizePexelsPhoto,
	pickBestPexelsCandidate,
	resolvePexelsSlot,
} from './providers/stock-pexels.js';
export {
	ABSOLUTE_MAX_FAL_IMAGES,
	ASSET_SOURCE,
	ASSET_STATUS,
	DEFAULT_MAX_FAL_IMAGES,
	DEFAULT_PEXELS_PER_PAGE,
	STOCK_MIN_CONFIDENCE,
	WRITER_BLOG_GENERATION_TARGET,
} from './types.js';
