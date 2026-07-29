/**
 * Runtime ensure for website soft-remove / permanent-delete fields.
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

export async function ensureWebsiteLifecycleSchema(pocketbaseClient) {
	let collection = await pocketbaseClient.collections.getOne('websites').catch(() => null);
	if (!collection) return null;

	let fields = getFieldsArray(collection).map((field) => ({ ...field }));
	let dirty = false;

	if (!hasField({ fields }, 'removed_at')) {
		fields.push({ name: 'removed_at', type: 'date' });
		dirty = true;
	}

	const lifecycle = fields.find((field) => field.name === 'lifecycle_state');
	const lifecycleValues = ['active', 'disconnected', 'purging'];
	if (!lifecycle) {
		fields.push({
			name: 'lifecycle_state',
			type: 'select',
			maxSelect: 1,
			values: lifecycleValues,
		});
		dirty = true;
	} else {
		const existing = Array.isArray(lifecycle.values) ? lifecycle.values : [];
		const merged = [...new Set([...existing, ...lifecycleValues])];
		if (merged.length !== existing.length) {
			fields = fields.map((field) => (
				field.name === 'lifecycle_state'
					? { ...field, values: merged }
					: field
			));
			dirty = true;
		}
	}

	if (!dirty) return collection;

	logger.warn('Updating websites lifecycle schema', {
		collection: 'websites',
		fields: ['removed_at', 'lifecycle_state'],
	});
	collection = await pocketbaseClient.collections.update(collection.id, { fields });
	clearCollectionSchemaCache('websites');
	return collection;
}
