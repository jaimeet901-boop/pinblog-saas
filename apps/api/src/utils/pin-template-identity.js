/**
 * Template identity helpers (API) — mirror of web pinTemplateIdentity.
 * No PocketBase imports in hash/canonicalize logic beyond callers.
 */

import { createHash, randomUUID } from 'node:crypto';

export function createTemplateUuid() {
	return randomUUID();
}

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

export function hashTemplateConfigurationSync(configuration) {
	const payload = canonicalizeConfiguration(configuration ?? {});
	return createHash('sha256').update(payload).digest('hex');
}

export async function hashTemplateConfiguration(configuration) {
	return hashTemplateConfigurationSync(configuration);
}

export function buildPreviewCacheKey({ templateId = '', configChecksum, format = 'png' }) {
	const checksum = String(configChecksum || '').trim().toLowerCase();
	const fmt = String(format || 'png').trim().toLowerCase();
	return `${String(templateId || '')}:${checksum}:${fmt}`;
}

export function nextRevision(current) {
	const n = Number(current);
	if (!Number.isFinite(n) || n < 1) return 1;
	return Math.floor(n) + 1;
}
