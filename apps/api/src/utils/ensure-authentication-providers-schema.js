/**
 * Compat ensure for authentication_providers (login IdPs).
 * Migration 1785600000 is authoritative.
 */

import logger from './logger.js';

const COLLECTION = 'authentication_providers';

const FIELDS = [
	{ name: 'provider', type: 'text', required: true, max: 64 },
	{ name: 'display_name', type: 'text', max: 120 },
	{ name: 'client_id', type: 'text', max: 500 },
	{ name: 'client_secret_ciphertext', type: 'text', max: 4000 },
	{ name: 'redirect_uri', type: 'text', max: 1000 },
	{ name: 'scopes', type: 'text', max: 2000 },
	{ name: 'enabled', type: 'bool' },
	{ name: 'kek_version', type: 'text', max: 40 },
	{ name: 'meta', type: 'json' },
];

function fieldNames(collection) {
	const raw = collection?.fields || collection?.schema || [];
	return new Set((Array.isArray(raw) ? raw : []).map((field) => field?.name).filter(Boolean));
}

export async function ensureAuthenticationProvidersSchema(pb) {
	if (!pb?.collections) return null;

	let collection = await pb.collections.getOne(COLLECTION).catch(() => null);
	if (!collection) {
		try {
			collection = await pb.collections.create({
				name: COLLECTION,
				type: 'base',
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				fields: FIELDS,
			});
			logger.info('authentication_providers collection created (compat ensure)');
			return collection;
		} catch (error) {
			logger.warn('authentication_providers create skipped', { message: error?.message || String(error) });
			return null;
		}
	}

	const existing = fieldNames(collection);
	const missing = FIELDS.filter((field) => !existing.has(field.name));
	if (!missing.length) {
		return collection;
	}

	try {
		const nextFields = [...(collection.fields || []), ...missing];
		return await pb.collections.update(collection.id, {
			fields: nextFields,
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
		});
	} catch (error) {
		logger.warn('authentication_providers field ensure skipped', { message: error?.message || String(error) });
		return collection;
	}
}
