/**
 * Locked-feature identity for UpgradeModal (UI labels only — not permission logic).
 * Kept dependency-free so node:test can import it without Vite aliases.
 */

/** Display labels for known Feature Catalog keys. */
const FEATURE_LABELS = Object.freeze({
	aiWriter: 'AI Writer',
	aiImages: 'AI Images',
	pinterest: 'Pinterest',
	facebook: 'Facebook',
	wordpress: 'WordPress',
	websites: 'Websites',
	calendar: 'Calendar',
	analytics: 'Analytics',
	history: 'History',
	templates: 'Templates',
	brandKit: 'Brand Kit',
	priorityQueue: 'Priority Queue',
	apiAccess: 'API Access',
	'templates.standard': 'Standard templates',
	'templates.premium': 'Premium templates',
	'templates.elite': 'Elite templates',
	'features.ai_layout': 'AI Layout',
	'features.ab_variations': 'A/B Variations',
	'features.remove_background': 'Remove Background',
	'features.brand_kit': 'Brand Kit',
	'features.premium_fonts': 'Premium Fonts',
	'features.premium_stickers': 'Premium Stickers',
});

const SOURCE_PAGE_FEATURE_HINT = Object.freeze({
	ai_pins_images: 'aiImages',
	ai_pins_writer: 'aiWriter',
	writer: 'aiWriter',
	ai_writer: 'aiWriter',
	pinterest: 'pinterest',
	facebook: 'facebook',
	wordpress: 'wordpress',
	websites: 'websites',
	calendar: 'calendar',
	analytics: 'analytics',
});

const FEATURE_SOURCE_PAGE = Object.freeze({
	aiImages: 'ai_pins_images',
	aiWriter: 'ai_pins_writer',
	pinterest: 'pinterest',
	facebook: 'facebook',
	wordpress: 'wordpress',
	websites: 'websites',
	calendar: 'calendar',
	analytics: 'analytics',
});

/**
 * @param {string} key
 * @returns {string}
 */
export function formatFeatureKeyLabel(key) {
	const raw = String(key || '').trim();
	if (!raw) return '';
	if (FEATURE_LABELS[raw]) return FEATURE_LABELS[raw];
	const leaf = raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : raw;
	const spaced = leaf.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
	return spaced.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * @param {string[]} missingKeys
 * @returns {string[]}
 */
export function formatMissingFeatureLabels(missingKeys = []) {
	return [...new Set((missingKeys || []).map(formatFeatureKeyLabel).filter(Boolean))];
}

/**
 * Resolve the locked feature identity for UpgradeModal from FEATURE_LOCKED context.
 * Never defaults to aiWriter when another feature key is present.
 *
 * @param {object} [errorOrContext]
 * @param {{ sourcePage?: string, requiredFeatureKeys?: string[], templateName?: string }} [options]
 * @returns {{ featureKey: string, label: string, requiredFeatureKeys: string[], sourcePage: string }}
 */
export function resolveLockedFeatureIdentity(errorOrContext = {}, options = {}) {
	const ctx = errorOrContext && typeof errorOrContext === 'object' ? errorOrContext : {};
	const sourcePageHint = String(options.sourcePage || ctx.sourcePage || '').trim();
	const explicitKey = String(ctx.featureKey || '').trim();
	const requiredFromOptions = Array.isArray(options.requiredFeatureKeys)
		? options.requiredFeatureKeys
		: [];
	const keys = [
		explicitKey,
		...(Array.isArray(ctx.access?.missingKeys) ? ctx.access.missingKeys : []),
		...(Array.isArray(ctx.requiredKeys) ? ctx.requiredKeys : []),
		...(Array.isArray(ctx.requiredFeatureKeys) ? ctx.requiredFeatureKeys : []),
		...requiredFromOptions,
	].map((key) => String(key || '').trim()).filter(Boolean);

	const unique = [...new Set(keys)];
	const sourceHintKey = SOURCE_PAGE_FEATURE_HINT[sourcePageHint] || '';

	let featureKey = '';
	if (explicitKey) {
		featureKey = explicitKey;
	} else if (sourceHintKey && (unique.includes(sourceHintKey) || unique.length === 0)) {
		featureKey = sourceHintKey;
	} else if (unique.includes('aiImages')) {
		featureKey = 'aiImages';
	} else if (unique.includes('aiWriter') && sourceHintKey !== 'aiImages') {
		featureKey = 'aiWriter';
	} else if (unique[0]) {
		featureKey = unique[0];
	} else if (sourceHintKey) {
		featureKey = sourceHintKey;
	}

	const labelFromKeys = formatMissingFeatureLabels(featureKey ? [featureKey] : unique);
	const fallbackName = String(options.templateName || ctx.templateName || '').trim();
	const label = labelFromKeys[0]
		|| (fallbackName && !/^ai writer$/i.test(fallbackName) ? fallbackName : '')
		|| (featureKey ? formatFeatureKeyLabel(featureKey) : 'This feature');

	const requiredFeatureKeys = featureKey
		? [featureKey]
		: (unique.length ? unique : (sourceHintKey ? [sourceHintKey] : []));

	const sourcePage = FEATURE_SOURCE_PAGE[featureKey]
		|| sourcePageHint
		|| 'upgrade_modal';

	return {
		featureKey: featureKey || requiredFeatureKeys[0] || '',
		label,
		requiredFeatureKeys,
		sourcePage,
	};
}
