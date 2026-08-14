/**
 * Runtime ensure for workspace ownership + onboarding schema.
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

function buildNumberField(name) {
	return { name, type: 'number' };
}

function buildBoolField(name) {
	return { name, type: 'bool' };
}

function buildDateField(name) {
	return { name, type: 'date' };
}

function buildJsonField(name, maxSize = 200000) {
	return { name, type: 'json', maxSize };
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

async function ensureFields(pocketbaseClient, collectionName, requiredFields, { mutateExisting } = {}) {
	let collection = await pocketbaseClient.collections.getOne(collectionName).catch(() => null);
	if (!collection) return null;

	let fields = getFieldsArray(collection);
	let dirty = false;

	if (typeof mutateExisting === 'function') {
		const next = mutateExisting(fields.map((field) => ({ ...field })));
		if (next) {
			fields = next;
			dirty = true;
		}
	}

	const missing = requiredFields.filter((field) => !hasField({ fields }, field.name));
	if (missing.length) {
		fields = [...fields, ...missing];
		dirty = true;
	}

	if (!dirty) return collection;

	logger.warn('Updating workspace ownership schema', {
		collection: collectionName,
		missing: missing.map((field) => field.name),
	});
	collection = await pocketbaseClient.collections.update(collection.id, { fields });
	clearCollectionSchemaCache(collectionName);
	return collection;
}

const CONTENT_COLLECTIONS = [
	'articles',
	'pins',
	'ai_pins',
	'ai_pin_image_jobs',
	'ai_pin_generation_history',
	'ai_pin_templates',
	'brand_kits',
	'websites',
	'wordpress_sites',
	'pinterest_accounts',
	'pinterest_boards',
	'pinterest_publish_jobs',
	'pinterest_publish_history',
	'publish_jobs',
	'publish_history',
	'queue_jobs',
];

/**
 * UNIQUE(workspace) gate — mirrors migration 1786600000 / legal-pages ensure.
 * Skip UNIQUE when 2+ blank workspace values would collide as "" or when
 * non-blank values duplicate. Return false on read error.
 */
async function canAddOnboardingWorkspaceUnique(pocketbaseClient) {
	try {
		const rows = await pocketbaseClient.collection('workspace_onboarding').getFullList({
			fields: 'id,workspace',
			requestKey: null,
		});
		if (!rows.length) return true;
		const seen = new Set();
		let blanks = 0;
		for (const row of rows) {
			const workspace = String(row.workspace || '').trim();
			if (!workspace) {
				blanks += 1;
				continue;
			}
			if (seen.has(workspace)) return false;
			seen.add(workspace);
		}
		return blanks <= 1;
	} catch {
		return false;
	}
}

export async function ensureWorkspaceOwnershipSchema(pocketbaseClient) {
	const workspaces = await pocketbaseClient.collections.getOne('workspaces').catch(() => null);
	const users = await pocketbaseClient.collections.getOne('users').catch(() => null);
	if (!workspaces || !users) return;

	await ensureFields(pocketbaseClient, 'workspace_members', [
		buildDateField('invite_sent_at'),
		buildNumberField('invite_resent_count'),
	], {
		mutateExisting(fields) {
			const userField = fields.find((field) => field.name === 'user');
			if (userField?.required) {
				return fields.map((field) => (field.name === 'user' ? { ...field, required: false } : field));
			}
			return null;
		},
	});

	for (const name of CONTENT_COLLECTIONS) {
		await ensureFields(pocketbaseClient, name, [
			buildRelationField('workspace', workspaces.id),
			buildRelationField('created_by', users.id),
			buildRelationField('last_edited_by', users.id),
		]);
	}

	await ensureFields(pocketbaseClient, 'workspaces', [
		buildNumberField('health_score'),
		buildTextField('health_label', 32),
		buildBoolField('onboarding_completed'),
	]);

	const onboardingFields = [
		buildRelationField('workspace', workspaces.id, { required: true, cascadeDelete: true }),
		buildJsonField('steps'),
		buildNumberField('completed_percent'),
		buildBoolField('skipped'),
		buildDateField('completed_at'),
		buildRelationField('updated_by', users.id),
		buildAutodateField('created', { onCreate: true, onUpdate: false }),
		buildAutodateField('updated', { onCreate: true, onUpdate: true }),
	];
	const onboardingIndex =
		'CREATE UNIQUE INDEX `idx_workspace_onboarding_ws` ON `workspace_onboarding` (`workspace`)';

	let onboarding = await pocketbaseClient.collections.getOne('workspace_onboarding').catch(() => null);
	if (!onboarding) {
		logger.warn('Creating workspace_onboarding collection');
		await pocketbaseClient.collections.create({
			type: 'base',
			name: 'workspace_onboarding',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: onboardingFields,
			indexes: [onboardingIndex],
		}).catch((error) => logger.warn('workspace_onboarding create failed', { message: error?.message }));
		clearCollectionSchemaCache('workspace_onboarding');
	} else {
		const missing = onboardingFields.filter((field) => !hasField(onboarding, field.name));
		const indexes = Array.isArray(onboarding.indexes) ? [...onboarding.indexes] : [];
		if (!indexes.some((sql) => String(sql).includes('idx_workspace_onboarding_ws'))) {
			if (await canAddOnboardingWorkspaceUnique(pocketbaseClient)) {
				indexes.push(onboardingIndex);
			}
		}
		const indexesChanged = JSON.stringify(indexes) !== JSON.stringify(onboarding.indexes || []);
		if (missing.length || indexesChanged) {
			logger.warn('Healing workspace_onboarding husk/incomplete schema', {
				missing: missing.map((field) => field.name),
			});
			await pocketbaseClient.collections.update(onboarding.id, {
				fields: [...getFieldsArray(onboarding), ...missing],
				indexes,
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
			});
			clearCollectionSchemaCache('workspace_onboarding');
		}
	}

	const auditFields = [
		buildRelationField('workspace', workspaces.id, { required: true, cascadeDelete: true }),
		buildRelationField('actor', users.id),
		buildSelectField('action', [
			'created', 'updated', 'deleted', 'published', 'credits_used',
			'billing', 'role_change', 'invitation', 'ownership_transfer', 'login', 'other',
		]),
		buildTextField('resource_type', 80),
		buildTextField('resource_id', 64),
		buildTextField('title', 300),
		buildTextField('summary', 1000),
		buildJsonField('meta'),
		buildAutodateField('created', { onCreate: true, onUpdate: false }),
	];
	const auditIndexes = [
		'CREATE INDEX `idx_workspace_audit_ws_created` ON `workspace_audit` (`workspace`, `created`)',
		'CREATE INDEX `idx_workspace_audit_action` ON `workspace_audit` (`workspace`, `action`)',
	];

	let audit = await pocketbaseClient.collections.getOne('workspace_audit').catch(() => null);
	if (!audit) {
		logger.warn('Creating workspace_audit collection');
		await pocketbaseClient.collections.create({
			type: 'base',
			name: 'workspace_audit',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: auditFields,
			indexes: auditIndexes,
		}).catch((error) => logger.warn('workspace_audit create failed', { message: error?.message }));
		clearCollectionSchemaCache('workspace_audit');
	} else {
		const missing = auditFields.filter((field) => !hasField(audit, field.name));
		const indexes = Array.isArray(audit.indexes) ? [...audit.indexes] : [];
		for (const sql of auditIndexes) {
			const marker = sql.includes('action') ? 'idx_workspace_audit_action' : 'idx_workspace_audit_ws_created';
			if (!indexes.some((item) => String(item).includes(marker))) indexes.push(sql);
		}
		const indexesChanged = JSON.stringify(indexes) !== JSON.stringify(audit.indexes || []);
		if (missing.length || indexesChanged) {
			logger.warn('Healing workspace_audit husk/incomplete schema', {
				missing: missing.map((field) => field.name),
			});
			await pocketbaseClient.collections.update(audit.id, {
				fields: [...getFieldsArray(audit), ...missing],
				indexes,
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
			});
			clearCollectionSchemaCache('workspace_audit');
		}
	}
}
