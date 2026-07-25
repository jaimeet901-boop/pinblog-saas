/**
 * Formatting functions for variable expressions.
 * Registry-based — third parties can registerFormatter().
 */

import { VARIABLE_FORMATTERS } from './pinVariableTypes.js';

/** @type {Map<string, (value: unknown, args?: string[]) => string>} */
const formatters = new Map();

function asString(value) {
	if (value == null) return '';
	return String(value);
}

function seedFormatters() {
	if (formatters.size) return;
	formatters.set('uppercase', (value) => asString(value).toUpperCase());
	formatters.set('lowercase', (value) => asString(value).toLowerCase());
	formatters.set('capitalize', (value) => {
		const text = asString(value);
		if (!text) return '';
		return text.charAt(0).toUpperCase() + text.slice(1);
	});
	formatters.set('truncate', (value, args = []) => {
		const text = asString(value);
		const max = Number(args[0]) || 40;
		if (text.length <= max) return text;
		return `${text.slice(0, Math.max(0, max - 1))}…`;
	});
	formatters.set('date', (value, args = []) => {
		if (value == null || value === '') return '';
		const date = value instanceof Date ? value : new Date(value);
		if (Number.isNaN(date.getTime())) return asString(value);
		const style = args[0] || 'short';
		if (style === 'iso') return date.toISOString().slice(0, 10);
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: style === 'long' ? 'long' : 'short',
			day: 'numeric',
		});
	});
	formatters.set('number', (value, args = []) => {
		const num = Number(value);
		if (!Number.isFinite(num)) return asString(value);
		const digits = args[0] != null ? Number(args[0]) : undefined;
		return new Intl.NumberFormat(undefined, {
			maximumFractionDigits: Number.isFinite(digits) ? digits : 2,
		}).format(num);
	});
}

export function registerFormatter(name, fn) {
	seedFormatters();
	const id = String(name || '').trim().toLowerCase();
	if (!id) throw new Error('Formatter name required');
	if (typeof fn !== 'function') throw new Error('Formatter must be a function');
	formatters.set(id, fn);
}

export function listFormatters() {
	seedFormatters();
	return [...new Set([...VARIABLE_FORMATTERS, ...formatters.keys()])];
}

export function applyFormatter(name, value, args = []) {
	seedFormatters();
	const fn = formatters.get(String(name || '').toLowerCase());
	if (!fn) {
		throw new Error(`Unknown formatter: ${name}`);
	}
	return fn(value, args);
}

export function resetFormattersForTests() {
	formatters.clear();
}
