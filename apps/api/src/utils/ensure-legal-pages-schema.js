import logger from './logger.js';
import { clearCollectionSchemaCache } from './pocketbase-safe-query.js';

const SLUGS = ['privacy', 'terms', 'cookies', 'disclaimer', 'refund'];

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
 * Production may lag behind migrations. Self-heal legal CMS collections via
 * the PocketBase superuser collections API.
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
						'CREATE UNIQUE INDEX `idx_legal_pages_slug` ON `legal_pages` (`slug`)',
						'CREATE INDEX `idx_legal_pages_status` ON `legal_pages` (`status`)',
					],
					fields: legalPagesFields(),
				});
				logger.info('[legal-pages] legal_pages collection created', { id: pages.id });
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
						'CREATE INDEX `idx_legal_page_versions_page` ON `legal_page_versions` (`page`)',
						'CREATE UNIQUE INDEX `idx_legal_page_versions_slug_ver` ON `legal_page_versions` (`slug`, `version`)',
					],
					fields: legalPageVersionsFields(pages.id),
				});
				logger.info('[legal-pages] legal_page_versions collection created', { id: versions.id });
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
