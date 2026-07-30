/**
 * Production may lag behind Facebook F2 migrations.
 * Self-heal facebook_app_credentials via the PocketBase superuser collections API.
 */
import logger from './logger.js';
import { clearCollectionSchemaCache, extractCollectionFieldNames } from './pocketbase-safe-query.js';

const COLLECTION = 'facebook_app_credentials';

let ensurePromise = null;

function isMissingCollectionError(error) {
	const message = String(error?.message || error?.data?.message || '').toLowerCase();
	const status = Number(error?.status || error?.response?.status || 0);
	return status === 404
		|| message.includes('missing or invalid collection')
		|| message.includes('collection context')
		|| message.includes("wasn't found")
		|| message.includes('not found');
}

function fieldNames(model) {
	return extractCollectionFieldNames(model);
}

function getFieldsArray(model) {
	if (Array.isArray(model?.fields)) return model.fields;
	if (Array.isArray(model?.schema)) return model.schema;
	return [];
}

function credentialFields() {
	return [
		{ name: 'config_key', type: 'text', required: true, max: 80 },
		{ name: 'app_id', type: 'text', max: 200 },
		{ name: 'app_secret_ciphertext', type: 'text', max: 4000 },
		{ name: 'redirect_uri', type: 'text', max: 1000 },
		{ name: 'scopes', type: 'text', max: 2000 },
		{ name: 'enabled', type: 'bool' },
		{ name: 'trial_access_pending', type: 'bool' },
		{ name: 'kek_version', type: 'text', max: 40 },
		{ name: 'meta', type: 'json', maxSize: 100000 },
		{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
		{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
	];
}

async function getCollectionOrNull(pocketbaseClient, name) {
	try {
		return await pocketbaseClient.collections.getOne(name);
	} catch (error) {
		if (isMissingCollectionError(error)) return null;
		throw error;
	}
}

/**
 * Ensure facebook_app_credentials exists with required fields (API-only rules).
 */
export async function ensureFacebookOAuthSchema(pocketbaseClient) {
	if (!ensurePromise) {
		ensurePromise = (async () => {
			let collection = await getCollectionOrNull(pocketbaseClient, COLLECTION);
			if (!collection) {
				logger.warn('[facebook-oauth] creating missing facebook_app_credentials collection');
				collection = await pocketbaseClient.collections.create({
					name: COLLECTION,
					type: 'base',
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					indexes: [
						'CREATE UNIQUE INDEX `idx_facebook_app_credentials_key` ON `facebook_app_credentials` (`config_key`)',
					],
					fields: credentialFields(),
				});
				logger.info('[facebook-oauth] facebook_app_credentials collection created', { id: collection.id });
			} else {
				const existing = fieldNames(collection);
				const missing = credentialFields().filter((field) => !existing.has(field.name));
				if (missing.length) {
					logger.warn('[facebook-oauth] adding missing facebook_app_credentials fields', {
						missing: missing.map((field) => field.name),
					});
					collection = await pocketbaseClient.collections.update(collection.id, {
						fields: [...getFieldsArray(collection), ...missing],
						listRule: null,
						viewRule: null,
						createRule: null,
						updateRule: null,
						deleteRule: null,
					});
				}
			}

			clearCollectionSchemaCache(COLLECTION);
			return collection;
		})().catch((error) => {
			ensurePromise = null;
			throw error;
		});
	}

	return ensurePromise;
}

export { COLLECTION as FACEBOOK_APP_CREDENTIALS_COLLECTION };
