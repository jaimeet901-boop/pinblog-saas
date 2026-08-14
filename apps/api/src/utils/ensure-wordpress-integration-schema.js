/**
 * Runtime ensure for WordPress Integration Foundation fields/collections.
 * Complements migration 1783989000 so production can self-heal schema drift.
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

function buildTextField(name, { required = false, max = 0 } = {}) {
	return {
		name,
		type: 'text',
		required,
		...(max ? { max } : {}),
	};
}

function buildNumberField(name) {
	return { name, type: 'number', min: 0 };
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
	return {
		name,
		type: 'select',
		maxSelect: 1,
		values,
	};
}

function buildUrlField(name) {
	return { name, type: 'url' };
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
	return {
		name,
		type: 'autodate',
		onCreate,
		onUpdate,
	};
}

async function ensureFields(pocketbaseClient, collectionName, requiredFields) {
	let collection = await pocketbaseClient.collections.getOne(collectionName);
	const missing = requiredFields.filter((field) => !hasField(collection, field.name));
	if (missing.length === 0) {
		return collection;
	}

	logger.warn('Adding missing WordPress integration fields', {
		collection: collectionName,
		missing: missing.map((field) => field.name),
	});

	collection = await pocketbaseClient.collections.update(collection.id, {
		fields: [...getFieldsArray(collection), ...missing],
	});
	clearCollectionSchemaCache(collectionName);
	return collection;
}

export async function ensureWordpressIntegrationSchema(pocketbaseClient) {
	const users = await pocketbaseClient.collections.getOne('users');
	const websites = await pocketbaseClient.collections.getOne('websites').catch(() => null);
	const sites = await pocketbaseClient.collections.getOne('wordpress_sites').catch(() => null);

	if (sites) {
		await ensureFields(pocketbaseClient, 'wordpress_sites', [
			buildJsonField('site_profile', 500000),
			buildJsonField('discovery', 2000000),
			buildTextField('language', { max: 32 }),
			buildTextField('timezone', { max: 120 }),
			buildTextField('permalink_structure', { max: 255 }),
			buildBoolField('https_validated'),
			buildDateField('last_discovered_at'),
			buildDateField('last_synced_at'),
			buildDateField('next_sync_at'),
			buildJsonField('sync_cursor', 100000),
			buildSelectField('sync_status', ['idle', 'running', 'success', 'failed', 'partial']),
			buildTextField('last_sync_error', { max: 3000 }),
			buildTextField('sync_claim_token', { max: 80 }),
			buildNumberField('sync_claim_version'),
		]);
	}

	const articles = await pocketbaseClient.collections.getOne('website_articles').catch(() => null);
	if (articles) {
		await ensureFields(pocketbaseClient, 'website_articles', [
			buildNumberField('wp_post_id'),
			buildTextField('excerpt', { max: 5000 }),
			buildTextField('content'),
			buildJsonField('categories', 100000),
			buildJsonField('tags', 100000),
			buildTextField('seo_title', { max: 500 }),
			buildTextField('seo_description', { max: 2000 }),
			buildNumberField('reading_time'),
			buildNumberField('word_count'),
			buildUrlField('canonical_url'),
			buildBoolField('featured'),
			buildTextField('wp_status', { max: 40 }),
			buildTextField('sync_hash', { max: 128 }),
			buildDateField('deleted_at'),
			buildTextField('author_id', { max: 80 }),
		]);
	}

	let syncRuns = await pocketbaseClient.collections.getOne('wordpress_sync_runs').catch(() => null);
	if (!syncRuns) {
		const fields = [
			buildRelationField('owner', users.id, { required: true, cascadeDelete: true }),
		];
		if (sites) fields.push(buildRelationField('site', sites.id, { cascadeDelete: true }));
		else fields.push(buildTextField('site_id', { max: 80 }));
		if (websites) fields.push(buildRelationField('website', websites.id, { cascadeDelete: false }));
		else fields.push(buildTextField('website_id', { max: 80 }));

		fields.push(
			buildSelectField('mode', ['full', 'incremental', 'manual', 'scheduled']),
			buildSelectField('status', ['running', 'success', 'failed', 'partial']),
			buildDateField('started_at'),
			buildDateField('finished_at'),
			buildNumberField('fetched'),
			buildNumberField('created'),
			buildNumberField('updated'),
			buildNumberField('deleted'),
			buildNumberField('unchanged'),
			buildTextField('error', { max: 4000 }),
			buildJsonField('summary', 500000),
			buildAutodateField('created', { onCreate: true, onUpdate: false }),
			buildAutodateField('updated', { onCreate: true, onUpdate: true }),
		);

		syncRuns = await pocketbaseClient.collections.create({
			name: 'wordpress_sync_runs',
			type: 'base',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields,
			indexes: [
				'CREATE INDEX `idx_wordpress_sync_runs_owner` ON `wordpress_sync_runs` (`owner`)',
				'CREATE INDEX `idx_wordpress_sync_runs_started` ON `wordpress_sync_runs` (`started_at`)',
			],
		});
	}

	// Phase 1 husk heal: wordpress_api_logs
	const apiLogFields = [
		buildRelationField('owner', users.id, { cascadeDelete: true }),
		buildTextField('workspace_key', { max: 120 }),
	];
	if (sites) apiLogFields.push(buildRelationField('site', sites.id, { cascadeDelete: true }));
	apiLogFields.push(
		buildTextField('site_id', { max: 80 }),
		buildTextField('job_id', { max: 80 }),
		buildTextField('method', { max: 20 }),
		buildTextField('path', { max: 1000 }),
		buildNumberField('status_code'),
		buildNumberField('duration_ms'),
		buildBoolField('ok'),
		buildTextField('error', { max: 4000 }),
		buildJsonField('request_meta', 100000),
		buildJsonField('response_meta', 200000),
		buildAutodateField('created', { onCreate: true, onUpdate: false }),
		buildAutodateField('updated', { onCreate: true, onUpdate: true }),
	);
	const apiLogIndexes = [
		'CREATE INDEX `idx_wordpress_api_logs_owner` ON `wordpress_api_logs` (`owner`)',
		'CREATE INDEX `idx_wordpress_api_logs_site` ON `wordpress_api_logs` (`site_id`)',
		'CREATE INDEX `idx_wordpress_api_logs_created` ON `wordpress_api_logs` (`created`)',
	];

	let apiLogs = await pocketbaseClient.collections.getOne('wordpress_api_logs').catch(() => null);
	if (!apiLogs) {
		apiLogs = await pocketbaseClient.collections.create({
			name: 'wordpress_api_logs',
			type: 'base',
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: apiLogFields,
			indexes: apiLogIndexes,
		}).catch((error) => {
			logger.warn('wordpress_api_logs create skipped', { message: error?.message || String(error) });
			return null;
		});
		if (apiLogs) clearCollectionSchemaCache('wordpress_api_logs');
	} else {
		const missing = apiLogFields.filter((field) => !hasField(apiLogs, field.name));
		const indexes = Array.isArray(apiLogs.indexes) ? [...apiLogs.indexes] : [];
		for (const sql of apiLogIndexes) {
			let marker = 'idx_wordpress_api_logs_created';
			if (sql.includes('_owner')) marker = 'idx_wordpress_api_logs_owner';
			else if (sql.includes('site_id')) marker = 'idx_wordpress_api_logs_site';
			if (!indexes.some((item) => String(item).includes(marker))) indexes.push(sql);
		}
		const indexesChanged = JSON.stringify(indexes) !== JSON.stringify(apiLogs.indexes || []);
		if (missing.length || indexesChanged) {
			logger.warn('Healing wordpress_api_logs husk/incomplete schema', {
				missing: missing.map((field) => field.name),
			});
			await pocketbaseClient.collections.update(apiLogs.id, {
				fields: [...getFieldsArray(apiLogs), ...missing],
				indexes,
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
			});
			clearCollectionSchemaCache('wordpress_api_logs');
		}
	}

	return {
		sitesReady: Boolean(sites),
		articlesReady: Boolean(articles),
		syncRunsId: syncRuns?.id || '',
		apiLogsReady: Boolean(apiLogs),
	};
}
