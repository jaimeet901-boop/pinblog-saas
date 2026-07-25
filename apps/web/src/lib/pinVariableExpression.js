/**
 * Expression evaluator for {{ ... }} bodies.
 * Supports: paths, || fallbacks, ternary, formatters (fn() and | pipe).
 */

import { applyFormatter } from './pinVariableFormatters.js';
import {
	coerceString,
	getByPath,
	isTruthy,
	normalizePathKey,
	parseLiteral,
} from './pinVariablePaths.js';

/**
 * Resolve a value from context + optional path resolver (registry).
 * @param {string} expr
 * @param {object} context
 * @param {{ resolvePath?: (path: string, ctx: object) => unknown }} [api]
 */
export function evaluateExpression(expr, context = {}, api = {}) {
	const raw = String(expr || '').trim();
	if (!raw) return '';

	// Ternary: a ? b : c  (single level, non-nested for M5)
	const ternary = splitTernary(raw);
	if (ternary) {
		const cond = evaluateExpression(ternary.condition, context, api);
		return isTruthy(cond)
			? evaluateExpression(ternary.consequent, context, api)
			: evaluateExpression(ternary.alternate, context, api);
	}

	// Fallbacks: a || b || c
	if (raw.includes('||')) {
		const parts = splitOutsideQuotes(raw, '||');
		for (const part of parts) {
			const value = evaluateExpression(part.trim(), context, api);
			if (isTruthy(value)) return coerceString(value);
		}
		return '';
	}

	// Pipe formatters: value | uppercase | truncate:20
	if (raw.includes('|')) {
		const segments = splitOutsideQuotes(raw, '|').map((s) => s.trim()).filter(Boolean);
		let value = evaluateExpression(segments[0], context, api);
		for (let i = 1; i < segments.length; i += 1) {
			const [name, ...args] = parseFormatterCall(segments[i]);
			value = applyFormatter(name, value, args);
		}
		return coerceString(value);
	}

	// Function formatters: uppercase(post.title) / truncate(post.title, 20)
	const fnMatch = raw.match(/^([a-zA-Z_][\w]*)\((.*)\)$/);
	if (fnMatch) {
		const name = fnMatch[1];
		const inner = fnMatch[2];
		const args = splitOutsideQuotes(inner, ',').map((s) => s.trim()).filter((s) => s.length);
		const primary = args[0] != null ? evaluateExpression(args[0], context, api) : '';
		const rest = args.slice(1).map((arg) => {
			const lit = parseLiteral(arg);
			if (lit != null) return lit;
			const value = evaluateExpression(arg, context, api);
			return value;
		});
		return coerceString(applyFormatter(name, primary, rest.map((v) => coerceString(v))));
	}

	const literal = parseLiteral(raw);
	if (literal != null) return literal;

	// Numeric / boolean literals
	if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
	if (raw === 'true') return true;
	if (raw === 'false') return false;

	return coerceString(resolvePathValue(raw, context, api));
}

function resolvePathValue(pathExpr, context, api) {
	const path = normalizePathKey(pathExpr);
	if (!path) return '';

	if (typeof api.resolvePath === 'function') {
		const fromRegistry = api.resolvePath(path, context);
		if (fromRegistry !== undefined) return fromRegistry;
	}

	// Nested context lookup (namespaces live on context)
	const nested = getByPath(context, path);
	if (nested !== undefined) return nested;

	// Flat alias: title → context.title
	if (!path.includes('.')) {
		return context[path];
	}

	// Try last segment on root (legacy)
	const leaf = path.split('.').pop();
	if (leaf && context[leaf] !== undefined) return context[leaf];

	return undefined;
}

function splitTernary(raw) {
	let depth = 0;
	let inQuote = null;
	let qIndex = -1;
	let cIndex = -1;
	for (let i = 0; i < raw.length; i += 1) {
		const ch = raw[i];
		if (inQuote) {
			if (ch === inQuote) inQuote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			inQuote = ch;
			continue;
		}
		if (ch === '(') depth += 1;
		if (ch === ')') depth -= 1;
		if (depth !== 0) continue;
		if (ch === '?' && qIndex === -1) qIndex = i;
		else if (ch === ':' && qIndex !== -1) {
			cIndex = i;
			break;
		}
	}
	if (qIndex === -1 || cIndex === -1) return null;
	return {
		condition: raw.slice(0, qIndex).trim(),
		consequent: raw.slice(qIndex + 1, cIndex).trim(),
		alternate: raw.slice(cIndex + 1).trim(),
	};
}

function splitOutsideQuotes(input, delimiter) {
	const out = [];
	let current = '';
	let inQuote = null;
	let depth = 0;
	for (let i = 0; i < input.length; i += 1) {
		const ch = input[i];
		if (inQuote) {
			current += ch;
			if (ch === inQuote) inQuote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			inQuote = ch;
			current += ch;
			continue;
		}
		if (ch === '(') depth += 1;
		if (ch === ')') depth -= 1;
		if (depth === 0 && input.slice(i, i + delimiter.length) === delimiter) {
			out.push(current);
			current = '';
			i += delimiter.length - 1;
			continue;
		}
		current += ch;
	}
	out.push(current);
	return out;
}

function parseFormatterCall(segment) {
	const text = String(segment || '').trim();
	if (text.includes(':')) {
		const [name, ...rest] = text.split(':');
		return [name.trim(), ...rest.map((r) => r.trim())];
	}
	const match = text.match(/^([a-zA-Z_][\w]*)(?:\((.*)\))?$/);
	if (!match) return [text];
	const args = match[2]
		? splitOutsideQuotes(match[2], ',').map((s) => s.trim()).filter(Boolean)
		: [];
	return [match[1], ...args];
}

/**
 * Find all {{ ... }} expressions in a string.
 */
export function extractExpressions(text) {
	const source = String(text ?? '');
	const matches = [];
	const re = /\{\{([^{}]+)\}\}/g;
	let match = re.exec(source);
	while (match) {
		matches.push({
			raw: match[0],
			expression: match[1].trim(),
			index: match.index,
		});
		match = re.exec(source);
	}
	return matches;
}
