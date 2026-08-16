/**
 * WS-08-A Platform Identity brand asset lifecycle.
 * Run: node --test src/services/platform-brand-assets.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	PLATFORM_BRAND_ASSET_KEYS,
	PLATFORM_BRAND_ASSET_RULES,
	applyAssetToSettings,
	deleteIntegratedAiImageIfPresent,
	detectImageMimeFromMagicBytes,
	getBrandAssetMeta,
	isMissingRecordError,
	removePlatformBrandAsset,
	restorePlatformBrandAsset,
	uploadPlatformBrandAsset,
} from './platform-brand-assets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(path.join(here, 'platform-brand-assets.js'), 'utf8');
const routeSource = readFileSync(path.join(here, '../routes/admin/brand-assets.js'), 'utf8');
const adminIndexSource = readFileSync(path.join(here, '../routes/admin/index.js'), 'utf8');

function pngBuffer() {
	return Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]);
}

function jpegBuffer() {
	return Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
}

function webpBuffer() {
	return Buffer.from([
		0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
		0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
	]);
}

function settingsWithLogo(recordId = 'img123') {
	return {
		branding: {
			platformLogoUrl: 'https://seodeva.com/hcgi/platform/api/files/_integratedAiImages/img123/logo.png',
			sidebarLogoUrl: '',
			loginLogoUrl: '',
			assets: {
				platformLogo: {
					url: 'https://seodeva.com/hcgi/platform/api/files/_integratedAiImages/img123/logo.png',
					fileName: 'logo.png',
					fileSize: 12,
					width: 64,
					height: 64,
					updatedAt: '2026-08-16T00:00:00.000Z',
					recordId,
					mimeType: 'image/png',
				},
			},
		},
		seo: { ogImageUrl: '' },
	};
}

describe('WS-08-A magic bytes', () => {
	it('detects PNG JPEG and WebP signatures', () => {
		assert.equal(detectImageMimeFromMagicBytes(pngBuffer()), 'image/png');
		assert.equal(detectImageMimeFromMagicBytes(jpegBuffer()), 'image/jpeg');
		assert.equal(detectImageMimeFromMagicBytes(webpBuffer()), 'image/webp');
		assert.equal(detectImageMimeFromMagicBytes(Buffer.from('not-an-image')), '');
		assert.equal(detectImageMimeFromMagicBytes(Buffer.alloc(0)), '');
	});
});

describe('WS-08-A upload persists', () => {
	it('stores the file and writes URL/meta into platform_settings', async () => {
		const stored = [];
		const saved = [];
		const result = await uploadPlatformBrandAsset({
			assetKey: 'platformLogo',
			file: { buffer: pngBuffer(), mimetype: 'image/png', originalname: 'mark.png' },
			width: 64,
			height: 32,
			storeFile: async (file, assetKey) => {
				stored.push({ assetKey, name: file.originalname });
				return {
					recordId: 'rec1',
					storedFileName: 'platform-platformLogo.png',
					url: 'https://seodeva.com/hcgi/platform/api/files/_integratedAiImages/rec1/mark.png',
				};
			},
			loadSettings: async () => ({ settings: { branding: { assets: {} }, seo: {} } }),
			saveSettings: async (next) => {
				saved.push(next);
				return { settings: next, meta: { source: 'pocketbase' } };
			},
		});

		assert.equal(stored.length, 1);
		assert.equal(result.asset.recordId, 'rec1');
		assert.equal(result.settings.branding.platformLogoUrl, result.asset.url);
		assert.equal(result.settings.branding.assets.platformLogo.recordId, 'rec1');
		assert.equal(saved.length, 1);
		assert.match(result.asset.url, /^https:\/\//);
	});

	it('rejects MIME/type spoofing and unsupported signatures', async () => {
		await assert.rejects(
			() => uploadPlatformBrandAsset({
				assetKey: 'platformLogo',
				file: { buffer: Buffer.from('hello'), mimetype: 'image/png', originalname: 'x.png' },
				storeFile: async () => {
					throw new Error('store must not run');
				},
				loadSettings: async () => ({ settings: {} }),
				saveSettings: async () => {
					throw new Error('save must not run');
				},
			}),
			(error) => error.status === 422,
		);

		await assert.rejects(
			() => uploadPlatformBrandAsset({
				assetKey: 'loginLogo',
				file: { buffer: pngBuffer(), mimetype: 'image/gif', originalname: 'x.gif' },
				storeFile: async () => {
					throw new Error('store must not run');
				},
			}),
			(error) => error.status === 422,
		);
	});
});

describe('WS-08-A remove deletes file then clears settings', () => {
	it('deletes the _integratedAiImages recordId and clears URL/meta', async () => {
		const deleted = [];
		const result = await removePlatformBrandAsset({
			assetKey: 'platformLogo',
			deleteFile: async (id) => {
				deleted.push(id);
				return { deleted: true, reason: 'deleted' };
			},
			loadSettings: async () => ({ settings: settingsWithLogo('img123') }),
			saveSettings: async (next) => ({ settings: next, meta: { source: 'pocketbase' } }),
		});

		assert.deepEqual(deleted, ['img123']);
		assert.equal(result.settings.branding.platformLogoUrl, '');
		assert.equal(result.settings.branding.assets.platformLogo, undefined);
		assert.equal(result.asset.url, '');
		assert.equal(result.asset.recordId, '');
	});

	it('treats a missing file record as idempotent success and still clears settings', async () => {
		const missing = new Error("The requested resource wasn't found.");
		missing.status = 404;
		assert.equal(isMissingRecordError(missing), true);

		const outcome = await deleteIntegratedAiImageIfPresent('gone', async () => {
			throw missing;
		});
		assert.equal(outcome.reason, 'already_missing');

		const result = await removePlatformBrandAsset({
			assetKey: 'sidebarLogo',
			deleteFile: async () => deleteIntegratedAiImageIfPresent('gone', async () => {
				throw missing;
			}),
			loadSettings: async () => ({
				settings: {
					branding: {
						sidebarLogoUrl: 'https://example.com/old.png',
						assets: { sidebarLogo: { url: 'https://example.com/old.png', recordId: 'gone' } },
					},
					seo: {},
				},
			}),
			saveSettings: async (next) => ({ settings: next, meta: {} }),
		});
		assert.equal(result.settings.branding.sidebarLogoUrl, '');
		assert.equal(result.settings.branding.assets.sidebarLogo, undefined);
	});

	it('skips delete when recordId is empty and still clears URL', async () => {
		const deleted = [];
		await deleteIntegratedAiImageIfPresent('', async (id) => deleted.push(id));
		assert.deepEqual(deleted, []);

		const result = await removePlatformBrandAsset({
			assetKey: 'loginLogo',
			deleteFile: async (id) => deleteIntegratedAiImageIfPresent(id, async (nextId) => deleted.push(nextId)),
			loadSettings: async () => ({
				settings: {
					branding: { loginLogoUrl: 'https://example.com/login.png', assets: {} },
					seo: {},
				},
			}),
			saveSettings: async (next) => ({ settings: next, meta: {} }),
		});
		assert.deepEqual(deleted, []);
		assert.equal(result.settings.branding.loginLogoUrl, '');
	});
});

describe('WS-08-A restore default', () => {
	it('uses clean removal and does not write a fake default URL', async () => {
		const result = await restorePlatformBrandAsset({
			assetKey: 'platformLogo',
			deleteFile: async () => ({ deleted: true, reason: 'deleted' }),
			loadSettings: async () => ({ settings: settingsWithLogo('img123') }),
			saveSettings: async (next) => ({ settings: next, meta: {} }),
		});
		assert.equal(result.settings.branding.platformLogoUrl, '');
		assert.equal(result.settings.branding.assets.platformLogo, undefined);
		assert.doesNotMatch(JSON.stringify(result.settings), /Sparkles/);
		assert.doesNotMatch(result.settings.branding.platformLogoUrl, /og-chef-ia/);
		assert.doesNotMatch(result.settings.branding.platformLogoUrl, /vite\.svg/);
	});

	it('applyAssetToSettings clears without inventing fallback URLs', () => {
		const cleared = applyAssetToSettings(settingsWithLogo('img123'), 'platformLogo', null);
		assert.equal(cleared.branding.platformLogoUrl, '');
		assert.equal(cleared.branding.assets.platformLogo, undefined);
		const empty = getBrandAssetMeta(cleared, 'platformLogo');
		assert.equal(empty.url, '');
		assert.equal(empty.recordId, '');
	});
});

describe('WS-08-A routes and admin auth', () => {
	it('keeps existing asset keys and admin-only brand-assets router', () => {
		assert.deepEqual([...PLATFORM_BRAND_ASSET_KEYS], [
			'platformLogo',
			'sidebarLogo',
			'loginLogo',
			'favicon',
			'openGraphImage',
		]);
		assert.match(routeSource, /router\.post\('\/:assetKey\/restore'/);
		assert.match(routeSource, /restorePlatformBrandAsset/);
		assert.match(routeSource, /removePlatformBrandAsset/);
		assert.match(routeSource, /uploadPlatformBrandAsset/);
		assert.match(adminIndexSource, /requireAdmin/);
		assert.match(adminIndexSource, /router\.use\('\/settings\/brand-assets', brandAssetsRouter\)/);
		assert.match(serviceSource, /_integratedAiImages/);
		assert.match(serviceSource, /detectImageMimeFromMagicBytes/);
		assert.deepEqual(PLATFORM_BRAND_ASSET_RULES.platformLogo.allowedMimeTypes, [
			'image/png',
			'image/jpeg',
			'image/webp',
		]);
		assert.equal(PLATFORM_BRAND_ASSET_RULES.platformLogo.maxSizeMB, 5);
		assert.equal(PLATFORM_BRAND_ASSET_RULES.favicon.maxSizeMB, 2);
	});
});
