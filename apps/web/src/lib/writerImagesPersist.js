/**
 * Writer image persistence — host Fal data:image URLs before articles.body save.
 * Reuses uploadImageBlob → /ai-pin-images/composed (no Fal re-gen, no ai_image credits).
 */

const ALLOWED_DATA_IMAGE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAllowedWriterHttpsImageUrl(value) {
	const raw = String(value ?? '').trim();
	if (!raw || raw.startsWith('//')) return false;
	try {
		const parsed = new URL(raw);
		return parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAllowedWriterDataImageUrl(value) {
	return ALLOWED_DATA_IMAGE.test(String(value ?? '').trim());
}

/**
 * Decode an allowlisted Fal-style data:image URL to a Blob.
 * @param {unknown} dataUrl
 * @returns {Blob|null}
 */
export function dataImageUrlToBlob(dataUrl) {
	const raw = String(dataUrl ?? '').trim();
	const match = raw.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
	if (!match) return null;

	let mime = match[1].toLowerCase();
	if (mime === 'image/jpg') mime = 'image/jpeg';
	const b64 = match[2].replace(/\s+/g, '');

	try {
		const binary = globalThis.atob(b64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return new Blob([bytes], { type: mime });
	} catch {
		return null;
	}
}

function extensionForMime(mime) {
	const m = String(mime || '').toLowerCase();
	if (m === 'image/png') return 'png';
	if (m === 'image/webp') return 'webp';
	if (m === 'image/gif') return 'gif';
	return 'jpg';
}

function cloneAsset(asset) {
	if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return null;
	const next = { ...asset };
	if (asset.providerMeta && typeof asset.providerMeta === 'object' && !Array.isArray(asset.providerMeta)) {
		next.providerMeta = { ...asset.providerMeta };
	}
	return next;
}

/**
 * Sync guard: drop any data:image (or non-HTTPS) URLs from writer images before PB persist.
 * Preserves placement metadata on assets that keep an HTTPS URL.
 * @param {unknown} images
 * @returns {object|null}
 */
export function sanitizeWriterImagesForPersist(images) {
	if (!images || typeof images !== 'object' || Array.isArray(images)) return null;
	const assetsIn = Array.isArray(images.assets) ? images.assets : [];
	const assets = [];

	for (const asset of assetsIn) {
		const copy = cloneAsset(asset);
		if (!copy) continue;
		const url = String(copy.url || '').trim();
		if (!isAllowedWriterHttpsImageUrl(url)) continue;
		copy.url = url;
		assets.push(copy);
	}

	if (!assets.length) return null;

	const resolvedCount = assets.filter((a) => a.status === 'resolved').length;
	return {
		...images,
		assets,
		resolvedCount,
	};
}

/**
 * Host Fal data:image assets via uploadImageBlob; leave HTTPS URLs unchanged.
 * Never calls Fal / never charges ai_image. Per-asset failures omit that asset.
 *
 * @param {unknown} images
 * @param {{
 *   uploadImageBlob?: (blob: Blob, meta?: object) => Promise<{ imageUrl: string }>,
 *   title?: string,
 * }} [deps]
 * @returns {Promise<{
 *   images: object|null,
 *   stats: { hosted: number, passthrough: number, failed: number, omitted: number },
 * }>}
 */
export async function ensureWriterImagesHosted(images, deps = {}) {
	const emptyStats = { hosted: 0, passthrough: 0, failed: 0, omitted: 0 };
	if (!images || typeof images !== 'object' || Array.isArray(images)) {
		return { images: null, stats: emptyStats };
	}

	const assetsIn = Array.isArray(images.assets) ? images.assets : [];
	if (!assetsIn.length) {
		return { images: { ...images, assets: [] }, stats: emptyStats };
	}

	let uploadFn = deps.uploadImageBlob;
	if (typeof uploadFn !== 'function') {
		const mod = await import('@/services/ai-pins/imageLifecycle.js');
		uploadFn = mod.uploadImageBlob;
	}

	const title = String(deps.title || 'writer-article-image').slice(0, 220);
	const outAssets = [];
	const stats = { hosted: 0, passthrough: 0, failed: 0, omitted: 0 };

	for (const asset of assetsIn) {
		const copy = cloneAsset(asset);
		if (!copy) {
			stats.omitted += 1;
			continue;
		}

		const url = String(copy.url || '').trim();
		const isResolved = copy.status === 'resolved';

		if (isAllowedWriterHttpsImageUrl(url)) {
			copy.url = url;
			outAssets.push(copy);
			stats.passthrough += 1;
			continue;
		}

		if (!isResolved) {
			stats.omitted += 1;
			continue;
		}

		if (!isAllowedWriterDataImageUrl(url)) {
			stats.omitted += 1;
			stats.failed += 1;
			continue;
		}

		const blob = dataImageUrlToBlob(url);
		if (!blob) {
			stats.omitted += 1;
			stats.failed += 1;
			continue;
		}

		try {
			const ext = extensionForMime(blob.type);
			const slot = String(copy.slotId || copy.type || 'image')
				.toLowerCase()
				.replace(/[^a-z0-9_-]+/g, '-')
				.slice(0, 48) || 'image';
			const uploaded = await uploadFn(blob, {
				title,
				fileName: `writer-${slot}.${ext}`,
			});
			const hostedUrl = String(uploaded?.imageUrl || '').trim();
			if (!isAllowedWriterHttpsImageUrl(hostedUrl)) {
				stats.omitted += 1;
				stats.failed += 1;
				continue;
			}
			copy.url = hostedUrl;
			outAssets.push(copy);
			stats.hosted += 1;
		} catch {
			stats.omitted += 1;
			stats.failed += 1;
		}
	}

	if (!outAssets.length) {
		return { images: null, stats };
	}

	const resolvedCount = outAssets.filter((a) => a.status === 'resolved').length;
	return {
		images: {
			...images,
			assets: outAssets,
			resolvedCount,
		},
		stats,
	};
}
