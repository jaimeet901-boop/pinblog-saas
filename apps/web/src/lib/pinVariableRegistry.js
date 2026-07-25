/**
 * Variable Engine — registry-based, provider-independent.
 *
 * - No hardcoded variables in renderer/editor (they call this module only)
 * - Namespaces, nested paths, fallbacks, formatters, conditionals
 * - Third-party registerVariable / registerAiVariableProvider
 * - Resolve-before-render: compositor receives resolved strings only
 */

import {
	getBuiltInVariableDefinitions,
	LEGACY_VARIABLE_TOKENS,
	NAMESPACED_VARIABLE_TOKENS,
} from './pinVariableBuiltins.js';
import {
	evaluateExpression,
	extractExpressions,
} from './pinVariableExpression.js';
import { listFormatters, resetFormattersForTests } from './pinVariableFormatters.js';
import { coerceString, normalizePathKey } from './pinVariablePaths.js';
import { VARIABLE_TYPES } from './pinVariableTypes.js';

/** @type {Map<string, object>} path id → definition */
const registry = new Map();

/** @type {Map<string, { id: string, resolve: Function }>} */
const aiProviders = new Map();

let seeded = false;

function toToken(pathOrToken) {
	const raw = String(pathOrToken || '').trim();
	if (raw.startsWith('{{') && raw.endsWith('}}')) return raw;
	return `{{${normalizePathKey(raw)}}}`;
}

function toPath(pathOrToken) {
	return normalizePathKey(pathOrToken);
}

function ensureSeeded() {
	if (seeded) return;
	for (const def of getBuiltInVariableDefinitions()) {
		registerVariable(def, { internal: true });
	}
	seeded = true;
}

/**
 * Register a variable definition.
 * @param {object} entry
 * @param {{ internal?: boolean }} [options]
 */
export function registerVariable(entry, options = {}) {
	if (!options.internal) ensureSeeded();
	const path = toPath(entry?.id || entry?.path || entry?.token);
	if (!path) throw new Error('registerVariable requires id/path/token');

	const type = entry.type || VARIABLE_TYPES.USER;
	if (!Object.values(VARIABLE_TYPES).includes(type)) {
		throw new Error(`Unknown variable type: ${type}`);
	}

	let resolve = entry.resolve;
	if (typeof resolve !== 'function') {
		if (type === VARIABLE_TYPES.STATIC) {
			const value = entry.value ?? '';
			resolve = () => value;
		} else {
			throw new Error('registerVariable requires resolve(ctx) unless type=static with value');
		}
	}

	const def = {
		id: path,
		token: toToken(path),
		namespace: entry.namespace || (path.includes('.') ? path.split('.')[0] : 'custom'),
		type,
		resolve,
		meta: entry.meta || null,
		source: options.internal ? 'builtin' : (entry.source || 'third-party'),
	};
	registry.set(path, def);
	return def;
}

/**
 * Future AI-generated variables — providers resolve unresolved `ai.*` (or any) paths.
 * @param {{ id: string, resolve: (path: string, ctx: object) => unknown|Promise<unknown>, match?: (path: string) => boolean }} provider
 */
export function registerAiVariableProvider(provider) {
	ensureSeeded();
	const id = String(provider?.id || '').trim();
	if (!id) throw new Error('AI provider id required');
	if (typeof provider.resolve !== 'function') {
		throw new Error('AI provider requires resolve(path, ctx)');
	}
	aiProviders.set(id, {
		id,
		resolve: provider.resolve,
		match: provider.match || ((path) => path.startsWith('ai.')),
	});
}

export function listAiVariableProviders() {
	return [...aiProviders.keys()];
}

export function listRegisteredVariables() {
	ensureSeeded();
	return [...registry.values()].map((def) => def.token);
}

export function listVariableDefinitions() {
	ensureSeeded();
	return [...registry.values()].map((def) => ({ ...def }));
}

export function getVariableDefinition(pathOrToken) {
	ensureSeeded();
	return registry.get(toPath(pathOrToken)) || null;
}

export function resetVariableRegistryForTests() {
	registry.clear();
	aiProviders.clear();
	seeded = false;
	resetFormattersForTests();
}

function resolvePathFromRegistry(path, context) {
	const def = registry.get(path);
	if (!def) return undefined;
	try {
		return def.resolve(context);
	} catch {
		return '';
	}
}

function resolvePathWithAi(path, context) {
	const fromRegistry = resolvePathFromRegistry(path, context);
	if (fromRegistry !== undefined) return fromRegistry;

	for (const provider of aiProviders.values()) {
		if (!provider.match(path)) continue;
		try {
			const value = provider.resolve(path, context);
			if (value !== undefined && value !== null) return value;
		} catch {
			// continue
		}
	}
	return undefined;
}

/**
 * Build a flat map of registered tokens → resolved strings.
 * @param {object} context
 */
export function resolveVariables(context = {}) {
	ensureSeeded();
	const out = {};
	for (const def of registry.values()) {
		try {
			out[def.token] = coerceString(def.resolve(context));
		} catch {
			out[def.token] = '';
		}
	}
	return out;
}

/**
 * Resolve a single expression body (without {{ }}).
 */
export function resolveExpression(expression, context = {}) {
	ensureSeeded();
	return coerceString(evaluateExpression(expression, context, {
		resolvePath: resolvePathWithAi,
	}));
}

/**
 * Apply variables to a string. Supports full expressions inside {{ }}.
 * @param {string} value
 * @param {object|Record<string,string>} variablesOrContext
 * @param {{ replaceUnknown?: 'empty'|'keep', collectIssues?: boolean }} [options]
 */
export function applyVariablesToString(value, variablesOrContext = {}, options = {}) {
	ensureSeeded();
	const replaceUnknown = options.replaceUnknown || 'empty';
	const issues = [];

	// Precomputed map (legacy callers)
	if (isVariableMap(variablesOrContext)) {
		const map = variablesOrContext;
		const result = String(value ?? '').replace(/\{\{([^{}]+)\}\}/g, (match, expr) => {
			const token = `{{${normalizePathKey(expr)}}}`;
			if (Object.prototype.hasOwnProperty.call(map, token)) return map[token];
			if (Object.prototype.hasOwnProperty.call(map, match)) return map[match];
			// Fall through to expression eval with empty context if map miss
			try {
				return resolveExpression(expr, {});
			} catch {
				issues.push({ expression: expr, reason: 'unresolved' });
				return replaceUnknown === 'keep' ? match : '';
			}
		});
		if (options.collectIssues) return { text: result, issues };
		return result;
	}

	const context = variablesOrContext || {};
	const result = String(value ?? '').replace(/\{\{([^{}]+)\}\}/g, (match, expr) => {
		try {
			const validation = validateExpression(expr, { allowUnregisteredPaths: true });
			if (!validation.ok && validation.severity === 'error') {
				issues.push(...validation.issues);
				return replaceUnknown === 'keep' ? match : '';
			}
			const resolved = resolveExpression(expr, context);
			if (resolved === '' && replaceUnknown === 'keep') {
				const pathOnly = normalizePathKey(expr);
				if (pathOnly && !registry.has(pathOnly) && !expr.includes('||') && !expr.includes('?')) {
					issues.push({ expression: expr, reason: 'unknown_variable' });
					return match;
				}
			}
			return resolved;
		} catch (error) {
			issues.push({ expression: expr, reason: error.message || 'invalid' });
			return replaceUnknown === 'keep' ? match : '';
		}
	});

	if (options.collectIssues) return { text: result, issues };
	return result;
}

function isVariableMap(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const keys = Object.keys(value);
	if (!keys.length) return false;
	return keys.every((key) => key.startsWith('{{') && key.endsWith('}}'));
}

/**
 * Deep-replace all string fields in a document (resolve-before-render).
 */
export function resolveVariablesInDocument(doc, context = {}, options = {}) {
	ensureSeeded();
	const issues = [];
	const resolved = walkReplace(doc, context, options, issues);
	if (options.collectIssues) {
		return { document: resolved, issues };
	}
	return resolved;
}

function walkReplace(value, context, options, issues) {
	if (typeof value === 'string') {
		const result = applyVariablesToString(value, context, {
			...options,
			collectIssues: true,
		});
		if (result.issues?.length) issues.push(...result.issues);
		return result.text;
	}
	if (Array.isArray(value)) {
		return value.map((item) => walkReplace(item, context, options, issues));
	}
	if (value && typeof value === 'object') {
		const out = {};
		for (const [key, entry] of Object.entries(value)) {
			out[key] = walkReplace(entry, context, options, issues);
		}
		return out;
	}
	return value;
}

/**
 * Validate an expression for unknown variables / bad formatters.
 * @param {string} expression
 * @param {{ allowUnregisteredPaths?: boolean }} [options]
 */
export function validateExpression(expression, options = {}) {
	ensureSeeded();
	const issues = [];
	const expr = String(expression || '').trim();
	if (!expr) {
		return { ok: false, severity: 'error', issues: [{ reason: 'empty_expression' }] };
	}

	try {
		// Dry-run evaluate with empty context — catches formatter errors
		evaluateExpression(expr, {}, {
			resolvePath: (path) => {
				if (registry.has(path)) return '';
				if (options.allowUnregisteredPaths) return '';
				issues.push({ expression: path, reason: 'unknown_variable' });
				return '';
			},
		});
	} catch (error) {
		issues.push({ expression: expr, reason: error.message || 'invalid_expression' });
	}

	const paths = collectPathsFromExpression(expr);
	for (const path of paths) {
		if (!registry.has(path) && !path.startsWith('ai.') && !path.startsWith('user.')) {
			issues.push({ expression: path, reason: 'unknown_variable' });
		}
	}

	const severity = issues.some((i) => i.reason === 'invalid_expression' || i.reason === 'empty_expression')
		? 'error'
		: (issues.length ? 'warning' : 'ok');

	return {
		ok: severity !== 'error',
		severity,
		issues,
	};
}

function collectPathsFromExpression(expr) {
	const cleaned = String(expr)
		.replace(/"[^"]*"/g, ' ')
		.replace(/'[^']*'/g, ' ');
	const paths = [];
	const re = /[a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)+/g;
	let match = re.exec(cleaned);
	while (match) {
		paths.push(match[0]);
		match = re.exec(cleaned);
	}
	// Also bare identifiers that are registered legacy tokens
	const bare = cleaned.match(/\b[a-zA-Z_][\w]*\b/g) || [];
	for (const name of bare) {
		if (['true', 'false', 'null'].includes(name)) continue;
		if (listFormatters().includes(name)) continue;
		if (registry.has(name)) paths.push(name);
	}
	return [...new Set(paths)];
}

/**
 * Validate all {{expressions}} inside a document.
 */
export function validateDocumentVariables(doc, options = {}) {
	const issues = [];
	walkCollect(doc, issues, options);
	return {
		ok: !issues.some((i) => i.severity === 'error'),
		issues,
	};
}

function walkCollect(value, issues, options) {
	if (typeof value === 'string') {
		for (const item of extractExpressions(value)) {
			const result = validateExpression(item.expression, options);
			for (const issue of result.issues) {
				issues.push({
					...issue,
					raw: item.raw,
					severity: result.severity === 'error' ? 'error' : 'warning',
				});
			}
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((item) => walkCollect(item, issues, options));
		return;
	}
	if (value && typeof value === 'object') {
		Object.values(value).forEach((entry) => walkCollect(entry, issues, options));
	}
}

export {
	VARIABLE_TYPES,
	LEGACY_VARIABLE_TOKENS,
	NAMESPACED_VARIABLE_TOKENS,
	extractExpressions,
	listFormatters,
};
