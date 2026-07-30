import pocketbaseClient from '../utils/pocketbaseClient.js';
import { getPublicFileUrl } from '../utils/public-file-url.js';
import logger from '../utils/logger.js';
import { getPlatformSettings, upsertPlatformSettings } from './platform-settings.js';

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

function applyAssetToSettings(settings, assetKey, meta) {
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

	const record = await pocketbaseClient.collection('_integratedAiImages').create(formData).catch((error) => {
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
}) {
	const key = assertAssetKey(assetKey);
	const rules = PLATFORM_BRAND_ASSET_RULES[key];
	if (!file?.buffer?.length) {
		throw httpError(422, 'file is required');
	}
	if (!rules.allowedMimeTypes.includes(file.mimetype)) {
		throw httpError(422, `Invalid file type for ${rules.label}. Allowed: ${rules.allowedMimeTypes.join(', ')}`);
	}
	const maxBytes = rules.maxSizeMB * 1024 * 1024;
	if (file.buffer.length > maxBytes) {
		throw httpError(413, `${rules.label} is too large (max ${rules.maxSizeMB}MB).`);
	}

	const stored = await storeFileInPocketBase(file, key);
	const meta = buildAssetMeta({
		url: stored.url,
		fileName: file.originalname || stored.storedFileName,
		fileSize: file.buffer.length,
		width,
		height,
		recordId: stored.recordId,
		mimeType: file.mimetype,
	});

	const { settings } = await getPlatformSettings();
	const nextSettings = applyAssetToSettings(settings, key, meta);
	const saved = await upsertPlatformSettings(nextSettings, actor);

	return {
		assetKey: key,
		asset: meta,
		settings: saved.settings,
		meta: saved.meta,
	};
}

/**
 * Clear a platform brand asset URL/meta from platform_settings.
 */
export async function removePlatformBrandAsset({ assetKey, actor = {} }) {
	const key = assertAssetKey(assetKey);
	const { settings } = await getPlatformSettings();
	const nextSettings = applyAssetToSettings(settings, key, null);
	const saved = await upsertPlatformSettings(nextSettings, actor);
	return {
		assetKey: key,
		asset: emptyAssetMeta(),
		settings: saved.settings,
		meta: saved.meta,
	};
}
