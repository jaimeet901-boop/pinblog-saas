import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	attachAllowedAccess,
	attachTemplateAccess,
	evaluateTemplateAccess,
	featureLockedError,
	isPremiumTemplate,
	mergeAccessResults,
	resolveRequiredFeatureKeys,
} from './plan-access-guard.js';

describe('plan-access-guard resolveRequiredFeatureKeys', () => {
	it('returns empty for standard templates (no gate)', () => {
		assert.deepEqual(resolveRequiredFeatureKeys({ visibility: 'official' }), []);
		assert.deepEqual(resolveRequiredFeatureKeys({
			marketplace_meta: { tags: ['hero'], official: true },
		}), []);
	});

	it('reads marketplace_meta.access.requires', () => {
		assert.deepEqual(resolveRequiredFeatureKeys({
			marketplace_meta: { access: { requires: ['templates.premium', 'aiImages'] } },
		}), ['templates.premium', 'aiImages']);
	});

	it('infers templates.premium from premium flags / tier', () => {
		assert.deepEqual(resolveRequiredFeatureKeys({
			marketplace_meta: { premium: true },
		}), ['templates.premium']);
		assert.deepEqual(resolveRequiredFeatureKeys({
			marketplace_meta: { isPremium: true },
		}), ['templates.premium']);
		assert.deepEqual(resolveRequiredFeatureKeys({
			marketplace_meta: { access: { tier: 'premium' } },
		}), ['templates.premium']);
		assert.deepEqual(resolveRequiredFeatureKeys({
			marketplace_meta: { access: { tier: 'elite' } },
		}), ['templates.elite']);
		assert.deepEqual(resolveRequiredFeatureKeys({ premium: true }), ['templates.premium']);
	});
});

describe('plan-access-guard evaluateTemplateAccess', () => {
	it('allows when plan grants required keys', async () => {
		const access = await evaluateTemplateAccess(
			{ pocketbaseUserId: 'u1' },
			{ marketplace_meta: { premium: true } },
			{
				context: {
					isPlatformAdmin: false,
					plan: {
						features: {
							'templates.premium': { enabled: true },
						},
					},
				},
			},
		);
		assert.equal(access.enabled, true);
		assert.equal(access.locked, false);
		assert.deepEqual(access.requiredKeys, ['templates.premium']);
	});

	it('locks when premium not granted', async () => {
		const access = await evaluateTemplateAccess(
			{ pocketbaseUserId: 'u1' },
			{ marketplace_meta: { access: { requires: ['templates.premium'] } } },
			{
				context: {
					isPlatformAdmin: false,
					plan: { features: { 'templates.premium': { enabled: false } } },
				},
			},
		);
		assert.equal(access.enabled, false);
		assert.equal(access.locked, true);
		assert.ok(access.missingKeys.includes('templates.premium'));
	});

	it('admin bypasses', async () => {
		const access = await evaluateTemplateAccess(
			{ pocketbaseUserId: 'admin1' },
			{ marketplace_meta: { premium: true } },
			{
				context: {
					isPlatformAdmin: true,
					plan: { features: {} },
				},
			},
		);
		assert.equal(access.enabled, true);
		assert.equal(access.locked, false);
	});

	it('skips gate for owned private drafts', async () => {
		const access = await evaluateTemplateAccess(
			{ pocketbaseUserId: 'u1', workspaceOwnerId: 'u1' },
			{
				owner: 'u1',
				visibility: 'private',
				marketplace_meta: { premium: true },
			},
			{
				context: {
					isPlatformAdmin: false,
					plan: { features: {} },
				},
			},
		);
		assert.equal(access.enabled, true);
		assert.deepEqual(access.requiredKeys, []);
	});
});

describe('plan-access-guard helpers', () => {
	it('mergeAccessResults requires all keys enabled', () => {
		const merged = mergeAccessResults([
			{ visible: true, enabled: true, locked: false, missingKeys: [], dependencyChain: ['a'] },
			{ visible: true, enabled: false, locked: true, missingKeys: ['b'], dependencyChain: ['b'] },
		]);
		assert.equal(merged.enabled, false);
		assert.equal(merged.locked, true);
		assert.deepEqual(merged.missingKeys, ['b']);
	});

	it('attachTemplateAccess redacts configuration when locked', () => {
		const item = attachTemplateAccess(
			{ id: 't1', configuration: { layers: [] }, marketplace: { meta: { premium: true } } },
			{
				visible: true,
				enabled: false,
				locked: true,
				missingKeys: ['templates.premium'],
				dependencyChain: ['templates.premium'],
				requiredKeys: ['templates.premium'],
			},
		);
		assert.equal(item.configuration, undefined);
		assert.equal(item.access.locked, true);
		assert.equal(item.premium, true);
	});

	it('featureLockedError carries standardized access payload', () => {
		const err = featureLockedError({
			visible: true,
			enabled: false,
			locked: true,
			missingKeys: ['templates.premium'],
			dependencyChain: ['templates.premium'],
			requiredKeys: ['templates.premium'],
		});
		assert.equal(err.status, 403);
		assert.equal(err.errorCode, 'FEATURE_LOCKED');
		assert.deepEqual(err.access.missingKeys, ['templates.premium']);
		assert.ok(err.access.locked);
	});

	it('isPremiumTemplate detects flags', () => {
		assert.equal(isPremiumTemplate({ marketplace_meta: { premium: true } }), true);
		assert.equal(isPremiumTemplate({ marketplace_meta: { tags: [] } }), false);
	});

	it('attachAllowedAccess always sets enabled=true and no config redaction', () => {
		const item = attachAllowedAccess({
			id: 't2',
			configuration: { layers: [1, 2, 3] },
		});
		assert.equal(item.access.enabled, true);
		assert.equal(item.access.locked, false);
		assert.equal(item.premium, false);
		assert.deepEqual(item.access.missingKeys, []);
		// configuration must be preserved (owner path)
		assert.deepEqual(item.configuration, { layers: [1, 2, 3] });
	});
});
