/**
 * Plan Access HTTP integration — enforces Access Module decisions on template/feature use.
 *
 * Does NOT change plan-access.js public API.
 * All permission evaluation goes through evaluateFeatureAccess* / evaluateFeatureAccessForPlan.
 */

import {
	evaluateFeatureAccess,
	evaluateFeatureAccessForPlan,
	isPlatformAdmin,
	resolveActivePlan,
} from './plan-access.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

const ALLOWED_ACCESS = Object.freeze({
	visible: true,
	enabled: true,
	locked: false,
	missingKeys: [],
	dependencyChain: [],
});

/**
 * Resolve marketplace / premium metadata from a template record or DTO.
 * @param {object} templateOrRecord
 * @returns {object}
 */
export function getTemplateMarketplaceMeta(templateOrRecord) {
	if (!templateOrRecord || typeof templateOrRecord !== 'object') return {};
	if (templateOrRecord.marketplace_meta && typeof templateOrRecord.marketplace_meta === 'object') {
		return templateOrRecord.marketplace_meta;
	}
	if (templateOrRecord.marketplace?.meta && typeof templateOrRecord.marketplace.meta === 'object') {
		return templateOrRecord.marketplace.meta;
	}
	return {};
}

/**
 * Feature keys required to USE (apply / editor config / generate / duplicate / export).
 * Empty → no plan gate (preserves existing access for non-premium templates).
 *
 * Convention (architecture): marketplace_meta.access.requires
 * Fallbacks: access.tier / meta.premium / meta.isPremium / template.premium
 *
 * @param {object} templateOrRecord
 * @returns {string[]}
 */
export function resolveRequiredFeatureKeys(templateOrRecord) {
	const meta = getTemplateMarketplaceMeta(templateOrRecord);
	const access = meta.access && typeof meta.access === 'object' ? meta.access : {};

	if (Array.isArray(access.requires) && access.requires.length) {
		return [...new Set(access.requires.map((key) => String(key || '').trim()).filter(Boolean))];
	}

	if (Array.isArray(templateOrRecord?.requiredFeatureKeys) && templateOrRecord.requiredFeatureKeys.length) {
		return [...new Set(templateOrRecord.requiredFeatureKeys.map((key) => String(key || '').trim()).filter(Boolean))];
	}

	const tier = String(access.tier || meta.tier || '').trim().toLowerCase();
	if (tier === 'elite') return ['templates.elite'];
	if (tier === 'premium') return ['templates.premium'];

	const premium = Boolean(
		templateOrRecord?.premium
		|| meta.premium
		|| meta.isPremium
		|| access.premium,
	);
	if (premium) return ['templates.premium'];

	return [];
}

export function isPremiumTemplate(templateOrRecord) {
	const keys = resolveRequiredFeatureKeys(templateOrRecord);
	if (keys.includes('templates.premium') || keys.includes('templates.elite')) return true;
	const meta = getTemplateMarketplaceMeta(templateOrRecord);
	return Boolean(
		templateOrRecord?.premium
		|| meta.premium
		|| meta.isPremium
		|| meta.access?.premium
		|| String(meta.access?.tier || meta.tier || '').toLowerCase() === 'premium'
		|| String(meta.access?.tier || meta.tier || '').toLowerCase() === 'elite',
	);
}

/**
 * Owned private drafts are not plan-gated (user's own work).
 * @param {object} req
 * @param {object} record
 * @returns {boolean}
 */
export function isOwnedPrivateTemplate(req, record) {
	if (!record || !req) return false;
	const visibility = String(record.visibility || '').trim();
	const isPrivate = !visibility || visibility === 'private';
	if (!isPrivate) return false;
	const owner = record.owner;
	if (!owner) return false;
	return owner === req.pocketbaseUserId || owner === req.workspaceOwnerId;
}

/**
 * Ensure req.isPlatformAdmin is set from users.role when possible.
 * @param {object} req
 * @returns {Promise<boolean>}
 */
export async function ensurePlatformAdminOnRequest(req) {
	if (!req) return false;
	if (req.isPlatformAdmin != null) return Boolean(req.isPlatformAdmin);
	if (req.adminUser) {
		req.isPlatformAdmin = isPlatformAdmin(req.adminUser);
		return req.isPlatformAdmin;
	}
	if (req.pocketbaseUser) {
		req.isPlatformAdmin = isPlatformAdmin(req.pocketbaseUser);
		return req.isPlatformAdmin;
	}
	if (!req.pocketbaseUserId) {
		req.isPlatformAdmin = false;
		return false;
	}
	const { default: pocketbaseClient } = await import('../utils/pocketbaseClient.js');
	const user = await pocketbaseClient.collection('users').getOne(req.pocketbaseUserId).catch(() => null);
	req.isPlatformAdmin = isPlatformAdmin(user);
	if (user) req.pocketbaseUser = user;
	return req.isPlatformAdmin;
}

/**
 * Load plan once for batch evaluations (gallery list).
 * @param {object} req
 * @returns {Promise<{ plan: object|null, isPlatformAdmin: boolean }>}
 */
export async function resolveAccessContext(req) {
	const admin = await ensurePlatformAdminOnRequest(req);
	const plan = await resolveActivePlan(req?.workspaceSubscription);
	return { plan, isPlatformAdmin: admin };
}

/**
 * Merge multiple FeatureAccessResult values (all required keys must be enabled).
 * @param {import('./plan-access.js').FeatureAccessResult[]} results
 * @returns {import('./plan-access.js').FeatureAccessResult}
 */
export function mergeAccessResults(results) {
	if (!results.length) {
		return { ...ALLOWED_ACCESS };
	}
	const missingKeys = [];
	const dependencyChain = [];
	let visible = false;
	let enabled = true;
	for (const result of results) {
		if (result.visible) visible = true;
		if (!result.enabled) enabled = false;
		for (const key of result.missingKeys || []) {
			if (!missingKeys.includes(key)) missingKeys.push(key);
		}
		for (const key of result.dependencyChain || []) {
			if (!dependencyChain.includes(key)) dependencyChain.push(key);
		}
	}
	return {
		visible,
		enabled,
		locked: visible && !enabled,
		missingKeys,
		dependencyChain,
	};
}

/**
 * Evaluate template USE access via Access Module only (no direct plan.features reads).
 * @param {object} req
 * @param {object} templateOrRecord
 * @param {{ context?: { plan: object|null, isPlatformAdmin: boolean } }} [options]
 * @returns {Promise<import('./plan-access.js').FeatureAccessResult & { requiredKeys: string[] }>}
 */
export async function evaluateTemplateAccess(req, templateOrRecord, options = {}) {
	if (isOwnedPrivateTemplate(req, templateOrRecord)) {
		return { ...ALLOWED_ACCESS, requiredKeys: [] };
	}

	const requiredKeys = resolveRequiredFeatureKeys(templateOrRecord);
	if (!requiredKeys.length) {
		return { ...ALLOWED_ACCESS, requiredKeys: [] };
	}

	const context = options.context || await resolveAccessContext(req);
	const results = requiredKeys.map((featureKey) => evaluateFeatureAccessForPlan(
		context.plan,
		featureKey,
		{ isPlatformAdmin: context.isPlatformAdmin },
	));
	const merged = mergeAccessResults(results);
	return { ...merged, requiredKeys };
}

/**
 * @param {import('./plan-access.js').FeatureAccessResult} access
 * @param {{ featureKey?: string, message?: string }} [extras]
 * @returns {Error}
 */
export function featureLockedError(access, extras = {}) {
	const error = httpError(
		403,
		extras.message || 'This feature requires a plan upgrade.',
		'FEATURE_LOCKED',
	);
	error.access = {
		visible: Boolean(access?.visible),
		enabled: Boolean(access?.enabled),
		locked: Boolean(access?.locked ?? (access?.visible && !access?.enabled)),
		missingKeys: [...(access?.missingKeys || [])],
		dependencyChain: [...(access?.dependencyChain || [])],
	};
	if (extras.featureKey) error.featureKey = extras.featureKey;
	if (Array.isArray(access?.requiredKeys) && access.requiredKeys.length) {
		error.requiredKeys = [...access.requiredKeys];
	}
	return error;
}

/**
 * Hard deny when template use is not enabled.
 * @param {object} req
 * @param {object} templateOrRecord
 * @param {{ context?: object }} [options]
 */
export async function assertTemplateUseAccess(req, templateOrRecord, options = {}) {
	const access = await evaluateTemplateAccess(req, templateOrRecord, options);
	if (access.enabled) return access;
	throw featureLockedError(access, {
		featureKey: access.requiredKeys?.[0],
		message: 'This template requires a plan upgrade to use.',
	});
}

/**
 * Assert a single catalog feature key via Access Module.
 * @param {object} req
 * @param {string} featureKey
 * @param {{ context?: object, message?: string }} [options]
 */
export async function assertFeatureAccess(req, featureKey, options = {}) {
	const context = options.context || await resolveAccessContext(req);
	const access = evaluateFeatureAccessForPlan(context.plan, featureKey, {
		isPlatformAdmin: context.isPlatformAdmin,
	});
	if (access.enabled) return access;
	throw featureLockedError(access, {
		featureKey,
		message: options.message || 'This feature requires a plan upgrade.',
	});
}

/**
 * Strip protected engine payload from a mapped template DTO.
 * @param {object} item
 * @returns {object}
 */
export function redactTemplateConfiguration(item) {
	if (!item || typeof item !== 'object') return item;
	const next = { ...item };
	delete next.configuration;
	if (next.marketplace && typeof next.marketplace === 'object') {
		next.marketplace = { ...next.marketplace };
	}
	return next;
}

/**
 * Attach access annotation used by preview-public responses.
 * @param {object} item
 * @param {import('./plan-access.js').FeatureAccessResult & { requiredKeys?: string[] }} access
 * @returns {object}
 */
export function attachTemplateAccess(item, access) {
	const requiredKeys = access.requiredKeys || resolveRequiredFeatureKeys(item);
	const annotated = {
		...item,
		premium: isPremiumTemplate(item),
		requiredFeatureKeys: requiredKeys,
		access: {
			visible: Boolean(access.visible),
			enabled: Boolean(access.enabled),
			locked: Boolean(access.locked),
			missingKeys: [...(access.missingKeys || [])],
			dependencyChain: [...(access.dependencyChain || [])],
		},
	};
	if (!access.enabled) {
		return redactTemplateConfiguration(annotated);
	}
	return annotated;
}

// Re-export evaluateFeatureAccess for callers that need raw key checks without importing plan-access.
export { evaluateFeatureAccess };

/**
 * Canonical "access granted" annotation for owned/private templates.
 * Use when the endpoint is already restricted to the owner (touch, status, own duplicate).
 * @returns {object}
 */
export function allowedAccessAnnotation() {
	return {
		access: {
			visible: true,
			enabled: true,
			locked: false,
			missingKeys: [],
			dependencyChain: [],
		},
		premium: false,
		requiredFeatureKeys: [],
	};
}

/**
 * Attach a standard "allowed" access annotation to an owned-only DTO.
 * @param {object} item
 * @returns {object}
 */
export function attachAllowedAccess(item) {
	if (!item || typeof item !== 'object') return item;
	return { ...item, ...allowedAccessAnnotation() };
}
