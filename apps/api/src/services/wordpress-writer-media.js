/**
 * M3-C — Writer → WordPress Media Library helpers.
 * Pure-ish utilities + hardened image load for uploadWordpressMedia.
 * Does not touch Planner, Resolver, credits, or Fal generation billing.
 */

export const WP_WRITER_MEDIA_MAX_BYTES = 12 * 1024 * 1024;
export const WP_WRITER_MEDIA_DOWNLOAD_TIMEOUT_MS = 20_000;
export const WP_WRITER_MEDIA_UPLOAD_TIMEOUT_MS = 60_000;

const ALLOWED_DATA_IMAGE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i;
const ALLOWED_MIME = new Set([
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
	'image/gif',
]);

const SNAPSHOT_KEYS = [
	'status',
	'source',
	'slotId',
	'type',
	'sectionIndex',
	'after',
	'headingFingerprint',
	'url',
	'width',
	'height',
	'alt',
	'attribution',
	'license',
	'confidence',
];

function mediaError(status, message, errorCode, { retryable = false } = {}) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	error.retryable = retryable;
	return error;
}

/**
 * @param {Uint8Array|Buffer} bytes
 * @returns {string|null}
 */
export function detectWpWriterImageMagic(bytes) {
	if (!bytes || bytes.length < 3) return null;
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return 'image/png';
	}
	if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
		return 'image/gif';
	}
	if (
		bytes.length >= 12
		&& bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
		&& bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
	) {
		return 'image/webp';
	}
	return null;
}

function normalizeMime(mime) {
	const raw = String(mime || '').split(';')[0].trim().toLowerCase();
	if (raw === 'image/jpg') return 'image/jpeg';
	return raw;
}

function extensionForMime(mime) {
	const m = normalizeMime(mime);
	if (m === 'image/png') return 'png';
	if (m === 'image/webp') return 'webp';
	if (m === 'image/gif') return 'gif';
	return 'jpg';
}

/**
 * Decode allowlisted Fal-style data:image URLs (no HTTP).
 * @param {unknown} value
 * @returns {{ buffer: Buffer, contentType: string }}
 */
export function decodeWpWriterDataImageUrl(value) {
	const raw = String(value || '').trim();
	if (!raw) {
		throw mediaError(422, 'Empty data URL', 'VALIDATION_ERROR');
	}
	if (!ALLOWED_DATA_IMAGE.test(raw)) {
		throw mediaError(422, 'Unsupported data URL image type', 'VALIDATION_ERROR');
	}
	const comma = raw.indexOf(',');
	if (comma < 0) {
		throw mediaError(422, 'Malformed data URL', 'VALIDATION_ERROR');
	}
	const header = raw.slice(0, comma);
	const payload = raw.slice(comma + 1);
	if (!/;base64/i.test(header) || !payload) {
		throw mediaError(422, 'Data URL must be base64', 'VALIDATION_ERROR');
	}
	// Reject oversized payloads before allocating a huge Buffer
	const approxBytes = Math.floor(payload.replace(/\s/g, '').length * 0.75);
	if (approxBytes > WP_WRITER_MEDIA_MAX_BYTES) {
		throw mediaError(422, 'Decoded image exceeds size limit', 'VALIDATION_ERROR');
	}
	const mimeMatch = header.match(/^data:(image\/[a-z0-9.+-]+);base64$/i);
	const declared = normalizeMime(mimeMatch?.[1]);
	if (!ALLOWED_MIME.has(declared) && declared !== 'image/jpg') {
		throw mediaError(422, 'Unsupported data image MIME', 'VALIDATION_ERROR');
	}

	let buffer;
	try {
		buffer = Buffer.from(payload, 'base64');
	} catch {
		throw mediaError(422, 'Invalid base64 image data', 'VALIDATION_ERROR');
	}
	// Node Buffer.from ignores invalid chars; detect empty / garbage
	if (!buffer.length || (payload.replace(/\s/g, '').length > 8 && buffer.length < 4)) {
		throw mediaError(422, 'Invalid base64 image data', 'VALIDATION_ERROR');
	}
	if (buffer.length > WP_WRITER_MEDIA_MAX_BYTES) {
		throw mediaError(422, 'Decoded image exceeds size limit', 'VALIDATION_ERROR');
	}
	const magic = detectWpWriterImageMagic(buffer);
	if (!magic || !ALLOWED_MIME.has(magic)) {
		throw mediaError(422, 'Image magic bytes invalid', 'VALIDATION_ERROR');
	}
	return { buffer, contentType: magic };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isWpWriterDataImageUrl(value) {
	return ALLOWED_DATA_IMAGE.test(String(value || '').trim());
}

/**
 * @param {unknown} value
 * @param {{ requireHttps?: boolean }} [opts]
 * @returns {boolean}
 */
export function isAllowedWpWriterRemoteImageUrl(value, { requireHttps = true } = {}) {
	const raw = String(value || '').trim();
	if (!raw || raw.startsWith('//')) return false;
	try {
		const parsed = new URL(raw);
		if (requireHttps) return parsed.protocol === 'https:';
		return parsed.protocol === 'https:' || parsed.protocol === 'http:';
	} catch {
		return false;
	}
}

/**
 * Load image bytes for WordPress upload (HTTPS via SSRF-safe fetch, or data: decode).
 *
 * @param {string} imageUrl
 * @param {{
 *   requireHttps?: boolean,
 *   timeoutMs?: number,
 *   maxBytes?: number,
 *   fetchFn?: typeof fetch,
 *   safeFetchFn?: Function,
 *   fieldName?: string,
 * }} [options]
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function loadImageBytesForWordpressUpload(imageUrl, options = {}) {
	const raw = String(imageUrl || '').trim();
	if (!raw) {
		throw mediaError(422, 'imageUrl is required', 'VALIDATION_ERROR');
	}

	if (raw.toLowerCase().startsWith('data:')) {
		return decodeWpWriterDataImageUrl(raw);
	}

	const requireHttps = options.requireHttps !== false;
	if (!isAllowedWpWriterRemoteImageUrl(raw, { requireHttps })) {
		throw mediaError(422, 'Only HTTPS image URLs are allowed', 'VALIDATION_ERROR');
	}

	const timeoutMs = Number.isFinite(Number(options.timeoutMs))
		? Math.max(1000, Number(options.timeoutMs))
		: WP_WRITER_MEDIA_DOWNLOAD_TIMEOUT_MS;
	const maxBytes = Number.isFinite(Number(options.maxBytes)) && Number(options.maxBytes) > 0
		? Math.floor(Number(options.maxBytes))
		: WP_WRITER_MEDIA_MAX_BYTES;
	const fieldName = options.fieldName || 'image_url';

	const safeFetchFn = typeof options.safeFetchFn === 'function'
		? options.safeFetchFn
		: async (url, opts) => {
			const { safeFetch } = await import('../utils/ssrf-guard.js');
			return safeFetch(url, opts);
		};

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let response;
	try {
		({ response } = await safeFetchFn(raw, {
			fieldName,
			signal: controller.signal,
			headers: {
				Accept: 'image/jpeg,image/png,image/webp,image/gif,image/*;q=0.8',
			},
		}));
	} catch (err) {
		if (err?.name === 'AbortError' || /aborted/i.test(String(err?.message || ''))) {
			throw mediaError(504, 'Image download timed out', 'WP_MEDIA_DOWNLOAD_FAILED', { retryable: true });
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}

	if (!response?.ok) {
		const status = Number(response?.status) || 502;
		const error = mediaError(status, `Image download failed (${status})`, 'WP_MEDIA_DOWNLOAD_FAILED', {
			retryable: status >= 500 || status === 429,
		});
		error.httpStatus = status;
		throw error;
	}

	const declaredHeader = normalizeMime(response.headers?.get?.('content-type'));
	if (declaredHeader === 'image/svg+xml' || declaredHeader.startsWith('text/html')) {
		throw mediaError(422, 'Disallowed image content type', 'VALIDATION_ERROR');
	}

	const contentLength = Number(response.headers?.get?.('content-length'));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		throw mediaError(422, 'Image exceeds size limit', 'VALIDATION_ERROR');
	}

	const fetchFn = typeof options.fetchFn === 'function' ? options.fetchFn : null;
	void fetchFn; // reserved for tests that inject at safeFetch layer

	const arrayBuffer = await response.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);
	if (buffer.length > maxBytes) {
		throw mediaError(422, 'Image exceeds size limit', 'VALIDATION_ERROR');
	}
	if (!buffer.length) {
		throw mediaError(422, 'Empty image response', 'VALIDATION_ERROR');
	}

	const magic = detectWpWriterImageMagic(buffer);
	if (!magic || !ALLOWED_MIME.has(magic)) {
		throw mediaError(422, 'Image magic bytes invalid', 'VALIDATION_ERROR');
	}

	return { buffer, contentType: magic };
}

/**
 * Safe deterministic filename from slot/context + validated MIME.
 * @param {{ slotId?: string, type?: string, contentType?: string, slug?: string }} input
 */
export function buildWpWriterMediaFilename(input = {}) {
	const mime = normalizeMime(input.contentType) || 'image/jpeg';
	const ext = extensionForMime(mime);
	const slot = String(input.slotId || input.type || 'image')
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48) || 'image';
	const slug = String(input.slug || '')
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	const base = slug ? `writer-${slug}-${slot}` : `writer-${slot}`;
	return `${base.slice(0, 80)}.${ext}`;
}

/**
 * Compact snapshot for publish_jobs.payload (no binary buffers).
 * @param {unknown} images
 */
export function sanitizeWriterImagesSnapshot(images) {
	if (!images || typeof images !== 'object') return null;
	const assetsIn = Array.isArray(images.assets) ? images.assets : [];
	const assets = [];
	for (const asset of assetsIn.slice(0, 8)) {
		if (!asset || typeof asset !== 'object') continue;
		const row = {};
		for (const key of SNAPSHOT_KEYS) {
			if (asset[key] === undefined) continue;
			if (key === 'url') {
				row.url = String(asset.url || '').slice(0, WP_WRITER_MEDIA_MAX_BYTES * 2);
				continue;
			}
			if (key === 'alt' || key === 'attribution' || key === 'license' || key === 'headingFingerprint') {
				row[key] = String(asset[key] ?? '').slice(0, 500);
				continue;
			}
			if (key === 'providerMeta') continue;
			row[key] = asset[key];
		}
		if (asset.providerMeta && typeof asset.providerMeta === 'object') {
			const meta = asset.providerMeta;
			row.providerMeta = {
				photoId: meta.photoId != null ? String(meta.photoId).slice(0, 64) : undefined,
				provider: meta.provider != null ? String(meta.provider).slice(0, 40) : undefined,
			};
		}
		if (row.status === 'resolved' && row.url) assets.push(row);
	}
	if (!assets.length) return null;
	return {
		requestedCount: Number(images.requestedCount) || assets.length,
		resolvedCount: Number(images.resolvedCount) || assets.length,
		assets,
	};
}

/**
 * @param {object} job
 * @param {{ getArticle?: Function }} [deps]
 */
export async function resolveWriterImagesForJob(job, deps = {}) {
	const fromPayload = sanitizeWriterImagesSnapshot(job?.payload?.writerImages);
	if (fromPayload) return fromPayload;

	const articleId = String(job?.article_id || '').trim();
	if (!articleId || typeof deps.getArticle !== 'function') return null;
	try {
		const record = await deps.getArticle(articleId);
		const body = record?.body && typeof record.body === 'object' ? record.body : record;
		return sanitizeWriterImagesSnapshot(body?.images);
	} catch {
		return null;
	}
}

/**
 * Rewrite only seodeva-article-image img src values present in urlMap.
 * @param {string} html
 * @param {Map<string, string>|Record<string, string>} urlMap originalUrl → wpUrl
 */
export function rewriteSeodevaArticleImageSrc(html, urlMap) {
	const map = urlMap instanceof Map ? urlMap : new Map(Object.entries(urlMap || {}));
	if (!map.size) return String(html || '');

	return String(html || '').replace(
		/<figure\s+class="seodeva-article-image">\s*<img\b([^>]*)>/gi,
		(full, attrs) => {
			const srcMatch = attrs.match(/\ssrc="([^"]*)"/i);
			if (!srcMatch) return full;
			const original = srcMatch[1];
			const next = map.get(original);
			if (!next) return full;
			const escaped = String(next)
				.replace(/&/g, '&amp;')
				.replace(/"/g, '&quot;');
			const newAttrs = attrs.replace(/\ssrc="[^"]*"/i, ` src="${escaped}"`);
			return full.replace(attrs, newAttrs);
		},
	);
}

/**
 * Remove seodeva figures whose img src is in srcSet (e.g. failed data: uploads).
 * @param {string} html
 * @param {Set<string>|string[]} srcSet
 */
export function removeSeodevaFiguresBySrc(html, srcSet) {
	const set = srcSet instanceof Set ? srcSet : new Set(srcSet || []);
	if (!set.size) return String(html || '');

	return String(html || '').replace(
		/<figure\s+class="seodeva-article-image">\s*<img\b([^>]*)>\s*<\/figure>/gi,
		(full, attrs) => {
			const srcMatch = attrs.match(/\ssrc="([^"]*)"/i);
			if (!srcMatch) return full;
			return set.has(srcMatch[1]) ? '' : full;
		},
	).replace(/\n{3,}/g, '\n\n');
}

/**
 * Build per-job media map from persisted payload.
 * @param {object} job
 * @returns {{
 *   bySlotId: Record<string, { wpMediaId: number, wpUrl: string, sourceUrl: string }>,
 *   bySourceUrl: Record<string, { wpMediaId: number, wpUrl: string, sourceUrl: string }>,
 * }}
 */
export function readWriterMediaMap(job) {
	const raw = job?.payload?.writerMediaMap;
	const bySlotId = raw?.bySlotId && typeof raw.bySlotId === 'object' ? { ...raw.bySlotId } : {};
	const bySourceUrl = raw?.bySourceUrl && typeof raw.bySourceUrl === 'object' ? { ...raw.bySourceUrl } : {};
	return { bySlotId, bySourceUrl };
}

export function writeWriterMediaMap(bySlotId, bySourceUrl) {
	return { bySlotId: { ...bySlotId }, bySourceUrl: { ...bySourceUrl } };
}

/**
 * Select uploadable Writer assets with first-wins dedupe (slotId, url).
 * @param {object|null} images
 * @param {'inline'|'featured'|'all'} kind
 */
export function selectWriterAssetsForUpload(images, kind = 'inline') {
	const assets = Array.isArray(images?.assets) ? images.assets : [];
	const seenSlot = new Set();
	const seenUrl = new Set();
	const out = [];

	for (const asset of assets) {
		if (!asset || typeof asset !== 'object') continue;
		if (asset.status !== 'resolved') continue;
		if (kind === 'inline' && asset.type !== 'inline') continue;
		if (kind === 'featured' && asset.type !== 'featured') continue;
		if (kind === 'all' && asset.type !== 'inline' && asset.type !== 'featured') continue;

		const url = String(asset.url || '').trim();
		if (!url) continue;
		if (kind === 'inline') {
			const sectionIndex = Number(asset.sectionIndex);
			const fingerprint = String(asset.headingFingerprint || '').trim();
			if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || !fingerprint) continue;
		}

		const slotId = String(asset.slotId || '').trim();
		if (slotId && seenSlot.has(slotId)) continue;
		if (seenUrl.has(url)) continue;
		if (slotId) seenSlot.add(slotId);
		seenUrl.add(url);
		out.push(asset);
	}
	return out;
}
