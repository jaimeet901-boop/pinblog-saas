/**
 * Unit tests for locked-feature identity (node:test, no Vite).
 * Run: node --test src/lib/__tests__/lockedFeatureIdentity.test.js
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { resolveLockedFeatureIdentity } from '../lockedFeatureIdentity.js';

describe('resolveLockedFeatureIdentity', () => {
	it('AI Pins + aiImages → AI Images', () => {
		const id = resolveLockedFeatureIdentity({
			featureKey: 'aiImages',
			access: { missingKeys: ['aiImages'] },
		}, { sourcePage: 'ai_pins_images' });
		assert.equal(id.featureKey, 'aiImages');
		assert.equal(id.label, 'AI Images');
		assert.equal(id.sourcePage, 'ai_pins_images');
	});

	it('AI Writer + aiWriter → AI Writer', () => {
		const id = resolveLockedFeatureIdentity({
			featureKey: 'aiWriter',
			access: { missingKeys: ['aiWriter'] },
		}, { sourcePage: 'ai_pins_writer' });
		assert.equal(id.featureKey, 'aiWriter');
		assert.equal(id.label, 'AI Writer');
	});

	it('channel features use their actual keys', () => {
		assert.equal(resolveLockedFeatureIdentity({ access: { missingKeys: ['pinterest'] } }).label, 'Pinterest');
		assert.equal(resolveLockedFeatureIdentity({ access: { missingKeys: ['facebook'] } }).label, 'Facebook');
		assert.equal(resolveLockedFeatureIdentity({ access: { missingKeys: ['wordpress'] } }).label, 'WordPress');
		assert.equal(resolveLockedFeatureIdentity({ access: { missingKeys: ['websites'] } }).label, 'Websites');
		assert.equal(resolveLockedFeatureIdentity({ access: { missingKeys: ['calendar'] } }).label, 'Calendar');
		assert.equal(resolveLockedFeatureIdentity({ access: { missingKeys: ['analytics'] } }).label, 'Analytics');
	});

	it('does not default to AI Writer when another feature is locked', () => {
		const id = resolveLockedFeatureIdentity({
			access: { missingKeys: ['aiImages'] },
			requiredFeatureKeys: ['aiImages'],
		}, { sourcePage: 'ai_pins_images', templateName: 'AI Writer' });
		assert.equal(id.label, 'AI Images');
		assert.notEqual(id.label, 'AI Writer');
	});

	it('websites featureKey resolves to Websites identity', () => {
		const id = resolveLockedFeatureIdentity({
			featureKey: 'websites',
			access: { locked: true, enabled: false, visible: true, missingKeys: [] },
		}, { sourcePage: 'websites', requiredFeatureKeys: ['websites'] });
		assert.equal(id.featureKey, 'websites');
		assert.equal(id.label, 'Websites');
		assert.equal(id.sourcePage, 'websites');
	});
});
