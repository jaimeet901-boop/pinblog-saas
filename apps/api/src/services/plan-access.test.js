import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	evaluateFeatureAccess,
	evaluateFeatureAccessForPlan,
	isPlatformAdmin,
} from './plan-access.js';

describe('plan-access isPlatformAdmin', () => {
	it('accepts role admin only', () => {
		assert.equal(isPlatformAdmin('admin'), true);
		assert.equal(isPlatformAdmin({ role: 'admin' }), true);
		assert.equal(isPlatformAdmin({ role: 'Admin' }), true);
		assert.equal(isPlatformAdmin('user'), false);
		assert.equal(isPlatformAdmin({ role: 'super_admin' }), false);
		assert.equal(isPlatformAdmin(null), false);
	});
});

describe('plan-access evaluateFeatureAccess', () => {
	it('grants when feature and deps are enabled', () => {
		const result = evaluateFeatureAccess({
			featureKey: 'features.ai_layout',
			features: {
				'features.ai_layout': { enabled: true },
				'templates.premium': { enabled: true },
				aiImages: { enabled: true },
			},
		});
		assert.equal(result.enabled, true);
		assert.equal(result.visible, true);
		assert.equal(result.locked, false);
		assert.deepEqual(result.missingKeys, []);
		assert.ok(result.dependencyChain.includes('features.ai_layout'));
		assert.ok(result.dependencyChain.includes('templates.premium'));
		assert.ok(result.dependencyChain.includes('aiImages'));
	});

	it('denies with transitive missingKeys (ab_variations → ai_layout → premium + aiImages)', () => {
		const result = evaluateFeatureAccess({
			featureKey: 'features.ab_variations',
			features: {
				'features.ab_variations': { enabled: true },
				'features.ai_layout': { enabled: true },
				// missing templates.premium and aiImages
			},
		});
		assert.equal(result.enabled, false);
		assert.equal(result.visible, true);
		assert.equal(result.locked, true);
		assert.ok(result.missingKeys.includes('templates.premium'));
		assert.ok(result.missingKeys.includes('aiImages'));
		assert.ok(result.dependencyChain.includes('features.ab_variations'));
		assert.ok(result.dependencyChain.includes('features.ai_layout'));
	});

	it('supports legacy boolean feature grants', () => {
		const result = evaluateFeatureAccess({
			featureKey: 'aiImages',
			features: { aiImages: true },
		});
		assert.equal(result.enabled, true);
		assert.equal(result.locked, false);
	});

	it('admin bypasses plan grants', () => {
		const result = evaluateFeatureAccess({
			featureKey: 'templates.premium',
			features: {},
			isPlatformAdmin: true,
		});
		assert.equal(result.enabled, true);
		assert.equal(result.visible, true);
		assert.equal(result.locked, false);
		assert.deepEqual(result.missingKeys, []);
	});

	it('unknown feature keys fail closed', () => {
		const result = evaluateFeatureAccess({
			featureKey: 'evil.feature',
			features: { 'evil.feature': true },
		});
		assert.equal(result.visible, false);
		assert.equal(result.enabled, false);
		assert.equal(result.locked, false);
		assert.deepEqual(result.missingKeys, ['evil.feature']);
		assert.deepEqual(result.dependencyChain, []);
	});

	it('dependency cycles fail closed', () => {
		const result = evaluateFeatureAccess(
			{
				featureKey: 'features.ai_layout',
				features: {
					'features.ai_layout': true,
					'templates.premium': true,
					aiImages: true,
				},
			},
			{
				getFeatureDependencyClosure: () => {
					throw Object.assign(new Error('cycle'), { code: 'FEATURE_CATALOG_CYCLE' });
				},
				getFeatureCatalogEntry: () => ({
					key: 'features.ai_layout',
					defaultVisibleWhenLocked: true,
				}),
			},
		);
		assert.equal(result.enabled, false);
		assert.equal(result.locked, true);
		assert.deepEqual(result.missingKeys, ['features.ai_layout']);
		assert.deepEqual(result.dependencyChain, []);
	});

	it('respects defaultVisibleWhenLocked false', () => {
		const lockedHidden = evaluateFeatureAccess(
			{
				featureKey: 'aiWriter',
				features: {},
			},
			{
				getFeatureCatalogEntry: () => ({
					key: 'aiWriter',
					defaultVisibleWhenLocked: false,
				}),
			},
		);
		assert.equal(lockedHidden.enabled, false);
		assert.equal(lockedHidden.visible, false);
		assert.equal(lockedHidden.locked, false);
	});

	it('evaluateFeatureAccessForPlan reads plan.features and user role', () => {
		const denied = evaluateFeatureAccessForPlan(
			{ features: { 'templates.premium': { enabled: false } } },
			'templates.premium',
			{ user: { role: 'user' } },
		);
		assert.equal(denied.enabled, false);
		assert.equal(denied.locked, true);

		const allowed = evaluateFeatureAccessForPlan(
			{ features: {} },
			'templates.premium',
			{ user: { role: 'admin' } },
		);
		assert.equal(allowed.enabled, true);
	});
});
