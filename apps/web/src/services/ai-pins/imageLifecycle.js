/**
 * Single source of truth for AI Pin images: React `imageUrl` ↔ PocketBase `image_url`.
 * Persistable URLs are http(s) only. Blob URLs are preview-only until uploaded.
 */

import apiServerClient from '@/lib/apiServerClient';

const PENDING_STATUSES = new Set(['queued', 'processing', 'rendering', 'pending', 'running']);

/** Stay under common edge-proxy defaults (often 1MB) including multipart overhead. */
const TARGET_UPLOAD_BYTES = 900 * 1024;

export function isBlobImageUrl(value) {
	return String(value || '').trim().startsWith('blob:');
}

export function isPersistableImageUrl(value) {
	const url = String(value || '').trim();
	if (!url) return false;
	if (isBlobImageUrl(url)) return false;
	return /^https?:\/\//i.test(url);
}

export function assertPersistableImageUrl(value, label = 'Pin') {
	if (isPersistableImageUrl(value)) {
		return String(value).trim();
	}
	throw new Error(
		`${label} has no hosted image URL yet. Wait for generation to finish, or fix the upload, then try Save Draft again.`,
	);
}

function blobToJpeg(blob, quality) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(blob);
		const img = new Image();
		img.onload = () => {
			try {
				const canvas = document.createElement('canvas');
				canvas.width = img.naturalWidth || img.width;
				canvas.height = img.naturalHeight || img.height;
				const ctx = canvas.getContext('2d');
				if (!ctx) {
					reject(new Error('Canvas unavailable'));
					return;
				}
				ctx.drawImage(img, 0, 0);
				canvas.toBlob((out) => {
					URL.revokeObjectURL(url);
					if (!out) {
						reject(new Error('JPEG encode failed'));
						return;
					}
					resolve(out);
				}, 'image/jpeg', quality);
			} catch (error) {
				URL.revokeObjectURL(url);
				reject(error);
			}
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Could not decode image for compression'));
		};
		img.src = url;
	});
}

/**
 * Re-encode large PNG/canvas exports to JPEG so uploads survive 1MB edge proxies.
 * No-op in non-browser/test environments or when already small enough.
 */
export async function prepareImageBlobForUpload(blob, fileName = '') {
	const source = blob;
	const originalName = String(fileName || `pin-image-${Date.now()}.png`);
	if (!source || typeof source !== 'object' || typeof source.size !== 'number') {
		return { blob: source, fileName: originalName };
	}

	const canCompress = typeof document !== 'undefined'
		&& typeof Image !== 'undefined'
		&& typeof source.type === 'string'
		&& source.type.startsWith('image/')
		&& source.type !== 'image/gif';

	if (!canCompress) {
		return { blob: source, fileName: originalName };
	}

	if (source.size <= TARGET_UPLOAD_BYTES && (source.type === 'image/jpeg' || source.type === 'image/webp')) {
		return { blob: source, fileName: originalName };
	}

	let best = source;
	for (const quality of [0.9, 0.82, 0.72, 0.62]) {
		try {
			const encoded = await blobToJpeg(source, quality);
			if (!best || encoded.size < best.size) {
				best = encoded;
			}
			if (encoded.size <= TARGET_UPLOAD_BYTES) {
				best = encoded;
				break;
			}
		} catch {
			break;
		}
	}

	const base = originalName.replace(/\.[^.]+$/, '') || `pin-image-${Date.now()}`;
	const nextName = best.type === 'image/jpeg' ? `${base}.jpg` : originalName;
	return { blob: best, fileName: nextName };
}

/**
 * Upload a Blob/File to the composed-image endpoint (same storage as featured compose).
 */
export async function uploadImageBlob(blob, {
	articleId = '',
	title = '',
	fileName = '',
} = {}) {
	if (!blob || typeof blob !== 'object') {
		throw new Error('Nothing to upload — image blob is missing');
	}

	const prepared = await prepareImageBlobForUpload(blob, fileName || `pin-image-${Date.now()}.png`);
	const formData = new FormData();
	formData.append('image', prepared.blob, prepared.fileName);
	if (articleId) formData.append('articleId', String(articleId));
	if (title) formData.append('title', String(title).slice(0, 220));

	const response = await apiServerClient.fetch('/ai-pin-images/composed', {
		method: 'POST',
		body: formData,
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		if (response.status === 413) {
			throw new Error(
				payload?.message
				|| 'Image upload failed (413 Payload Too Large). The pin image exceeds the server upload limit.',
			);
		}
		throw new Error(payload?.message || `Image upload failed (${response.status})`);
	}

	const hostedUrl = String(payload.imageUrl || '').trim();
	if (!isPersistableImageUrl(hostedUrl)) {
		throw new Error('Image upload succeeded but no hosted URL was returned');
	}
	return {
		imageUrl: hostedUrl,
		imageSource: payload.imageSource || 'featured_composed',
	};
}

/**
 * If `imageUrl` is a blob:, fetch bytes and upload to get a persistable http(s) URL.
 */
export async function uploadBlobImageUrl(blobUrl, meta = {}) {
	if (!isBlobImageUrl(blobUrl)) {
		return assertPersistableImageUrl(blobUrl, meta.label || 'Pin');
	}

	let blob;
	try {
		const response = await fetch(blobUrl);
		if (!response.ok) {
			throw new Error(`Could not read local image (${response.status})`);
		}
		blob = await response.blob();
	} catch (error) {
		throw new Error(
			`Could not upload local preview image: ${error?.message || 'blob read failed'}. Re-generate the pin and try again.`,
		);
	}

	const uploaded = await uploadImageBlob(blob, {
		articleId: meta.articleId || '',
		title: meta.title || '',
		fileName: `pin-${meta.tempId || Date.now()}.png`,
	});
	return uploaded.imageUrl;
}

/**
 * Ensure one pin has a persistable hosted imageUrl before draft persistence.
 * Never invent alternate fields — only upgrades `imageUrl`.
 */
export async function ensureHostedImageForPin(pin = {}) {
	const label = String(pin.title || pin.tempId || pin.id || 'Pin').slice(0, 80);
	const status = String(pin.imageGenerationStatus || '').trim().toLowerCase();

	if (PENDING_STATUSES.has(status)) {
		throw new Error(
			`“${label}” is still generating an image. Wait until generation finishes, then Save Draft.`,
		);
	}

	const current = String(pin.imageUrl || '').trim();
	if (!current) {
		const detail = pin.imageGenerationError
			? ` (${pin.imageGenerationError})`
			: '';
		throw new Error(
			`“${label}” has no image to save${detail}. Generate or compose the image first.`,
		);
	}

	if (isPersistableImageUrl(current)) {
		return {
			...pin,
			imageUrl: current,
			imageGenerationStatus: pin.imageGenerationStatus === 'failed'
				? pin.imageGenerationStatus
				: (pin.imageGenerationStatus || 'completed'),
		};
	}

	if (isBlobImageUrl(current)) {
		const hostedUrl = await uploadBlobImageUrl(current, {
			articleId: pin.articleId,
			title: pin.title,
			tempId: pin.tempId || pin.id,
			label,
		});
		try {
			URL.revokeObjectURL(current);
		} catch {
			/* ignore */
		}
		return {
			...pin,
			imageUrl: hostedUrl,
			imageSource: pin.imageSource === 'ai_generated' ? 'ai_generated' : 'featured_composed',
			imageGenerationStatus: 'completed',
			imageGenerationError: '',
		};
	}

	throw new Error(
		`“${label}” image URL is not persistable. Re-generate the pin to get a hosted image.`,
	);
}

/**
 * Prepare all preview pins for Save Draft. Blocks if any pin cannot get a hosted URL.
 * @returns {Promise<object[]>} pins with persistable imageUrl
 */
export async function ensurePinsReadyForSave(pins = []) {
	const list = Array.isArray(pins) ? pins : [];
	if (list.length === 0) {
		throw new Error('No pins to save');
	}

	const ready = [];
	for (const pin of list) {
		ready.push(await ensureHostedImageForPin(pin));
	}

	const missing = ready.find((pin) => !isPersistableImageUrl(pin.imageUrl));
	if (missing) {
		throw new Error('Save Draft blocked: every pin must have a hosted image URL');
	}
	return ready;
}

export function canSavePinDraft(pin = {}) {
	const status = String(pin.imageGenerationStatus || '').trim().toLowerCase();
	if (PENDING_STATUSES.has(status)) return false;
	const url = String(pin.imageUrl || '').trim();
	return isPersistableImageUrl(url) || isBlobImageUrl(url);
}

export function canSaveAllPinDrafts(pins = []) {
	const list = Array.isArray(pins) ? pins : [];
	if (list.length === 0) return false;
	return list.every((pin) => canSavePinDraft(pin));
}
