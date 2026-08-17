import logger from './logger.js';
import { extractCollectionFieldNames, clearCollectionSchemaCache } from './pocketbase-safe-query.js';

function fieldNames(model) {
	return extractCollectionFieldNames(model);
}

function hasField(model, name) {
	return fieldNames(model).has(name);
}

function getFieldsArray(model) {
	if (Array.isArray(model?.fields)) {
		return model.fields;
	}
	if (Array.isArray(model?.schema)) {
		return model.schema;
	}
	return [];
}

function buildTextField(name, { max = 0 } = {}) {
	return {
		name,
		type: 'text',
		required: false,
		...(max ? { max } : {}),
	};
}

function buildSelectField(name, values, { required = false } = {}) {
	return {
		name,
		type: 'select',
		required,
		maxSelect: 1,
		values,
	};
}

/**
 * Ensure ai_pins has source_url + image_origin used for Pinterest destination links,
 * plus nullable studio channel (AI-CROSS-02 Phase 1). Does not backfill rows.
 * Production may lag behind migrations; self-heal via superuser collections API.
 */
export async function ensureAiPinsPublishFields(pocketbaseClient) {
	const collection = await pocketbaseClient.collections.getOne('ai_pins');
	const requiredFields = [
		buildTextField('source_url', { max: 2000 }),
		buildTextField('image_origin', { max: 32 }),
		buildSelectField('channel', ['pinterest', 'facebook'], { required: false }),
	];

	const missing = requiredFields.filter((field) => !hasField(collection, field.name));
	if (missing.length > 0) {
		const nextFields = [...getFieldsArray(collection), ...missing];
		logger.warn('Adding missing ai_pins publish fields', {
			missing: missing.map((field) => field.name),
		});
		await pocketbaseClient.collections.update(collection.id, {
			fields: nextFields,
		});
	}

	clearCollectionSchemaCache('ai_pins');

	const refreshed = await pocketbaseClient.collections.getOne('ai_pins');
	const fields = fieldNames(refreshed);
	if (!fields.has('source_url')) {
		throw new Error('ai_pins.source_url is missing after schema ensure');
	}
	if (!fields.has('channel')) {
		throw new Error('ai_pins.channel is missing after schema ensure');
	}

	logger.info('ai_pins publish fields ready', {
		collectionId: refreshed.id,
		hasSourceUrl: fields.has('source_url'),
		hasImageOrigin: fields.has('image_origin'),
		hasChannel: fields.has('channel'),
	});

	return {
		collection: refreshed,
		fields,
	};
}
