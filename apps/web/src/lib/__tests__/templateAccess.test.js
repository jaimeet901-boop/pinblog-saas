/**
 * templateAccess unit tests.
 * Run: npm test --prefix apps/web -- src/lib/__tests__/templateAccess.test.js
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
	formatMissingFeatureLabels,
	getTemplateAccess,
	isFeatureLockedError,
	isTemplateAccessEnabled,
	isTemplateAccessLocked,
	suggestUpgradePlan,
} from '../templateAccess.js';

describe('templateAccess', () => {
	it('locks only from access.locked / enabled — ignores premium metadata', () => {
		assert.equal(isTemplateAccessLocked({
			premium: true,
			marketplace: { meta: { premium: true, access: { tier: 'premium' } } },
			requiredFeatureKeys: ['templates.premium'],
		}), false);

		assert.equal(isTemplateAccessLocked({
			access: {
				visible: true,
				enabled: false,
				locked: true,
				missingKeys: ['templates.premium'],
				dependencyChain: ['templates.premium'],
			},
		}), true);

		assert.equal(isTemplateAccessEnabled({
			access: { visible: true, enabled: true, locked: false, missingKeys: [], dependencyChain: [] },
		}), true);
	});

	it('treats missing access as unlocked for backward compatibility', () => {
		assert.equal(isTemplateAccessLocked({}), false);
		assert.equal(isTemplateAccessEnabled({}), true);
		assert.equal(getTemplateAccess({}), null);
	});

	it('formats missing feature labels', () => {
		assert.deepEqual(formatMissingFeatureLabels(['templates.premium', 'aiImages']), [
			'Premium templates',
			'AI Images',
		]);
	});

	it('suggests cheapest plan that grants all missing keys', () => {
		const plans = [
			{ slug: 'free', name: 'Free', monthlyPrice: 0, features: { 'templates.premium': { enabled: false } } },
			{ slug: 'starter', name: 'Starter', monthlyPrice: 19, features: { 'templates.premium': { enabled: false } } },
			{ slug: 'pro', name: 'Pro', monthlyPrice: 49, features: { 'templates.premium': { enabled: true } } },
			{ slug: 'agency', name: 'Agency', monthlyPrice: 99, features: { 'templates.premium': { enabled: true } } },
		];
		assert.deepEqual(suggestUpgradePlan(plans, ['templates.premium'], { currentPlanSlug: 'free' }), {
			slug: 'pro',
			name: 'Pro',
			monthlyPrice: 49,
		});
	});

	it('detects FEATURE_LOCKED errors', () => {
		assert.equal(isFeatureLockedError({ errorCode: 'FEATURE_LOCKED' }), true);
		assert.equal(isFeatureLockedError({ access: { locked: true } }), true);
		assert.equal(isFeatureLockedError({ message: 'nope' }), false);
	});
});
