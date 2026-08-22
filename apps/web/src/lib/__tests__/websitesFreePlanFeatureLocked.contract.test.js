/**
 * FEATURE_LOCKED UX: Websites save opens UpgradeModal (no destructive toast).
 * Run: node --test src/lib/__tests__/websitesFreePlanFeatureLocked.contract.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, '../..');

function readSrc(relativePath) {
	return readFileSync(path.join(webSrc, relativePath), 'utf8');
}

function sliceBetween(source, startMarker, endMarker) {
	const start = source.indexOf(startMarker);
	assert.ok(start >= 0, `missing start marker: ${startMarker}`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
	return source.slice(start, end);
}

describe('FEATURE_LOCKED UX — Websites save', () => {
	it('WebsitesPage imports UpgradeModal and isFeatureLockedError', () => {
		const page = readSrc('pages/app/WebsitesPage.jsx');
		assert.match(page, /import UpgradeModal from '@\/components\/billing\/UpgradeModal'/);
		assert.match(page, /<UpgradeModal/);
		assert.match(page, /import \{ isFeatureLockedError \} from '@\/lib\/templateAccess'/);
	});

	it('resolveLockedFeatureIdentity is imported from lockedFeatureIdentity, not templateAccess', () => {
		const page = readSrc('pages/app/WebsitesPage.jsx');
		assert.match(
			page,
			/import \{ resolveLockedFeatureIdentity \} from '@\/lib\/lockedFeatureIdentity'/,
		);
		assert.doesNotMatch(
			page,
			/import \{[^}]*resolveLockedFeatureIdentity[^}]*\} from '@\/lib\/templateAccess'/,
		);
	});

	it('create/save error path preserves the full API payload', () => {
		const page = readSrc('pages/app/WebsitesPage.jsx');
		const save = sliceBetween(page, 'const save = async', 'const remove = async');
		const responseError = sliceBetween(save, 'if (!res.ok)', 'const savedSite');
		assert.ok(responseError.includes('readErrorPayload'));
		assert.ok(responseError.includes('isFeatureLockedError(errorPayload)'));
		assert.match(page, /async function readErrorPayload\(res, fallback\)/);
		assert.match(page, /if \(parsed && typeof parsed === 'object'\) \{\s*return parsed;/);
	});

	it('FEATURE_LOCKED is evaluated before the destructive Error toast', () => {
		const page = readSrc('pages/app/WebsitesPage.jsx');
		const save = sliceBetween(page, 'const save = async', 'const remove = async');
		const lockIdx = save.indexOf('isFeatureLockedError(errorPayload)');
		const catchToastIdx = save.lastIndexOf("title: 'Error'");
		assert.ok(lockIdx >= 0 && catchToastIdx > lockIdx, 'FEATURE_LOCKED must precede catch destructive Error toast');
		assert.ok(save.includes("method: 'POST'"));
		assert.ok(save.includes('/websites'));
	});

	it('FEATURE_LOCKED opens UpgradeModal and returns without a destructive toast', () => {
		const page = readSrc('pages/app/WebsitesPage.jsx');
		const save = sliceBetween(page, 'const save = async', 'const remove = async');
		const lockedBlock = sliceBetween(save, 'if (isFeatureLockedError(errorPayload))', 'throw new Error');
		assert.ok(lockedBlock.includes('openFeatureLockedUpgradeModal(errorPayload)'));
		assert.ok(lockedBlock.includes('return'));
		assert.ok(!lockedBlock.includes("variant: 'destructive'"));
		assert.ok(!lockedBlock.includes('navigate('));
	});

	it('other save errors still use the existing destructive toast', () => {
		const page = readSrc('pages/app/WebsitesPage.jsx');
		const save = sliceBetween(page, 'const save = async', 'const remove = async');
		assert.match(save, /toast\(\{\s*variant:\s*'destructive',\s*title:\s*'Error'/);
	});

	it('does not depend on early Free Add-website UX or activeWorkspacePlan', () => {
		const page = readSrc('pages/app/WebsitesPage.jsx');
		assert.doesNotMatch(page, /activeWorkspacePlan/);
		assert.doesNotMatch(page, /isActiveWorkspaceOnFreePlan/);
		const openNew = sliceBetween(page, 'const openNewModal = () =>', 'return (');
		assert.ok(openNew.includes("mode: 'new'"));
		assert.ok(!openNew.includes('openFeatureLockedUpgradeModal'));
	});

	it('isFeatureLockedError detects websites FEATURE_LOCKED payloads', async () => {
		const { isFeatureLockedError } = await import('../templateAccess.js');
		assert.equal(isFeatureLockedError({
			errorCode: 'FEATURE_LOCKED',
			message: 'Adding another website requires a plan upgrade.',
			access: { locked: true, enabled: false, visible: true, missingKeys: [] },
			featureKey: 'websites',
		}), true);
		assert.equal(isFeatureLockedError({
			message: 'Invalid website URL',
		}), false);
	});

	it('lockedFeatureIdentity maps websites to Websites', async () => {
		const { resolveLockedFeatureIdentity } = await import('../lockedFeatureIdentity.js');
		const id = resolveLockedFeatureIdentity({
			featureKey: 'websites',
			access: { locked: true, enabled: false, visible: true, missingKeys: [] },
		}, { sourcePage: 'websites', requiredFeatureKeys: ['websites'] });
		assert.equal(id.featureKey, 'websites');
		assert.equal(id.label, 'Websites');
		assert.equal(id.sourcePage, 'websites');
	});
});
