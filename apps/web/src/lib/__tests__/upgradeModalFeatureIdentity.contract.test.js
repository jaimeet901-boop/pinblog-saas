/**
 * UpgradeModal locked-feature identity + compact plan-first UX.
 * Run: node --test src/lib/__tests__/upgradeModalFeatureIdentity.contract.test.js
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

describe('UpgradeModal feature identity + compact UX', () => {
	it('templateAccess / lockedFeatureIdentity export resolver with correct feature labels', () => {
		const access = readSrc('lib/templateAccess.js');
		const identity = readSrc('lib/lockedFeatureIdentity.js');
		assert.match(access, /resolveLockedFeatureIdentity/);
		assert.match(identity, /export function resolveLockedFeatureIdentity/);
		assert.match(identity, /aiImages:\s*'AI Images'/);
		assert.match(identity, /aiWriter:\s*'AI Writer'/);
		assert.match(identity, /pinterest:\s*'Pinterest'/);
		assert.match(identity, /facebook:\s*'Facebook'/);
		assert.match(identity, /wordpress:\s*'WordPress'/);
		assert.match(identity, /calendar:\s*'Calendar'/);
		assert.match(identity, /analytics:\s*'Analytics'/);
		assert.match(identity, /Never defaults to aiWriter when another feature key is present/);
		assert.match(identity, /unique\.includes\('aiImages'\)/);
	});

	it('UpgradeModal keeps plan cards + existing checkout helper; removes locked-feature meta box', () => {
		const modal = readSrc('components/billing/UpgradeModal.jsx');
		assert.match(modal, /buildUpgradeModalPlanCards/);
		assert.match(modal, /startSubscriptionCheckout/);
		assert.match(modal, /resolveLockedFeatureIdentity/);
		assert.match(modal, /Upgrade to \$\{plan\.name\}/);
		assert.match(modal, /Most Popular/);
		assert.match(modal, /Not now/);
		assert.match(modal, /data-locked-feature/);
		assert.match(modal, /Choose the plan that fits your needs/);
		assert.doesNotMatch(modal, /Locked feature/);
		assert.doesNotMatch(modal, /Current plan/);
		assert.doesNotMatch(modal, /No credits are consumed/);
	});

	it('Content Studio AI Pins paths wire identity resolver (images + writer)', () => {
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		assert.match(studio, /resolveLockedFeatureIdentity/);
		assert.match(studio, /openAiImagesUpgradeModal/);
		assert.match(studio, /featureKey:\s*'aiImages'/);
		assert.match(studio, /identity\.label/);
		assert.doesNotMatch(
			studio,
			/setUpgradeModal\(\{\s*templateId:\s*'aiWriter',\s*templateName:\s*'AI Writer'/,
		);
	});
});
