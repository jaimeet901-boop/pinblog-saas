/**
 * Production may lag behind Facebook F1/F2 PocketBase migrations.
 * Self-heal Hub + OAuth collections via the PocketBase superuser collections API.
 */
import logger from './logger.js';
import { clearCollectionSchemaCache, extractCollectionFieldNames } from './pocketbase-safe-query.js';

const CREDENTIALS = 'facebook_app_credentials';
const ACCOUNTS = 'facebook_accounts';
const SECRETS = 'facebook_account_secrets';
const PAGES = 'facebook_pages';
const OAUTH_STATES = 'facebook_oauth_states';

let ensurePromise = null;

export function isMissingFacebookCollectionError(error) {
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

function autodateFields() {
	return [
		{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
		{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
	];
}

function relation(name, collectionId, { required = false, cascadeDelete = false } = {}) {
	return {
		name,
		type: 'relation',
		required,
		maxSelect: 1,
		collectionId,
		cascadeDelete,
	};
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
		...autodateFields(),
	];
}

function accountFields(usersId, workspacesId) {
	return [
		relation('owner', usersId, { required: true, cascadeDelete: true }),
		relation('workspace', workspacesId, { required: true, cascadeDelete: false }),
		{ name: 'facebook_user_id', type: 'text', required: true, max: 120 },
		{ name: 'username', type: 'text', max: 255 },
		{ name: 'label', type: 'text', max: 255 },
		{ name: 'account_name', type: 'text', max: 255 },
		{ name: 'profile_image_url', type: 'text', max: 1000 },
		{ name: 'scope', type: 'text', max: 2000 },
		{ name: 'connected', type: 'bool' },
		{
			name: 'status',
			type: 'select',
			maxSelect: 1,
			values: ['connected', 'expired', 'error', 'disconnected'],
		},
		{ name: 'status_error', type: 'text', max: 2000 },
		{ name: 'token_expires_at', type: 'date' },
		{ name: 'last_sync_at', type: 'date' },
		{ name: 'connected_at', type: 'date' },
		{ name: 'is_default', type: 'bool' },
		{ name: 'oauth_app_id', type: 'text', max: 200 },
		{ name: 'workspace_key', type: 'text', max: 120 },
		...autodateFields(),
	];
}

function secretFields(usersId, workspacesId, accountsId) {
	return [
		relation('owner', usersId, { required: true, cascadeDelete: true }),
		relation('workspace', workspacesId, { required: true, cascadeDelete: false }),
		relation('account', accountsId, { required: true, cascadeDelete: true }),
		{ name: 'access_token', type: 'text', max: 4000 },
		{ name: 'refresh_token', type: 'text', max: 4000 },
		{ name: 'page_tokens', type: 'json', maxSize: 200000 },
		...autodateFields(),
	];
}

function pageFields(usersId, workspacesId, accountsId, websitesId) {
	const fields = [
		relation('owner', usersId, { required: true, cascadeDelete: true }),
		relation('workspace', workspacesId, { required: true, cascadeDelete: false }),
		relation('account', accountsId, { required: true, cascadeDelete: true }),
		{ name: 'page_id', type: 'text', required: true, max: 120 },
		{ name: 'name', type: 'text', required: true, max: 300 },
		{ name: 'category', type: 'text', max: 200 },
		{ name: 'thumbnail_url', type: 'text', max: 1000 },
		{ name: 'fan_count', type: 'number', min: 0 },
		{ name: 'tasks', type: 'json', maxSize: 50000 },
		{ name: 'is_default', type: 'bool' },
		{ name: 'connected', type: 'bool' },
		...autodateFields(),
	];
	if (websitesId) {
		fields.splice(fields.length - 2, 0, relation('websiteId', websitesId, { cascadeDelete: false }));
	}
	return fields;
}

function oauthStateFields(usersId, workspacesId, websitesId) {
	const fields = [
		relation('owner', usersId, { required: true, cascadeDelete: true }),
		relation('workspace', workspacesId, { required: true, cascadeDelete: false }),
		{ name: 'state', type: 'text', required: true, max: 200 },
		{ name: 'expires_at', type: 'date', required: true },
		{ name: 'used', type: 'bool' },
		{ name: 'return_path', type: 'text', max: 500 },
		{ name: 'account_id', type: 'text', max: 80 },
		{ name: 'requested_label', type: 'text', max: 255 },
		{ name: 'workspace_id', type: 'text', max: 80 },
		{ name: 'workspace_key', type: 'text', max: 120 },
		...autodateFields(),
	];
	if (websitesId) {
		fields.splice(fields.length - 2, 0, relation('websiteId', websitesId, { cascadeDelete: false }));
	}
	return fields;
}

async function getCollectionOrNull(pocketbaseClient, name) {
	try {
		return await pocketbaseClient.collections.getOne(name);
	} catch (error) {
		if (isMissingFacebookCollectionError(error)) return null;
		throw error;
	}
}

async function ensureCollection(pocketbaseClient, {
	name,
	fields,
	indexes = [],
}) {
	let collection = await getCollectionOrNull(pocketbaseClient, name);
	if (!collection) {
		logger.warn(`[facebook-schema] creating missing ${name} collection`);
		collection = await pocketbaseClient.collections.create({
			name,
			type: 'base',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			indexes,
			fields,
		});
		logger.info(`[facebook-schema] ${name} collection created`, { id: collection.id });
		clearCollectionSchemaCache(name);
		return collection;
	}

	const existing = fieldNames(collection);
	const missing = fields.filter((field) => !existing.has(field.name));
	if (missing.length) {
		logger.warn(`[facebook-schema] adding missing ${name} fields`, {
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
		clearCollectionSchemaCache(name);
	}
	return collection;
}

/**
 * Ensure Facebook Hub + OAuth collections exist (API-only rules).
 * Covers facebook_app_credentials and the Hub collections used by GET /facebook/accounts.
 */
export async function ensureFacebookOAuthSchema(pocketbaseClient) {
	if (!ensurePromise) {
		ensurePromise = (async () => {
			const users = await pocketbaseClient.collections.getOne('users');
			const workspaces = await pocketbaseClient.collections.getOne('workspaces');
			const websites = await getCollectionOrNull(pocketbaseClient, 'websites');

			await ensureCollection(pocketbaseClient, {
				name: CREDENTIALS,
				fields: credentialFields(),
				indexes: [
					'CREATE UNIQUE INDEX `idx_facebook_app_credentials_key` ON `facebook_app_credentials` (`config_key`)',
				],
			});

			const accounts = await ensureCollection(pocketbaseClient, {
				name: ACCOUNTS,
				fields: accountFields(users.id, workspaces.id),
				indexes: [
					'CREATE UNIQUE INDEX `idx_facebook_accounts_workspace_user` ON `facebook_accounts` (`workspace`, `facebook_user_id`)',
					'CREATE INDEX `idx_facebook_accounts_workspace` ON `facebook_accounts` (`workspace`)',
					'CREATE INDEX `idx_facebook_accounts_owner` ON `facebook_accounts` (`owner`)',
					'CREATE INDEX `idx_facebook_accounts_connected` ON `facebook_accounts` (`connected`)',
				],
			});

			await ensureCollection(pocketbaseClient, {
				name: SECRETS,
				fields: secretFields(users.id, workspaces.id, accounts.id),
				indexes: [
					'CREATE UNIQUE INDEX `idx_facebook_account_secrets_account` ON `facebook_account_secrets` (`account`)',
					'CREATE INDEX `idx_facebook_account_secrets_workspace` ON `facebook_account_secrets` (`workspace`)',
					'CREATE INDEX `idx_facebook_account_secrets_owner` ON `facebook_account_secrets` (`owner`)',
				],
			});

			await ensureCollection(pocketbaseClient, {
				name: PAGES,
				fields: pageFields(users.id, workspaces.id, accounts.id, websites?.id),
				indexes: [
					'CREATE UNIQUE INDEX `idx_facebook_pages_workspace_page` ON `facebook_pages` (`workspace`, `page_id`)',
					'CREATE INDEX `idx_facebook_pages_account` ON `facebook_pages` (`account`)',
					'CREATE INDEX `idx_facebook_pages_workspace` ON `facebook_pages` (`workspace`)',
				],
			});

			await ensureCollection(pocketbaseClient, {
				name: OAUTH_STATES,
				fields: oauthStateFields(users.id, workspaces.id, websites?.id),
				indexes: [
					'CREATE UNIQUE INDEX `idx_facebook_oauth_states_state` ON `facebook_oauth_states` (`state`)',
					'CREATE INDEX `idx_facebook_oauth_states_owner_expires` ON `facebook_oauth_states` (`owner`, `expires_at`)',
				],
			});

			return true;
		})().catch((error) => {
			ensurePromise = null;
			throw error;
		});
	}

	return ensurePromise;
}

/** Alias — Hub + OAuth share the same ensure path. */
export const ensureFacebookChannelSchema = ensureFacebookOAuthSchema;

export {
	CREDENTIALS as FACEBOOK_APP_CREDENTIALS_COLLECTION,
	ACCOUNTS as FACEBOOK_ACCOUNTS_COLLECTION,
};
