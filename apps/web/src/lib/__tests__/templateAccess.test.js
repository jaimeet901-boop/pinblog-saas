import { describe, expect, it } from 'vitest';
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
		expect(isTemplateAccessLocked({
			premium: true,
			marketplace: { meta: { premium: true, access: { tier: 'premium' } } },
			requiredFeatureKeys: ['templates.premium'],
		})).toBe(false);

		expect(isTemplateAccessLocked({
			access: {
				visible: true,
				enabled: false,
				locked: true,
				missingKeys: ['templates.premium'],
				dependencyChain: ['templates.premium'],
			},
		})).toBe(true);

		expect(isTemplateAccessEnabled({
			access: { visible: true, enabled: true, locked: false, missingKeys: [], dependencyChain: [] },
		})).toBe(true);
	});

	it('treats missing access as unlocked for backward compatibility', () => {
		expect(isTemplateAccessLocked({})).toBe(false);
		expect(isTemplateAccessEnabled({})).toBe(true);
		expect(getTemplateAccess({})).toBeNull();
	});

	it('formats missing feature labels', () => {
		expect(formatMissingFeatureLabels(['templates.premium', 'aiImages'])).toEqual([
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
		expect(suggestUpgradePlan(plans, ['templates.premium'], { currentPlanSlug: 'free' })).toEqual({
			slug: 'pro',
			name: 'Pro',
			monthlyPrice: 49,
		});
	});

	it('detects FEATURE_LOCKED errors', () => {
		expect(isFeatureLockedError({ errorCode: 'FEATURE_LOCKED' })).toBe(true);
		expect(isFeatureLockedError({ access: { locked: true } })).toBe(true);
		expect(isFeatureLockedError({ message: 'nope' })).toBe(false);
	});
});
