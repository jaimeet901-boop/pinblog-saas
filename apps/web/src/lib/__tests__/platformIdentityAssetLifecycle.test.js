/**
 * WS-08-A Restore Default wiring on Platform Identity.
 * Run: node --test src/lib/__tests__/platformIdentityAssetLifecycle.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, '../..');

function readSrc(relativePath) {
	return readFileSync(path.join(webSrc, relativePath), 'utf8');
}

describe('WS-08-A Platform Identity Restore Default', () => {
	it('enables Restore Default and posts to the restore route', () => {
		const page = readSrc('pages/admin/AdminPlatformIdentityPage.jsx');
		const uploader = readSrc('components/AssetUploader.jsx');
		const brandMark = readSrc('components/PlatformBrandMark.jsx');

		assert.match(page, /\/admin\/v1\/settings\/brand-assets\/\$\{encodeURIComponent\(assetKey\)\}\/restore/);
		assert.match(page, /method: 'POST'/);
		assert.match(page, /onRestore=\{\(\) => restoreBrandAsset\(asset\.key\)\}/);
		assert.match(page, /method: 'DELETE'/);
		assert.doesNotMatch(page, /restoreDefaultDisabled\s*\n\s*onUpload/);

		assert.match(uploader, /onClick=\{handleRestore\}/);
		assert.match(uploader, /Restore Default/);
		assert.doesNotMatch(uploader, /Restore Default arrives in a later phase/);

		assert.match(brandMark, /Sparkles/);
		assert.match(brandMark, /showLogo \? \(/);
	});
});
