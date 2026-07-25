/**
 * Path / expression helpers for the variable engine.
 */

export function getByPath(source, path) {
	if (source == null) return undefined;
	const parts = String(path || '')
		.split('.')
		.map((part) => part.trim())
		.filter(Boolean);
	let current = source;
	for (const part of parts) {
		if (current == null) return undefined;
		current = current[part];
	}
	return current;
}

export function isTruthy(value) {
	if (value == null) return false;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
	const text = String(value).trim();
	if (!text || text === '0' || text.toLowerCase() === 'false') return false;
	return true;
}

export function coerceString(value) {
	if (value == null) return '';
	return String(value);
}

/**
 * Strip wrapping quotes from a literal.
 */
export function parseLiteral(token) {
	const text = String(token || '').trim();
	if (
		(text.startsWith('"') && text.endsWith('"'))
		|| (text.startsWith("'") && text.endsWith("'"))
	) {
		return text.slice(1, -1);
	}
	return null;
}

/**
 * Normalize a variable path key: post.title / recipe.prep_time
 */
export function normalizePathKey(path) {
	return String(path || '')
		.trim()
		.replace(/^\{\{\s*/, '')
		.replace(/\s*\}\}$/, '')
		.replace(/\s+/g, '');
}
