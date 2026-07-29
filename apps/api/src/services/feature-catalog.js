/**
 * Feature Catalog — registry of Chef IA plan-gated capabilities.
 *
 * NOT a subscription system. Plans grant/deny these keys via plans.features.
 * This module only defines what features exist, how they group, and dependencies.
 */

export const FEATURE_CATALOG_GROUPS = Object.freeze([
	{ id: 'core', label: 'Core product' },
	{ id: 'templates', label: 'Templates' },
	{ id: 'ai', label: 'AI Features' },
	{ id: 'brand', label: 'Brand' },
]);

/**
 * @typedef {object} FeatureCatalogEntry
 * @property {string} key
 * @property {string} label
 * @property {string} group
 * @property {string} [description]
 * @property {'ga'|'reserved'} [stage]
 * @property {string[]} [dependencies]
 * @property {boolean} [defaultVisibleWhenLocked]
 */

/** @type {readonly FeatureCatalogEntry[]} */
export const FEATURE_CATALOG = Object.freeze([
	// —— Core (legacy plan.features keys; valid dependency targets) ——
	{
		key: 'aiWriter',
		label: 'AI Writer',
		group: 'core',
		description: 'AI text generation for articles and pin copy.',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'aiImages',
		label: 'AI Images',
		group: 'core',
		description: 'AI image generation for pins.',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'templates',
		label: 'Templates (legacy)',
		group: 'core',
		description: 'Legacy templates flag. Prefer templates.standard / templates.premium.',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'brandKit',
		label: 'Brand Kit (legacy)',
		group: 'core',
		description: 'Legacy brand kit flag. Prefer features.brand_kit.',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'analytics',
		label: 'Analytics',
		group: 'core',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'calendar',
		label: 'Calendar',
		group: 'core',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'pinterest',
		label: 'Pinterest',
		group: 'core',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'wordpress',
		label: 'WordPress',
		group: 'core',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'history',
		label: 'Publishing history',
		group: 'core',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'apiAccess',
		label: 'API access',
		group: 'core',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'priorityQueue',
		label: 'Priority queue',
		group: 'core',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},

	// —— Templates ——
	{
		key: 'templates.standard',
		label: 'Standard templates',
		group: 'templates',
		description: 'Use non-premium catalog templates (apply / generate).',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'templates.premium',
		label: 'Premium templates',
		group: 'templates',
		description: 'Use premium Pinterest template library.',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'templates.elite',
		label: 'Elite templates',
		group: 'templates',
		description: 'Highest-tier and seasonal elite collections.',
		stage: 'reserved',
		dependencies: ['templates.premium'],
		defaultVisibleWhenLocked: true,
	},

	// —— AI Features ——
	{
		key: 'features.ai_layout',
		label: 'AI Layout',
		group: 'ai',
		description: 'AI-assisted layout tools in the pin editor.',
		stage: 'ga',
		dependencies: ['templates.premium', 'aiImages'],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'features.ab_variations',
		label: 'A/B Variations',
		group: 'ai',
		description: 'Generate A/B layout variations.',
		stage: 'ga',
		dependencies: ['features.ai_layout'],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'features.remove_background',
		label: 'Remove Background',
		group: 'ai',
		description: 'AI background removal for pin images.',
		stage: 'ga',
		dependencies: ['aiImages'],
		defaultVisibleWhenLocked: true,
	},

	// —— Brand ——
	{
		key: 'features.brand_kit',
		label: 'Brand Kit',
		group: 'brand',
		description: 'Apply workspace brand kit to pins.',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'features.premium_fonts',
		label: 'Premium Fonts',
		group: 'brand',
		description: 'Access premium font pairings.',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
	{
		key: 'features.premium_stickers',
		label: 'Premium Stickers',
		group: 'brand',
		description: 'Access premium sticker packs.',
		stage: 'ga',
		dependencies: [],
		defaultVisibleWhenLocked: true,
	},
]);

const BY_KEY = new Map(FEATURE_CATALOG.map((entry) => [entry.key, entry]));

export function listFeatureCatalog() {
	return FEATURE_CATALOG.map((entry) => ({ ...entry, dependencies: [...(entry.dependencies || [])] }));
}

export function listFeatureCatalogGroups() {
	return FEATURE_CATALOG_GROUPS.map((group) => ({ ...group }));
}

export function getFeatureCatalogEntry(key) {
	const entry = BY_KEY.get(String(key || '').trim());
	if (!entry) return null;
	return { ...entry, dependencies: [...(entry.dependencies || [])] };
}

export function hasFeatureCatalogKey(key) {
	return BY_KEY.has(String(key || '').trim());
}

/**
 * Direct dependencies declared on the catalog entry (not transitive).
 * @param {string} key
 * @returns {string[]}
 */
export function getFeatureDependencies(key) {
	const entry = BY_KEY.get(String(key || '').trim());
	return entry ? [...(entry.dependencies || [])] : [];
}

/**
 * Transitive dependency closure including the feature key itself (first).
 * Throws if the catalog has a cycle or unknown dependency (fail closed).
 * @param {string} key
 * @returns {string[]}
 */
export function getFeatureDependencyClosure(key) {
	const root = String(key || '').trim();
	if (!root) return [];
	if (!BY_KEY.has(root)) {
		throw Object.assign(new Error(`Unknown feature catalog key: ${root}`), {
			code: 'FEATURE_CATALOG_UNKNOWN_KEY',
		});
	}

	const ordered = [];
	const visiting = new Set();
	const visited = new Set();

	function visit(node) {
		if (visited.has(node)) return;
		if (visiting.has(node)) {
			throw Object.assign(new Error(`Feature catalog dependency cycle at: ${node}`), {
				code: 'FEATURE_CATALOG_CYCLE',
			});
		}
		if (!BY_KEY.has(node)) {
			throw Object.assign(new Error(`Unknown feature dependency: ${node}`), {
				code: 'FEATURE_CATALOG_UNKNOWN_DEPENDENCY',
			});
		}
		visiting.add(node);
		for (const dep of BY_KEY.get(node).dependencies || []) {
			visit(String(dep));
		}
		visiting.delete(node);
		visited.add(node);
		ordered.push(node);
	}

	visit(root);
	// Closure for "required keys to execute root" = deps first, then root.
	// `ordered` is post-order (deps before node). Ensure root is last.
	return ordered;
}

/**
 * Validate catalog integrity (unique keys, known deps, no cycles).
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateFeatureCatalog() {
	const errors = [];
	const seen = new Set();

	for (const entry of FEATURE_CATALOG) {
		const key = String(entry.key || '').trim();
		if (!key) {
			errors.push('Catalog entry missing key');
			continue;
		}
		if (seen.has(key)) errors.push(`Duplicate feature key: ${key}`);
		seen.add(key);

		if (!FEATURE_CATALOG_GROUPS.some((group) => group.id === entry.group)) {
			errors.push(`Feature ${key} has unknown group: ${entry.group}`);
		}

		for (const dep of entry.dependencies || []) {
			const depKey = String(dep || '').trim();
			if (!depKey) {
				errors.push(`Feature ${key} has empty dependency`);
				continue;
			}
			if (!BY_KEY.has(depKey)) {
				errors.push(`Feature ${key} depends on unknown key: ${depKey}`);
			}
		}
	}

	for (const key of seen) {
		try {
			getFeatureDependencyClosure(key);
		} catch (error) {
			errors.push(error?.message || String(error));
		}
	}

	return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Admin/API DTO: groups with nested features.
 */
export function getFeatureCatalogDto() {
	const invariants = validateFeatureCatalog();
	const groups = FEATURE_CATALOG_GROUPS.map((group) => ({
		id: group.id,
		label: group.label,
		features: FEATURE_CATALOG
			.filter((entry) => entry.group === group.id)
			.map((entry) => ({
				key: entry.key,
				label: entry.label,
				description: entry.description || '',
				stage: entry.stage || 'ga',
				dependencies: [...(entry.dependencies || [])],
				defaultVisibleWhenLocked: entry.defaultVisibleWhenLocked !== false,
			})),
	}));

	return {
		version: 1,
		groups,
		keys: FEATURE_CATALOG.map((entry) => entry.key),
		invariants,
	};
}

// Fail fast if the catalog is corrupted at module load in development/tests.
const bootCheck = validateFeatureCatalog();
if (!bootCheck.ok) {
	console.error('[feature-catalog] invalid catalog', bootCheck.errors);
}
