import logger from './logger.js';
import { extractCollectionFieldNames, clearCollectionSchemaCache } from './pocketbase-safe-query.js';

function fieldNames(model) {
	return extractCollectionFieldNames(model);
}

function buildTextField(name, { required = false, max = 0 } = {}) {
	return {
		name,
		type: 'text',
		required,
		...(max ? { max } : {}),
	};
}

function buildRelationField(name, collectionId, { required = false } = {}) {
	return {
		name,
		type: 'relation',
		required,
		maxSelect: 1,
		collectionId,
		cascadeDelete: true,
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

function buildDateField(name) {
	return {
		name,
		type: 'date',
	};
}

function buildAutodateField(name, { onCreate = true, onUpdate = false } = {}) {
	return {
		name,
		type: 'autodate',
		onCreate,
		onUpdate,
	};
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

/**
 * Ensure website_articles exists with the fields the scanner needs.
 * Compat gap-fill only — primary schema lives in PocketBase migrations
 * (1737465000, 1783989000, 1783995000). Uses superuser collections API so
 * older production volumes can self-heal. Rules must stay API-only (null).
 */
export async function ensureWebsiteArticlesSchema(pocketbaseClient) {
	const users = await pocketbaseClient.collections.getOne('users');
	const websites = await pocketbaseClient.collections.getOne('websites');

	let collection;
	try {
		collection = await pocketbaseClient.collections.getOne('website_articles');
	} catch (error) {
		logger.warn('website_articles collection missing; creating it', {
			message: error?.message || null,
			status: error?.status || null,
		});

		// Match 1783995000 workspace isolation: API-only (null) rules — not owner-scoped.
		collection = await pocketbaseClient.collections.create({
			name: 'website_articles',
			type: 'base',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				buildRelationField('websiteId', websites.id, { required: true }),
				buildRelationField('owner', users.id, { required: true }),
				buildTextField('url', { required: true, max: 1000 }),
				buildTextField('slug', { max: 255 }),
				buildTextField('title', { max: 500 }),
				buildTextField('meta_description', { max: 2000 }),
				buildTextField('featured_image', { max: 1000 }),
				buildDateField('publish_date'),
				buildDateField('last_modified_date'),
				buildTextField('category', { max: 255 }),
				buildTextField('author', { max: 255 }),
				buildTextField('language', { max: 32 }),
				buildSelectField('status', ['new', 'imported', 'published'], { required: true }),
				buildTextField('source', { max: 64 }),
				buildTextField('scan_run_id', { max: 64 }),
				buildAutodateField('created', { onCreate: true, onUpdate: false }),
				buildAutodateField('updated', { onCreate: true, onUpdate: true }),
			],
			indexes: [
				'CREATE UNIQUE INDEX `idx_website_articles_unique_url` ON `website_articles` (`websiteId`, `url`)',
				'CREATE INDEX `idx_website_articles_owner_website` ON `website_articles` (`owner`, `websiteId`)',
				'CREATE INDEX `idx_website_articles_status` ON `website_articles` (`status`)',
			],
		});
	}

	const requiredFields = [
		buildRelationField('websiteId', websites.id, { required: true }),
		buildRelationField('owner', users.id, { required: true }),
		buildTextField('url', { required: true, max: 1000 }),
		buildTextField('slug', { max: 255 }),
		buildTextField('title', { max: 500 }),
		buildTextField('meta_description', { max: 2000 }),
		buildTextField('featured_image', { max: 1000 }),
		buildDateField('publish_date'),
		buildDateField('last_modified_date'),
		buildTextField('category', { max: 255 }),
		buildTextField('author', { max: 255 }),
		buildTextField('language', { max: 32 }),
		buildSelectField('status', ['new', 'imported', 'published'], { required: true }),
		buildTextField('source', { max: 64 }),
		buildTextField('scan_run_id', { max: 64 }),
		{ name: 'wp_post_id', type: 'number', min: 0 },
		buildTextField('excerpt', { max: 5000 }),
		buildTextField('content'),
		{ name: 'categories', type: 'json', maxSize: 100000 },
		{ name: 'tags', type: 'json', maxSize: 100000 },
		buildTextField('seo_title', { max: 500 }),
		buildTextField('seo_description', { max: 2000 }),
		{ name: 'reading_time', type: 'number', min: 0 },
		{ name: 'word_count', type: 'number', min: 0 },
		{ name: 'canonical_url', type: 'url' },
		{ name: 'featured', type: 'bool' },
		buildTextField('wp_status', { max: 40 }),
		buildTextField('sync_hash', { max: 128 }),
		buildDateField('deleted_at'),
		buildTextField('author_id', { max: 80 }),
	];

	const missing = requiredFields.filter((field) => !hasField(collection, field.name));
	if (missing.length > 0) {
		const nextFields = [...getFieldsArray(collection), ...missing];
		logger.warn('Adding missing website_articles fields', {
			missing: missing.map((field) => field.name),
		});

		collection = await pocketbaseClient.collections.update(collection.id, {
			fields: nextFields,
		});
	}

	// Harden rules to API-only when an older ensure/create left owner-scoped rules.
	const rulesAreApiOnly = [
		collection.listRule,
		collection.viewRule,
		collection.createRule,
		collection.updateRule,
		collection.deleteRule,
	].every((rule) => rule == null);
	if (!rulesAreApiOnly) {
		logger.warn('Hardening website_articles to API-only rules (compat with 1783995000)');
		collection = await pocketbaseClient.collections.update(collection.id, {
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
		});
	}

	const fields = fieldNames(collection);
	const websiteField = ['websiteId', 'website_id', 'website', 'siteId'].find((name) => fields.has(name)) || 'websiteId';
	const statusField = ['status', 'article_status', 'state'].find((name) => fields.has(name)) || 'status';

	if (!fields.has(websiteField)) {
		throw new Error('website_articles is missing a website relation field (expected websiteId). Check PocketBase schema.');
	}

	clearCollectionSchemaCache('website_articles');

	logger.info('website_articles schema ready', {
		collectionId: collection.id,
		websiteField,
		statusField,
		fieldCount: fields.size,
		fields: [...fields],
	});

	return {
		collection,
		fields,
		websiteField,
		statusField,
	};
}
