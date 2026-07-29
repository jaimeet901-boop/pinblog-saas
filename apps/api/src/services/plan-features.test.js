import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	isFeatureEnabled,
	normalizeFeatureValue,
	normalizeFeatures,
	validateFeaturesPayload,
} from './plan-features.js';

describe('plan-features', () => {
	it('normalizes legacy booleans to { enabled }', () => {
		const features = normalizeFeatures({
			aiWriter: true,
			aiImages: false,
			'templates.premium': true,
		});
		assert.deepEqual(features.aiWriter, { enabled: true });
		assert.deepEqual(features.aiImages, { enabled: false });
		assert.deepEqual(features['templates.premium'], { enabled: true });
		assert.deepEqual(features['features.ai_layout'], { enabled: false });
	});

	it('accepts object form and preserves enabled', () => {
		const features = normalizeFeatures({
			'templates.premium': { enabled: true },
			'features.ab_variations': { enabled: false },
		});
		assert.equal(features['templates.premium'].enabled, true);
		assert.equal(features['features.ab_variations'].enabled, false);
	});

	it('isFeatureEnabled supports boolean and object shapes', () => {
		assert.equal(isFeatureEnabled({ aiWriter: true }, 'aiWriter'), true);
		assert.equal(isFeatureEnabled({ aiWriter: false }, 'aiWriter'), false);
		assert.equal(isFeatureEnabled({ aiWriter: { enabled: true } }, 'aiWriter'), true);
		assert.equal(isFeatureEnabled({ aiWriter: { enabled: false } }, 'aiWriter'), false);
		assert.equal(isFeatureEnabled({ aiWriter: { enabled: false } }, 'missing'), false);
	});

	it('rejects unknown feature keys on validate', () => {
		assert.throws(
			() => validateFeaturesPayload({ notARealFeature: true }),
			(err) => err?.status === 422 && /Unknown feature key/.test(err.message),
		);
	});

	it('rejects invalid value types', () => {
		assert.throws(
			() => normalizeFeatureValue('yes', 'features.aiWriter'),
			(err) => err?.status === 422,
		);
		assert.throws(
			() => normalizeFeatureValue({ enabled: 'true' }, 'features.aiWriter'),
			(err) => err?.status === 422 && /must be a boolean/.test(err.message),
		);
		assert.throws(
			() => normalizeFeatureValue({ enabled: true, extra: 1 }, 'features.aiWriter'),
			(err) => err?.status === 422,
		);
		assert.throws(
			() => validateFeaturesPayload([]),
			(err) => err?.status === 422 && /plain object/.test(err.message),
		);
	});

	it('lenient read path strips unknown keys without throwing', () => {
		const features = normalizeFeatures(
			{ aiWriter: true, legacyUnknown: true },
			{ validate: false },
		);
		assert.equal(features.aiWriter.enabled, true);
		assert.equal(Object.prototype.hasOwnProperty.call(features, 'legacyUnknown'), false);
	});
});
