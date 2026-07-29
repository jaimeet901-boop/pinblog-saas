/**
 * Plan feature helpers (Feature Catalog / plans.features).
 * Supports legacy booleans and `{ enabled: boolean }` values.
 */

/**
 * @param {unknown} features
 * @param {string} key
 * @returns {boolean}
 */
export function isPlanFeatureEnabled(features, key) {
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
 * Flatten plan.features into checkbox-friendly booleans for Admin forms.
 * @param {unknown} features
 * @param {string[]} keys
 * @returns {Record<string, boolean>}
 */
export function flattenPlanFeaturesForForm(features, keys) {
	const out = {};
	for (const key of keys) {
		out[key] = isPlanFeatureEnabled(features, key);
	}
	return out;
}

/**
 * Serialize form booleans to architecture target shape for API writes.
 * @param {Record<string, boolean| {enabled?: boolean}>} formFeatures
 * @returns {Record<string, { enabled: boolean }>}
 */
export function serializePlanFeaturesForApi(formFeatures) {
	const out = {};
	if (!formFeatures || typeof formFeatures !== 'object') return out;
	for (const [key, value] of Object.entries(formFeatures)) {
		out[key] = { enabled: isPlanFeatureEnabled({ [key]: value }, key) };
	}
	return out;
}
