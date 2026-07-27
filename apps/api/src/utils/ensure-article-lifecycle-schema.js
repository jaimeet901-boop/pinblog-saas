/**
 * Runtime ensure for article lifecycle fields + activity history.
 */
import logger from './logger.js';
import { extractCollectionFieldNames, clearCollectionSchemaCache } from './pocketbase-safe-query.js';

const ARTICLE_LIFECYCLE_STATES = [
	'DISCOVERED',
	'SYNCED',
	'READY_FOR_AI',
	'AI_GENERATING',
	'AI_COMPLETED',
	'READY_FOR_PINS',
	'PINS_GENERATING',
	'PINS_READY',
	'READY_FOR_PUBLISH',
	'SCHEDULED',
	'PUBLISHED',
	'FAILED',
	'ARCHIVED',
];

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

function buildSelectField(name, values) {
	return { name, type: 'select', maxSelect: 1, values };
}

function buildTextField(name, max = 0) {
	return { name, type: 'text', ...(max ? { max } : {}) };
}

function buildNumberField(name) {
	return { name, type: 'number', min: 0 };
}

function buildDateField(name) {
	return { name, type: 'date' };
}

function buildJsonField(name, maxSize = 200000) {
	return { name, type: 'json', maxSize };
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
	let collection = await pocketbaseClient.collections.getOne(collectionName);
	const missing = requiredFields.filter((field) => !hasField(collection, field.name));
	if (!missing.length) return collection;

	logger.warn('Adding missing article lifecycle fields', {
		collection: collectionName,
		missing: missing.map((field) => field.name),
	});

	collection = await pocketbaseClient.collections.update(collection.id, {
		fields: [...getFieldsArray(collection), ...missing],
	});
	clearCollectionSchemaCache(collectionName);
	return collection;
}

export async function ensureArticleLifecycleSchema(pocketbaseClient) {
	const users = await pocketbaseClient.collections.getOne('users');
	const websites = await pocketbaseClient.collections.getOne('websites').catch(() => null);
	const articles = await pocketbaseClient.collections.getOne('website_articles').catch(() => null);

	if (articles) {
		await ensureFields(pocketbaseClient, 'website_articles', [
			buildSelectField('lifecycle_state', ARTICLE_LIFECYCLE_STATES),
			buildSelectField('lifecycle_previous_state', ARTICLE_LIFECYCLE_STATES),
			buildDateField('lifecycle_changed_at'),
			buildTextField('lifecycle_failure_reason', 4000),
			buildNumberField('lifecycle_retry_count'),
			buildNumberField('lifecycle_processing_ms'),
			buildDateField('ai_started_at'),
			buildDateField('ai_completed_at'),
			buildDateField('pins_started_at'),
			buildDateField('pins_ready_at'),
			buildDateField('publish_started_at'),
			buildDateField('published_at'),
			buildTextField('lifecycle_failed_stage', 64),
		]);
	}

	let history = await pocketbaseClient.collections.getOne('article_activity_history').catch(() => null);
	if (!history) {
		const fields = [
			buildRelationField('owner', users.id, { required: true, cascadeDelete: true }),
		];
		if (articles) fields.push(buildRelationField('article', articles.id, { required: true, cascadeDelete: true }));
		else fields.push(buildTextField('article_id', 80));
		if (websites) fields.push(buildRelationField('website', websites.id, { cascadeDelete: false }));
		else fields.push(buildTextField('website_id', 80));

		fields.push(
			buildTextField('event', 80),
			buildSelectField('from_state', ARTICLE_LIFECYCLE_STATES),
			buildSelectField('to_state', ARTICLE_LIFECYCLE_STATES),
			buildTextField('message', 2000),
			buildTextField('source', 80),
			buildJsonField('meta', 200000),
			buildDateField('occurred_at'),
			buildAutodateField('created', { onCreate: true, onUpdate: false }),
			buildAutodateField('updated', { onCreate: true, onUpdate: true }),
		);

		history = await pocketbaseClient.collections.create({
			name: 'article_activity_history',
			type: 'base',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields,
			indexes: [
				'CREATE INDEX `idx_article_activity_article` ON `article_activity_history` (`article`, `occurred_at`)',
				'CREATE INDEX `idx_article_activity_owner` ON `article_activity_history` (`owner`, `occurred_at`)',
			],
		});
	}

	return { articlesReady: Boolean(articles), historyId: history?.id || '' };
}
