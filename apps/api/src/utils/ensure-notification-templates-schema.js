/**
 * Runtime ensure for notification_templates (Admin console announcements).
 * Complements 1783970000 + Phase 1 husk repair 1786600000.
 */
import logger from './logger.js';
import { extractCollectionFieldNames, clearCollectionSchemaCache } from './pocketbase-safe-query.js';

function getFieldsArray(model) {
	if (Array.isArray(model?.fields)) return model.fields;
	if (Array.isArray(model?.schema)) return model.schema;
	return [];
}

function hasField(model, name) {
	return extractCollectionFieldNames(model).has(name);
}

function collectionHasIndexMarker(collection, marker) {
	const indexes = Array.isArray(collection?.indexes) ? collection.indexes : [];
	return indexes.some((sql) => String(sql).includes(marker));
}

function withIndex(collection, indexSql, marker) {
	if (collectionHasIndexMarker(collection, marker)) {
		return Array.isArray(collection.indexes) ? collection.indexes : [];
	}
	const indexes = Array.isArray(collection.indexes) ? [...collection.indexes] : [];
	if (!indexes.includes(indexSql)) indexes.push(indexSql);
	return indexes;
}

function notificationTemplateFields() {
	return [
		{ name: 'title', type: 'text', required: true, max: 300 },
		{ name: 'body', type: 'text', max: 4000 },
		{
			name: 'channel',
			type: 'select',
			required: true,
			maxSelect: 1,
			values: ['email', 'in-app', 'in_app'],
		},
		{
			name: 'status',
			type: 'select',
			required: true,
			maxSelect: 1,
			values: ['draft', 'scheduled', 'active'],
		},
		{ name: 'scheduled_at', type: 'date' },
		{ name: 'meta', type: 'json', maxSize: 100000 },
		{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
		{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
	];
}

const STATUS_INDEX =
	'CREATE INDEX `idx_notification_templates_status` ON `notification_templates` (`status`)';
const CHANNEL_INDEX =
	'CREATE INDEX `idx_notification_templates_channel` ON `notification_templates` (`channel`)';

export async function ensureNotificationTemplatesSchema(pocketbaseClient) {
	let collection = await pocketbaseClient.collections.getOne('notification_templates').catch(() => null);

	if (!collection) {
		logger.warn('Creating notification_templates collection');
		collection = await pocketbaseClient.collections.create({
			name: 'notification_templates',
			type: 'base',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: notificationTemplateFields(),
			indexes: [STATUS_INDEX, CHANNEL_INDEX],
		}).catch((error) => {
			logger.warn('notification_templates create skipped', { message: error?.message || String(error) });
			return null;
		});
		if (collection) clearCollectionSchemaCache('notification_templates');
		return { ready: Boolean(collection), id: collection?.id || '' };
	}

	const expected = notificationTemplateFields();
	const missing = expected.filter((field) => !hasField(collection, field.name));
	let indexes = withIndex(collection, STATUS_INDEX, 'idx_notification_templates_status');
	indexes = withIndex({ indexes }, CHANNEL_INDEX, 'idx_notification_templates_channel');
	const indexesChanged = JSON.stringify(indexes) !== JSON.stringify(collection.indexes || []);

	if (!missing.length && !indexesChanged) {
		return { ready: true, id: collection.id };
	}

	logger.warn('Healing notification_templates husk/incomplete schema', {
		missing: missing.map((field) => field.name),
	});

	collection = await pocketbaseClient.collections.update(collection.id, {
		fields: [...getFieldsArray(collection), ...missing],
		indexes,
		listRule: null,
		viewRule: null,
		createRule: null,
		updateRule: null,
		deleteRule: null,
	});
	clearCollectionSchemaCache('notification_templates');
	return { ready: true, id: collection.id };
}
