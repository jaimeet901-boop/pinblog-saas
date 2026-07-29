/**
 * Plan feature normalization & validation.
 *
 * Target shape: `{ "templates.premium": { "enabled": true } }`
 * Legacy booleans remain accepted on input and are converted on normalize.
 */

import { FEATURE_CATALOG, hasFeatureCatalogKey } from './feature-catalog.js';
import { DEFAULT_FEATURES } from './plan-catalog.js';

function validationError(message) {
	const error = new Error(message);
	error.status = 422;
	error.errorCode = 'VALIDATION_ERROR';
	return error;
}

/**
 * @param {unknown} features
 * @param {string} key
 * @returns {boolean}
 */
export function isFeatureEnabled(features, key) {
	if (!features || typeof features !== 'object' || Array.isArray(features)) return false;
	const value = features[key];
	if (value == null) return false;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'enabled')) {
		return Boolean(value.enabled);
	}
	return false;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {{ enabled: boolean }}
 */
export function normalizeFeatureValue(value, field = 'features') {
	if (typeof value === 'boolean') {
		return { enabled: value };
	}
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		if (!Object.prototype.hasOwnProperty.call(value, 'enabled')) {
			throw validationError(`${field} must be a boolean or { enabled: boolean }`);
		}
		if (typeof value.enabled !== 'boolean') {
			throw validationError(`${field}.enabled must be a boolean`);
		}
		const extraKeys = Object.keys(value).filter((k) => k !== 'enabled');
		if (extraKeys.length) {
			throw validationError(`${field} must only include "enabled"`);
		}
		return { enabled: value.enabled };
	}
	throw validationError(`${field} must be a boolean or { enabled: boolean }`);
}

/**
 * Validate create/update features payload. Rejects unknown keys and invalid shapes.
 * @param {unknown} input
 * @returns {Record<string, unknown>}
 */
export function validateFeaturesPayload(input) {
	if (input == null || typeof input !== 'object' || Array.isArray(input)) {
		throw validationError('features must be a plain object');
	}

	const seen = new Set();
	for (const key of Object.keys(input)) {
		if (!key || typeof key !== 'string') {
			throw validationError('features keys must be non-empty strings');
		}
		if (seen.has(key)) {
			throw validationError(`Duplicate feature key: ${key}`);
		}
		seen.add(key);

		if (!hasFeatureCatalogKey(key)) {
			throw validationError(`Unknown feature key: ${key}`);
		}

		normalizeFeatureValue(input[key], `features.${key}`);
	}

	return input;
}

/**
 * Normalize plan.features to catalog keys with `{ enabled }` values.
 * @param {unknown} input
 * @param {{ validate?: boolean }} [options] validate=true rejects unknown/invalid (writes). validate=false is lenient (reads).
 * @returns {Record<string, { enabled: boolean }>}
 */
export function normalizeFeatures(input, { validate = true } = {}) {
	if (validate) {
		if (input == null) {
			throw validationError('features must be a plain object');
		}
		validateFeaturesPayload(input);
	}

	const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
	/** @type {Record<string, { enabled: boolean }>} */
	const features = {};

	for (const entry of FEATURE_CATALOG) {
		features[entry.key] = { enabled: false };
	}

	for (const [key, value] of Object.entries(DEFAULT_FEATURES)) {
		if (!hasFeatureCatalogKey(key) || value == null) continue;
		if (typeof value === 'boolean') {
			features[key] = { enabled: value };
		} else if (typeof value === 'object' && !Array.isArray(value) && 'enabled' in value) {
			features[key] = { enabled: Boolean(value.enabled) };
		}
	}

	for (const [key, value] of Object.entries(source)) {
		if (!hasFeatureCatalogKey(key)) continue;
		if (value == null) continue;
		if (validate) {
			features[key] = normalizeFeatureValue(value, `features.${key}`);
			continue;
		}
		if (typeof value === 'boolean') {
			features[key] = { enabled: value };
		} else if (typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'enabled')) {
			features[key] = { enabled: Boolean(value.enabled) };
		}
	}

	return features;
}
