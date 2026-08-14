import logger from './logger.js';
import { clearCollectionSchemaCache, extractCollectionFieldNames } from './pocketbase-safe-query.js';

const SLUGS = ['privacy', 'terms', 'cookies', 'disclaimer', 'refund'];

const LEGAL_PAGES_STATUS_INDEX =
	'CREATE INDEX `idx_legal_pages_status` ON `legal_pages` (`status`)';
const LEGAL_PAGES_SLUG_UNIQUE =
	'CREATE UNIQUE INDEX `idx_legal_pages_slug` ON `legal_pages` (`slug`)';
const LEGAL_VERSIONS_PAGE_INDEX =
	'CREATE INDEX `idx_legal_page_versions_page` ON `legal_page_versions` (`page`)';
const LEGAL_VERSIONS_SLUG_VER_UNIQUE =
	'CREATE UNIQUE INDEX `idx_legal_page_versions_slug_ver` ON `legal_page_versions` (`slug`, `version`)';

let ensurePromise = null;

function isMissingCollectionError(error) {
	const message = String(error?.message || error?.data?.message || '').toLowerCase();
	const status = Number(error?.status || error?.response?.status || 0);
	return status === 404
		|| message.includes('missing or invalid collection')
		|| message.includes('collection context')
		|| message.includes("wasn't found")
		|| message.includes('not found');
}

async function getCollectionOrNull(pocketbaseClient, name) {
	try {
		return await pocketbaseClient.collections.getOne(name);
	} catch (error) {
		if (isMissingCollectionError(error)) {
			return null;
		}
		throw error;
	}
}

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

function legalPagesFields() {
	return [
		{
			name: 'slug',
			type: 'select',
			required: true,
			maxSelect: 1,
			values: SLUGS,
		},
		{ name: 'title', type: 'text', required: true, max: 300 },
		{ name: 'seo_title', type: 'text', required: false, max: 300 },
		{ name: 'meta_description', type: 'text', required: false, max: 600 },
		{ name: 'content', type: 'text', required: true, max: 200000 },
		{
			name: 'status',
			type: 'select',
			required: true,
			maxSelect: 1,
			values: ['draft', 'published'],
		},
		{ name: 'version', type: 'number', required: true, min: 1 },
		{ name: 'updated_by', type: 'text', required: false, max: 200 },
		{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
		{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
	];
}

function legalPageVersionsFields(legalPagesCollectionId) {
	return [
		{
			name: 'page',
			type: 'relation',
			required: true,
			maxSelect: 1,
			collectionId: legalPagesCollectionId,
			cascadeDelete: true,
		},
		{
			name: 'slug',
			type: 'select',
			required: true,
			maxSelect: 1,
			values: SLUGS,
		},
		{ name: 'version', type: 'number', required: true, min: 1 },
		{ name: 'title', type: 'text', required: true, max: 300 },
		{ name: 'seo_title', type: 'text', required: false, max: 300 },
		{ name: 'meta_description', type: 'text', required: false, max: 600 },
		{ name: 'content', type: 'text', required: true, max: 200000 },
		{
			name: 'status',
			type: 'select',
			required: true,
			maxSelect: 1,
			values: ['draft', 'published'],
		},
		{ name: 'updated_by', type: 'text', required: false, max: 200 },
		{ name: 'snapshot_at', type: 'date', required: false },
		{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
		{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
	];
}

/**
 * UNIQUE slug gate — mirrors migration 1786600000.
 * Skip UNIQUE when 2+ blank slug values would collide as "".
 */
async function canAddLegalPagesSlugUnique(pocketbaseClient) {
	try {
		const rows = await pocketbaseClient.collection('legal_pages').getFullList({
			fields: 'id,slug',
			requestKey: null,
		});
		if (!rows.length) return true;
		const seen = new Set();
		let blanks = 0;
		for (const row of rows) {
			const slug = String(row.slug || '').trim();
			if (!slug) {
				blanks += 1;
				continue;
			}
			if (seen.has(slug)) return false;
			seen.add(slug);
		}
		return blanks <= 1;
	} catch {
		// Collection unreadable / husk — treat as unsafe for UNIQUE until fields exist + recount
		return false;
	}
}

async function canAddLegalVersionsSlugVerUnique(pocketbaseClient) {
	try {
		const rows = await pocketbaseClient.collection('legal_page_versions').getFullList({
			fields: 'id,slug,version',
			requestKey: null,
		});
		if (!rows.length) return true;
		const seen = new Set();
		let blanks = 0;
		for (const row of rows) {
			const slug = String(row.slug || '').trim();
			const version = row.version == null ? '' : String(row.version);
			if (!slug && !version) {
				blanks += 1;
				continue;
			}
			const key = `${slug}::${version}`;
			if (seen.has(key)) return false;
			seen.add(key);
		}
		return blanks <= 1;
	} catch {
		return false;
	}
}

async function healLegalPagesCollection(pocketbaseClient, pages) {
	const expected = legalPagesFields();
	const missing = expected.filter((field) => !hasField(pages, field.name));
	let indexes = withIndex(pages, LEGAL_PAGES_STATUS_INDEX, 'idx_legal_pages_status');
	const allowUnique = await canAddLegalPagesSlugUnique(pocketbaseClient);
	if (allowUnique) {
		indexes = (() => {
			const next = { indexes };
			const fake = { indexes: next.indexes };
			return withIndex(fake, LEGAL_PAGES_SLUG_UNIQUE, 'idx_legal_pages_slug');
		})();
	}

	const indexesChanged = JSON.stringify(indexes) !== JSON.stringify(pages.indexes || []);
	if (!missing.length && !indexesChanged) return pages;

	logger.warn('[legal-pages] healing husk/incomplete legal_pages schema', {
		missing: missing.map((field) => field.name),
		uniqueSlug: allowUnique,
	});

	const updated = await pocketbaseClient.collections.update(pages.id, {
		fields: [...getFieldsArray(pages), ...missing],
		indexes,
		listRule: null,
		viewRule: null,
		createRule: null,
		updateRule: null,
		deleteRule: null,
	});
	clearCollectionSchemaCache('legal_pages');
	return updated;
}

async function healLegalPageVersionsCollection(pocketbaseClient, versions, pagesId) {
	const expected = legalPageVersionsFields(pagesId);
	const missing = expected.filter((field) => !hasField(versions, field.name));
	let indexes = withIndex(versions, LEGAL_VERSIONS_PAGE_INDEX, 'idx_legal_page_versions_page');
	const allowUnique = await canAddLegalVersionsSlugVerUnique(pocketbaseClient);
	if (allowUnique) {
		const fake = { indexes };
		indexes = withIndex(fake, LEGAL_VERSIONS_SLUG_VER_UNIQUE, 'idx_legal_page_versions_slug_ver');
	}

	const indexesChanged = JSON.stringify(indexes) !== JSON.stringify(versions.indexes || []);
	if (!missing.length && !indexesChanged) return versions;

	logger.warn('[legal-pages] healing husk/incomplete legal_page_versions schema', {
		missing: missing.map((field) => field.name),
		uniqueSlugVer: allowUnique,
	});

	const updated = await pocketbaseClient.collections.update(versions.id, {
		fields: [...getFieldsArray(versions), ...missing],
		indexes,
		listRule: null,
		viewRule: null,
		createRule: null,
		updateRule: null,
		deleteRule: null,
	});
	clearCollectionSchemaCache('legal_page_versions');
	return updated;
}

/**
 * Production may lag behind migrations. Self-heal legal CMS collections via
 * the PocketBase superuser collections API (create if missing, heal husks).
 */
export async function ensureLegalPagesSchema(pocketbaseClient) {
	if (!ensurePromise) {
		ensurePromise = (async () => {
			let pages = await getCollectionOrNull(pocketbaseClient, 'legal_pages');
			if (!pages) {
				logger.warn('[legal-pages] creating missing legal_pages collection');
				pages = await pocketbaseClient.collections.create({
					name: 'legal_pages',
					type: 'base',
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					indexes: [
						LEGAL_PAGES_STATUS_INDEX,
						// UNIQUE deferred until rows are safe — status-only on create of empty collection is fine;
						// empty collection can take UNIQUE immediately:
						LEGAL_PAGES_SLUG_UNIQUE,
					],
					fields: legalPagesFields(),
				});
				logger.info('[legal-pages] legal_pages collection created', { id: pages.id });
			} else {
				pages = await healLegalPagesCollection(pocketbaseClient, pages);
			}

			let versions = await getCollectionOrNull(pocketbaseClient, 'legal_page_versions');
			if (!versions) {
				logger.warn('[legal-pages] creating missing legal_page_versions collection');
				versions = await pocketbaseClient.collections.create({
					name: 'legal_page_versions',
					type: 'base',
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					indexes: [
						LEGAL_VERSIONS_PAGE_INDEX,
						LEGAL_VERSIONS_SLUG_VER_UNIQUE,
					],
					fields: legalPageVersionsFields(pages.id),
				});
				logger.info('[legal-pages] legal_page_versions collection created', { id: versions.id });
			} else {
				versions = await healLegalPageVersionsCollection(pocketbaseClient, versions, pages.id);
			}

			clearCollectionSchemaCache('legal_pages');
			clearCollectionSchemaCache('legal_page_versions');

			return { pages, versions };
		})().catch((error) => {
			ensurePromise = null;
			throw error;
		});
	}

	return ensurePromise;
}
