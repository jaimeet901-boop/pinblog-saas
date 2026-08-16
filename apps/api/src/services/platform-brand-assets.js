export const PLATFORM_BRAND_ASSET_KEYS = Object.freeze([
	'platformLogo',
	'sidebarLogo',
	'loginLogo',
	'favicon',
	'openGraphImage',
]);

const ASSET_TARGETS = Object.freeze({
	platformLogo: { section: 'branding', urlKey: 'platformLogoUrl' },
	sidebarLogo: { section: 'branding', urlKey: 'sidebarLogoUrl' },
	loginLogo: { section: 'branding', urlKey: 'loginLogoUrl' },
	favicon: { section: 'branding', urlKey: 'faviconUrl' },
	openGraphImage: { section: 'seo', urlKey: 'ogImageUrl' },
});

const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const INTEGRATED_AI_IMAGES = '_integratedAiImages';

async function loadLogger() {
	try {
		const mod = await import('../utils/logger.js');
		return mod.default;
	} catch {
		return { info() {}, error() {}, warn() {} };
	}
}

async function defaultLoadSettings() {
	const { getPlatformSettings } = await import('./platform-settings.js');
	return getPlatformSettings();
}

async function defaultSaveSettings(settings, actor) {
	const { upsertPlatformSettings } = await import('./platform-settings.js');
	return upsertPlatformSettings(settings, actor);
}

async function defaultDeleteRecord(recordId) {
	const { default: pocketbaseClient } = await import('../utils/pocketbaseClient.js');
	return pocketbaseClient.collection(INTEGRATED_AI_IMAGES).delete(recordId);
}

/**
 * Detect PNG / JPEG / WebP from magic bytes. No extra dependency.
 * Returns '' when the buffer is not a supported image.
 */
export function detectImageMimeFromMagicBytes(buffer) {
	const bytes = buffer instanceof Uint8Array
		? buffer
		: new Uint8Array(buffer || []);
	if (
		bytes.length >= 8
		&& bytes[0] === 0x89
		&& bytes[1] === 0x50
		&& bytes[2] === 0x4E
		&& bytes[3] === 0x47
		&& bytes[4] === 0x0D
		&& bytes[5] === 0x0A
		&& bytes[6] === 0x1A
		&& bytes[7] === 0x0A
	) {
		return 'image/png';
	}
	if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
		return 'image/jpeg';
	}
	if (
		bytes.length >= 12
		&& bytes[0] === 0x52
		&& bytes[1] === 0x49
		&& bytes[2] === 0x46
		&& bytes[3] === 0x46
		&& bytes[8] === 0x57
		&& bytes[9] === 0x45
		&& bytes[10] === 0x42
		&& bytes[11] === 0x50
	) {
		return 'image/webp';
	}
	return '';
}

export function isMissingRecordError(error) {
	const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? 0);
	if (status === 404) return true;
	const nested = Number(error?.data?.code ?? error?.response?.data?.code ?? 0);
	if (nested === 404) return true;
	const message = String(error?.message || '').toLowerCase();
	return message.includes("wasn't found") || message.includes('the requested resource was not found');
}

/**
 * Delete a brand file record. Missing records are success (idempotent).
 */
export async function deleteIntegratedAiImageIfPresent(recordId, deleter) {
	const id = String(recordId || '').trim();
	if (!id) {
		return { deleted: false, reason: 'no_record_id' };
	}
	const deleteRecord = deleter || defaultDeleteRecord;
	try {
		await deleteRecord(id);
		return { deleted: true, reason: 'deleted' };
	} catch (error) {
		const logger = await loadLogger();
		if (isMissingRecordError(error)) {
			logger.info('Brand asset file record already missing', { recordId: id });
			return { deleted: false, reason: 'already_missing' };
		}
		logger.error('Failed to delete platform brand asset file', {
			recordId: id,
			error: error?.message,
		});
		throw httpError(500, 'Failed to delete brand asset file', 'STORAGE_ERROR');
	}
}

export const PLATFORM_BRAND_ASSET_RULES = Object.freeze({
	platformLogo: { maxSizeMB: 5, allowedMimeTypes: IMAGE_MIME, label: 'Platform Logo' },
	sidebarLogo: { maxSizeMB: 5, allowedMimeTypes: IMAGE_MIME, label: 'Sidebar Logo' },
	loginLogo: { maxSizeMB: 5, allowedMimeTypes: IMAGE_MIME, label: 'Login Logo' },
	favicon: { maxSizeMB: 2, allowedMimeTypes: IMAGE_MIME, label: 'Favicon' },
	openGraphImage: { maxSizeMB: 5, allowedMimeTypes: IMAGE_MIME, label: 'Open Graph Image' },
});

function httpError(status, message, code = 'VALIDATION_ERROR') {
	const error = new Error(message);
	error.status = status;
	error.code = code;
	return error;
}

function assertAssetKey(assetKey) {
	const key = String(assetKey || '').trim();
	if (!PLATFORM_BRAND_ASSET_KEYS.includes(key)) {
		throw httpError(422, `Invalid asset key. Allowed: ${PLATFORM_BRAND_ASSET_KEYS.join(', ')}`);
	}
	return key;
}

function emptyAssetMeta() {
	return {
		url: '',
		fileName: '',
		fileSize: 0,
		width: null,
		height: null,
		updatedAt: null,
		recordId: '',
		mimeType: '',
	};
}

export function getBrandAssetMeta(settings, assetKey) {
	const key = assertAssetKey(assetKey);
	const assets = settings?.branding?.assets && typeof settings.branding.assets === 'object'
		? settings.branding.assets
		: {};
	const meta = assets[key] && typeof assets[key] === 'object' ? assets[key] : null;
	const target = ASSET_TARGETS[key];
	const url = String(settings?.[target.section]?.[target.urlKey] || meta?.url || '').trim();
	if (!meta && !url) return emptyAssetMeta();
	return {
		...emptyAssetMeta(),
		...(meta || {}),
		url: url || String(meta?.url || '').trim(),
	};
}

function buildAssetMeta({
	url,
	fileName,
	fileSize,
	width,
	height,
	recordId,
	mimeType,
}) {
	return {
		url: String(url || '').trim(),
		fileName: String(fileName || '').trim().slice(0, 200),
		fileSize: Number(fileSize) || 0,
		width: width == null || width === '' ? null : Number(width) || null,
		height: height == null || height === '' ? null : Number(height) || null,
		updatedAt: new Date().toISOString(),
		recordId: String(recordId || '').trim(),
		mimeType: String(mimeType || '').trim(),
	};
}

export function applyAssetToSettings(settings, assetKey, meta) {
	const target = ASSET_TARGETS[assetKey];
	const next = structuredClone(settings || {});
	next.branding = { ...(next.branding || {}) };
	next.seo = { ...(next.seo || {}) };
	next.branding.assets = {
		...(next.branding.assets && typeof next.branding.assets === 'object' ? next.branding.assets : {}),
	};

	if (!meta || !meta.url) {
		next[target.section][target.urlKey] = '';
		delete next.branding.assets[assetKey];
	} else {
		next[target.section][target.urlKey] = meta.url;
		next.branding.assets[assetKey] = meta;
	}
	return next;
}

async function storeFileInPocketBase(file, assetKey) {
	const safeBase = String(file.originalname || assetKey)
		.replace(/[^a-zA-Z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.slice(0, 80) || assetKey;
	const fileName = `platform-${assetKey}-${Date.now()}-${safeBase}`;
	const formData = new FormData();
	const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
	formData.append('file', blob, fileName);

	const { default: pocketbaseClient } = await import('../utils/pocketbaseClient.js');
	const { getPublicFileUrl } = await import('../utils/public-file-url.js');
	const record = await pocketbaseClient.collection(INTEGRATED_AI_IMAGES).create(formData).catch(async (error) => {
		const logger = await loadLogger();
		logger.error('Failed to store platform brand asset', {
			assetKey,
			error: error?.message,
		});
		throw httpError(500, 'Failed to store brand asset', 'STORAGE_ERROR');
	});

	const url = getPublicFileUrl(record, record.file);
	return {
		recordId: record.id,
		storedFileName: record.file,
		url,
	};
}

/**
 * Upload a platform brand asset, persist URL+meta into platform_settings, return updated settings.
 */
export async function uploadPlatformBrandAsset({
	assetKey,
	file,
	width = null,
	height = null,
	actor = {},
	storeFile = storeFileInPocketBase,
	loadSettings = defaultLoadSettings,
	saveSettings = defaultSaveSettings,
}) {
	const key = assertAssetKey(assetKey);
	const rules = PLATFORM_BRAND_ASSET_RULES[key];
	if (!file?.buffer?.length) {
		throw httpError(422, 'file is required');
	}
	if (!rules.allowedMimeTypes.includes(file.mimetype)) {
		throw httpError(422, `Invalid file type for ${rules.label}. Allowed: ${rules.allowedMimeTypes.join(', ')}`);
	}
	const detectedMime = detectImageMimeFromMagicBytes(file.buffer);
	if (!detectedMime || detectedMime !== file.mimetype) {
		throw httpError(422, `Invalid file type for ${rules.label}. Allowed: ${rules.allowedMimeTypes.join(', ')}`);
	}
	const maxBytes = rules.maxSizeMB * 1024 * 1024;
	if (file.buffer.length > maxBytes) {
		throw httpError(413, `${rules.label} is too large (max ${rules.maxSizeMB}MB).`);
	}

	const stored = await storeFile(file, key);
	const meta = buildAssetMeta({
		url: stored.url,
		fileName: file.originalname || stored.storedFileName,
		fileSize: file.buffer.length,
		width,
		height,
		recordId: stored.recordId,
		mimeType: file.mimetype,
	});

	const { settings } = await loadSettings();
	const nextSettings = applyAssetToSettings(settings, key, meta);
	const saved = await saveSettings(nextSettings, actor);

	return {
		assetKey: key,
		asset: meta,
		settings: saved.settings,
		meta: saved.meta,
	};
}

/**
 * Delete the PocketBase file (if recordId exists) then clear URL/meta.
 * Missing file records are treated as success.
 */
export async function removePlatformBrandAsset({
	assetKey,
	actor = {},
	deleteFile = deleteIntegratedAiImageIfPresent,
	loadSettings = defaultLoadSettings,
	saveSettings = defaultSaveSettings,
} = {}) {
	const key = assertAssetKey(assetKey);
	const { settings } = await loadSettings();
	const current = getBrandAssetMeta(settings, key);
	await deleteFile(current.recordId);
	const nextSettings = applyAssetToSettings(settings, key, null);
	const saved = await saveSettings(nextSettings, actor);
	return {
		assetKey: key,
		asset: emptyAssetMeta(),
		settings: saved.settings,
		meta: saved.meta,
	};
}

/**
 * Restore Default: same clean removal. Does not write a fake default URL.
 * Runtime consumers keep their built-in fallbacks (Sparkles / empty URL).
 */
export async function restorePlatformBrandAsset(options = {}) {
	return removePlatformBrandAsset(options);
}
