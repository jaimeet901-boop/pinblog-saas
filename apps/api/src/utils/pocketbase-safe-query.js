import pocketbaseClient from './pocketbaseClient.js';
import logger from './logger.js';

const SCHEMA_CACHE_TTL_MS = 60 * 1000;

const FALLBACK_SCHEMA_FIELDS = {
	ai_pin_image_jobs: new Set([
		'id',
		'owner',
		'ai_pin',
		'websiteId',
		'articleId',
		'client_token',
		'source_type',
		'image_mode',
		'prompt',
		'prompt_payload',
		'featured_image_url',
		'image_url',
		'status',
		'attempt_count',
		'max_attempts',
		'next_retry_at',
		'last_error',
		'completed_at',
		'created',
		'updated',
	]),
	pinterest_publish_jobs: new Set([
		'id',
		'owner',
		'ai_pin',
		'account',
		'account_label',
		'account_username',
		'websiteId',
		'articleId',
		'board_id',
		'board_name',
		'scheduled_at',
		'timezone',
		'status',
		'attempt_count',
		'max_attempts',
		'next_retry_at',
		'last_error',
		'pinterest_pin_id',
		'pinterest_pin_url',
		'published_at',
		'performance',
		'claim_token',
		'claim_version',
		'analytics_synced_at',
		'created',
		'updated',
	]),
	websites: new Set([
		'id',
		'owner',
		'name',
		'url',
		'domain',
		'favicon',
		'wp_username',
		'wp_app_password',
		'status',
		'discovery_status',
		'last_scan_at',
		'next_scan_at',
		'last_scan_summary',
		'created',
		'updated',
	]),
	website_articles: new Set([
		'id',
		'websiteId',
		'owner',
		'url',
		'slug',
		'title',
		'meta_description',
		'featured_image',
		'publish_date',
		'last_modified_date',
		'category',
		'author',
		'language',
		'status',
		'source',
		'scan_run_id',
		'created',
		'updated',
	]),
};

const schemaCache = new Map();

function getCachedSchema(collection) {
	const cached = schemaCache.get(collection);
	if (!cached) {
		return null;
	}

	if (cached.expiresAt <= Date.now()) {
		schemaCache.delete(collection);
		return null;
	}

	return cached.fields;
}

function setCachedSchema(collection, fields) {
	schemaCache.set(collection, {
		fields,
		expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS,
	});
}

export function clearCollectionSchemaCache(collection) {
	if (collection) {
		schemaCache.delete(collection);
		return;
	}
	schemaCache.clear();
}

function buildQueryUrl({ collection, page, perPage, filter = '', sort = '', expand = '' }) {
	const pbBaseUrl = process.env.PB_BASE_URL || 'http://localhost:8090';
	const params = new URLSearchParams();

	if (page) {
		params.set('page', String(page));
	}
	if (perPage) {
		params.set('perPage', String(perPage));
	}
	if (filter) {
		params.set('filter', filter);
	}
	if (sort) {
		params.set('sort', sort);
	}
	if (expand) {
		params.set('expand', expand);
	}

	const query = params.toString();
	return `${pbBaseUrl}/api/collections/${collection}/records${query ? `?${query}` : ''}`;
}

function parseSortFields(sort) {
	if (!sort) {
		return [];
	}

	return sort
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
		.map((item) => (item.startsWith('-') ? item.slice(1) : item));
}

function filterSortBySchema(sort, schemaFields) {
	if (!sort) {
		return '';
	}

	const parts = sort.split(',').map((part) => part.trim()).filter(Boolean);
	const valid = parts.filter((part) => {
		const field = part.startsWith('-') ? part.slice(1) : part;
		return schemaFields.has(field);
	});

	return valid.join(',');
}

function normalizePbError(error) {
	return {
		status: error?.status,
		message: error?.message,
		responseBody: error?.response?.data || error?.response || null,
	};
}

export function extractCollectionFieldNames(model) {
	const rawFields = model?.fields || model?.schema || [];
	return new Set(
		(Array.isArray(rawFields) ? rawFields : [])
			.map((field) => field?.name)
			.filter(Boolean),
	);
}

export async function getCollectionSchemaFields(collection) {
	const cached = getCachedSchema(collection);
	if (cached) {
		return cached;
	}

	try {
		const model = await pocketbaseClient.collections.getOne(collection);
		const fields = extractCollectionFieldNames(model);
		if (fields.size > 0) {
			setCachedSchema(collection, fields);
			return fields;
		}
	} catch (error) {
		const details = normalizePbError(error);
		logger.warn('PocketBase schema lookup failed, using fallback schema fields', {
			collection,
			...details,
		});
	}

	const fallback = new Set(FALLBACK_SCHEMA_FIELDS[collection] || []);
	setCachedSchema(collection, fallback);
	return fallback;
}

export async function verifyCollectionFields({ collection, requiredFields, context }) {
	const fields = await getCollectionSchemaFields(collection);
	const missing = requiredFields.filter((field) => !fields.has(field));

	logger.info('PocketBase schema verification', {
		context,
		collection,
		requiredFields,
		missingFields: missing,
	});

	return { fields, missing };
}

export async function buildSchemaSafeFilter({ collection, context, parts }) {
	const fields = await getCollectionSchemaFields(collection);
	const validParts = [];
	const droppedFields = [];

	for (const part of parts || []) {
		if (!part?.expression) {
			continue;
		}

		if (part.field && !fields.has(part.field)) {
			droppedFields.push(part.field);
			continue;
		}

		validParts.push(part.expression);
	}

	const filter = validParts.join(' && ');
	logger.info('PocketBase filter prepared', {
		context,
		collection,
		filter,
		droppedFields,
	});

	return { filter, fields, droppedFields };
}

export async function sanitizeCollectionPayload({ collection, payload, context, requiredKeys = [] }) {
	const fields = await getCollectionSchemaFields(collection);
	const sanitized = {};
	const dropped = [];

	for (const [key, value] of Object.entries(payload || {})) {
		if (fields.has(key)) {
			sanitized[key] = value;
		} else {
			dropped.push(key);
		}
	}

	// Never strip caller-required keys (e.g. website relation / owner) even when
	// schema introspection is incomplete — PocketBase will validate them.
	for (const key of requiredKeys) {
		if (Object.prototype.hasOwnProperty.call(payload || {}, key) && sanitized[key] === undefined) {
			sanitized[key] = payload[key];
		}
	}

	if (dropped.length > 0) {
		logger.warn('PocketBase payload fields dropped because they are not in schema', {
			context,
			collection,
			droppedFields: dropped,
			restoredRequiredKeys: requiredKeys.filter((key) => Object.prototype.hasOwnProperty.call(sanitized, key)),
		});
	}

	return sanitized;
}

async function executeGetFullList({ collection, context, filter, sort, expand }) {
	const requestUrl = buildQueryUrl({ collection, page: 1, perPage: 500, filter, sort, expand });
	logger.info('PocketBase query execution', {
		context,
		collection,
		filter,
		sort,
		expand,
		requestUrl,
	});

	return pocketbaseClient.collection(collection).getFullList({
		...(filter ? { filter } : {}),
		...(sort ? { sort } : {}),
		...(expand ? { expand } : {}),
	});
}

export async function safeGetFullList({ collection, context, filter = '', sort = '', expand = '' }) {
	const fields = await getCollectionSchemaFields(collection);
	const safeSort = filterSortBySchema(sort, fields);

	try {
		return await executeGetFullList({ collection, context, filter, sort: safeSort, expand });
	} catch (error) {
		const details = normalizePbError(error);
		logger.error('PocketBase getFullList failed', {
			context,
			collection,
			filter,
			sort: safeSort,
			expand,
			requestUrl: buildQueryUrl({ collection, page: 1, perPage: 500, filter, sort: safeSort, expand }),
			...details,
		});

		// Any filtered query failure should soft-fallback so list UIs stay available.
		if (filter) {
			try {
				return await executeGetFullList({
					collection,
					context: `${context}:fallback-no-filter`,
					filter: '',
					sort: safeSort,
					expand,
				});
			} catch (fallbackError) {
				const fallbackDetails = normalizePbError(fallbackError);
				logger.error('PocketBase fallback getFullList failed', {
					context,
					collection,
					requestUrl: buildQueryUrl({ collection, page: 1, perPage: 500, filter: '', sort: safeSort, expand }),
					...fallbackDetails,
				});
			}
		}

		return [];
	}
}

export async function safeGetList({ collection, context, page, perPage, filter = '', sort = '', expand = '' }) {
	const fields = await getCollectionSchemaFields(collection);
	const safeSort = filterSortBySchema(sort, fields);
	const requestUrl = buildQueryUrl({ collection, page, perPage, filter, sort: safeSort, expand });
	logger.info('PocketBase query execution', {
		context,
		collection,
		filter,
		sort: safeSort,
		expand,
		requestUrl,
	});

	try {
		return await pocketbaseClient.collection(collection).getList(page, perPage, {
			...(filter ? { filter } : {}),
			...(safeSort ? { sort: safeSort } : {}),
			...(expand ? { expand } : {}),
		});
	} catch (error) {
		const details = normalizePbError(error);
		logger.error('PocketBase getList failed', {
			context,
			collection,
			filter,
			sort: safeSort,
			expand,
			requestUrl,
			...details,
		});

		if (details.status === 400) {
			try {
				return await pocketbaseClient.collection(collection).getList(page, perPage, {
					...(safeSort ? { sort: safeSort } : {}),
					...(expand ? { expand } : {}),
				});
			} catch (fallbackError) {
				const fallbackDetails = normalizePbError(fallbackError);
				logger.error('PocketBase fallback getList failed', {
					context,
					collection,
					requestUrl: buildQueryUrl({ collection, page, perPage, filter: '', sort: safeSort, expand }),
					...fallbackDetails,
				});
			}
		}

		return {
			page,
			perPage,
			totalItems: 0,
			totalPages: 0,
			items: [],
		};
	}
}

export async function safeGetFirstListItem({ collection, context, filter = '' }) {
	const requestUrl = buildQueryUrl({ collection, page: 1, perPage: 1, filter });
	logger.info('PocketBase query execution', {
		context,
		collection,
		filter,
		sort: '',
		expand: '',
		requestUrl,
	});

	try {
		return await pocketbaseClient.collection(collection).getFirstListItem(filter);
	} catch (error) {
		const details = normalizePbError(error);
		logger.error('PocketBase getFirstListItem failed', {
			context,
			collection,
			filter,
			requestUrl,
			...details,
		});

		if (details.status === 400) {
			const fallbackList = await safeGetList({
				collection,
				context: `${context}:fallback-list`,
				page: 1,
				perPage: 1,
				sort: '-created',
			});
			return fallbackList.items[0] || null;
		}

		return null;
	}
}

export { parseSortFields };
