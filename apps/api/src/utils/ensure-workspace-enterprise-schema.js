/**
 * Runtime ensure for Enterprise Workspace Management fields / collections.
 */
import logger from './logger.js';
import { extractCollectionFieldNames, clearCollectionSchemaCache } from './pocketbase-safe-query.js';

function fieldNames(model) {
	return extractCollectionFieldNames(model);
}

function getFieldsArray(model) {
	if (Array.isArray(model?.fields)) return model.fields;
	if (Array.isArray(model?.schema)) return model.schema;
	return [];
}

function hasField(model, name) {
	return fieldNames(model).has(name);
}

function buildTextField(name, max = 0) {
	return { name, type: 'text', ...(max ? { max } : {}) };
}

function buildJsonField(name, maxSize = 200000) {
	return { name, type: 'json', maxSize };
}

function buildDateField(name) {
	return { name, type: 'date' };
}

function buildBoolField(name) {
	return { name, type: 'bool' };
}

function buildSelectField(name, values) {
	return { name, type: 'select', maxSelect: 1, values };
}

function buildRelationField(name, collectionId, { required = false, cascadeDelete = false } = {}) {
	return {
		name,
		type: 'relation',
		required,
		maxSelect: 1,
		collectionId,
		cascadeDelete,
	};
}

function buildAutodateField(name, { onCreate = true, onUpdate = false } = {}) {
	return { name, type: 'autodate', onCreate, onUpdate };
}

async function ensureFields(pocketbaseClient, collectionName, requiredFields) {
	let collection = await pocketbaseClient.collections.getOne(collectionName).catch(() => null);
	if (!collection) return null;
	const missing = requiredFields.filter((field) => !hasField(collection, field.name));
	const roleField = getFieldsArray(collection).find((field) => field.name === 'role' && field.type === 'select');
	const statusField = getFieldsArray(collection).find((field) => field.name === 'status' && field.type === 'select');
	const patches = {};

	if (roleField) {
		const next = ['owner', 'administrator', 'editor', 'author', 'viewer', 'custom'];
		const current = Array.isArray(roleField.values) ? roleField.values : [];
		if (next.some((value) => !current.includes(value))) {
			patches.fields = getFieldsArray(collection).map((field) => (
				field.name === 'role'
					? { ...field, values: next }
					: field
			));
		}
	}
	if (statusField) {
		const next = ['active', 'invited', 'suspended', 'removed'];
		const current = Array.isArray(statusField.values) ? statusField.values : [];
		if (next.some((value) => !current.includes(value))) {
			const base = patches.fields || getFieldsArray(collection);
			patches.fields = base.map((field) => (
				field.name === 'status'
					? { ...field, values: next }
					: field
			));
		}
	}
	if (missing.length) {
		patches.fields = [...(patches.fields || getFieldsArray(collection)), ...missing];
	}
	if (!Object.keys(patches).length) return collection;

	logger.warn('Updating workspace enterprise schema', {
		collection: collectionName,
		missing: missing.map((field) => field.name),
	});
	collection = await pocketbaseClient.collections.update(collection.id, patches);
	clearCollectionSchemaCache(collectionName);
	return collection;
}

export async function ensureWorkspaceEnterpriseSchema(pocketbaseClient) {
	await ensureFields(pocketbaseClient, 'workspace_members', [
		buildJsonField('permissions'),
		buildTextField('custom_role_name', 80),
		buildTextField('invite_email', 255),
		buildTextField('invite_token', 120),
		buildDateField('invite_expires_at'),
		buildDateField('last_active_at'),
		buildDateField('suspended_at'),
		buildTextField('suspended_reason', 500),
	]);

	let roles = await pocketbaseClient.collections.getOne('workspace_roles').catch(() => null);
	if (!roles) {
		const workspaces = await pocketbaseClient.collections.getOne('workspaces').catch(() => null);
		const users = await pocketbaseClient.collections.getOne('users').catch(() => null);
		if (!workspaces) return;

		logger.warn('Creating workspace_roles collection');
		roles = await pocketbaseClient.collections.create({
			type: 'base',
			name: 'workspace_roles',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				buildRelationField('workspace', workspaces.id, { required: true, cascadeDelete: true }),
				buildTextField('name', 80),
				buildTextField('slug', 64),
				buildTextField('description', 500),
				buildJsonField('permissions'),
				buildBoolField('is_system'),
				buildBoolField('active'),
				users
					? buildRelationField('created_by', users.id)
					: buildTextField('created_by', 64),
				buildAutodateField('created', { onCreate: true, onUpdate: false }),
				buildAutodateField('updated', { onCreate: true, onUpdate: true }),
			],
			indexes: [
				'CREATE UNIQUE INDEX `idx_workspace_roles_slug` ON `workspace_roles` (`workspace`, `slug`)',
			],
		}).catch((error) => {
			logger.warn('Failed creating workspace_roles', { message: error?.message });
			return null;
		});
		if (roles) clearCollectionSchemaCache('workspace_roles');
	}
}
