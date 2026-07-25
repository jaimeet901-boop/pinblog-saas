/**
 * Template identity + configuration checksum helpers.
 * No PocketBase imports — safe for renderer and API.
 */

/**
 * @returns {string} Immutable UUID v4 for template_uuid
 */
export function createTemplateUuid() {
	if (typeof globalThis.crypto?.randomUUID === 'function') {
		return globalThis.crypto.randomUUID();
	}
	// Fallback for older runtimes
	const bytes = new Uint8Array(16);
	if (typeof globalThis.crypto?.getRandomValues === 'function') {
		globalThis.crypto.getRandomValues(bytes);
	} else {
		for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Stable JSON for hashing: sorted keys, strip undefined.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalizeConfiguration(value) {
	return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value) {
	if (value === null || typeof value !== 'object') {
		return value === undefined ? null : value;
	}
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep);
	}
	const out = {};
	for (const key of Object.keys(value).sort()) {
		const entry = value[key];
		if (entry === undefined) continue;
		out[key] = sortKeysDeep(entry);
	}
	return out;
}

function bytesToHex(buffer) {
	return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 hex of canonical configuration JSON.
 * @param {unknown} configuration
 * @returns {Promise<string>}
 */
export async function hashTemplateConfiguration(configuration) {
	const payload = canonicalizeConfiguration(configuration ?? {});
	const encoded = new TextEncoder().encode(payload);

	if (typeof globalThis.crypto?.subtle?.digest === 'function') {
		const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
		return bytesToHex(digest);
	}

	const { createHash } = await import('node:crypto');
	return createHash('sha256').update(payload).digest('hex');
}

/**
 * Preview / render cache key — checksum-based (never use timestamps).
 * @param {{ templateId?: string, configChecksum: string, format?: string }} input
 */
export function buildPreviewCacheKey({ templateId = '', configChecksum, format = 'png' }) {
	const checksum = String(configChecksum || '').trim().toLowerCase();
	const fmt = String(format || 'png').trim().toLowerCase();
	return `${String(templateId || '')}:${checksum}:${fmt}`;
}

/**
 * Next revision for optimistic locking. Treat missing as 0 → 1.
 * @param {number|null|undefined} current
 */
export function nextRevision(current) {
	const n = Number(current);
	if (!Number.isFinite(n) || n < 1) return 1;
	return Math.floor(n) + 1;
}
