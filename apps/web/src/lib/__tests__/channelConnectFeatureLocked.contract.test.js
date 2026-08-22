/**
 * FEATURE_LOCKED UX: Facebook/Pinterest Connect opens UpgradeModal (no upgrade toast).
 * Run: npx vitest run src/lib/__tests__/channelConnectFeatureLocked.contract.test.js
 */
import { describe, it } from 'vitest';
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

describe('FEATURE_LOCKED UX — Facebook / Pinterest Connect', () => {
	it('Facebook hub: Connect/Reconnect opens UpgradeModal before Connect failed toast', () => {
		const page = readSrc('pages/app/FacebookPage.jsx');
		assert.match(page, /import UpgradeModal from '@\/components\/billing\/UpgradeModal'/);
		assert.match(page, /isFeatureLockedError/);
		assert.match(page, /resolveLockedFeatureIdentity/);
		assert.match(page, /featureKey:\s*'facebook'/);
		assert.match(page, /sourcePage:\s*'facebook'|sourcePage:\s*identity\.sourcePage \|\| 'facebook'/);
		assert.match(page, /<UpgradeModal/);

		const startOAuth = sliceBetween(page, 'const startOAuth = async', 'const syncPages');
		assert.ok(startOAuth.includes('isFeatureLockedError(payload)'));
		assert.ok(startOAuth.includes('openFeatureLockedUpgradeModal(payload)'));
		const lockIdx = startOAuth.indexOf('isFeatureLockedError(payload)');
		const toastIdx = startOAuth.indexOf("title: 'Connect failed'");
		assert.ok(lockIdx >= 0 && toastIdx > lockIdx, 'FEATURE_LOCKED must precede Connect failed toast');
		assert.ok(startOAuth.includes('/facebook/oauth/start'));
		assert.ok(startOAuth.includes('/reconnect'));
	});

	it('Pinterest hub: Connect + Reconnect open UpgradeModal before Error toast', () => {
		const page = readSrc('pages/app/PinterestPage.jsx');
		assert.match(page, /import UpgradeModal from '@\/components\/billing\/UpgradeModal'/);
		assert.match(page, /isFeatureLockedError/);
		assert.match(page, /resolveLockedFeatureIdentity/);
		assert.match(page, /featureKey:\s*'pinterest'/);
		assert.match(page, /<UpgradeModal/);

		const connect = sliceBetween(page, 'const connectPinterest = async', 'const reconnectAccount');
		assert.ok(connect.includes('isFeatureLockedError(payload)'));
		assert.ok(connect.includes('openFeatureLockedUpgradeModal(payload)'));
		assert.ok(
			connect.indexOf('isFeatureLockedError(payload)') < connect.indexOf("title: 'Error'"),
			'FEATURE_LOCKED must precede Error toast on connect',
		);

		const reconnect = sliceBetween(page, 'const reconnectAccount = async', 'const syncAccountBoards');
		assert.ok(reconnect.includes('isFeatureLockedError(payload)'));
		assert.ok(reconnect.includes('openFeatureLockedUpgradeModal(payload)'));
		assert.ok(
			reconnect.indexOf('isFeatureLockedError(payload)') < reconnect.indexOf("title: 'Error'"),
			'FEATURE_LOCKED must precede Error toast on reconnect',
		);
	});

	it('isFeatureLockedError detects FEATURE_LOCKED payloads used by connect handlers', async () => {
		const { isFeatureLockedError } = await import('../templateAccess.js');
		assert.equal(isFeatureLockedError({
			errorCode: 'FEATURE_LOCKED',
			message: 'Facebook requires a plan upgrade. Open Subscription to unlock publishing.',
			access: { locked: true, enabled: false, visible: true, missingKeys: ['facebook'] },
			featureKey: 'facebook',
		}), true);
		assert.equal(isFeatureLockedError({
			errorCode: 'FEATURE_LOCKED',
			message: 'Pinterest requires a plan upgrade. Open Subscription to unlock publishing.',
			access: { locked: true, enabled: false, visible: true, missingKeys: ['pinterest'] },
			featureKey: 'pinterest',
		}), true);
		assert.equal(isFeatureLockedError({
			message: 'OAuth provider unavailable',
		}), false);
	});
});
