/**
 * WordPress article synchronization engine for Chef IA.
 *
 * Modes:
 * - full: fetch all posts, upsert, soft-delete missing
 * - incremental: fetch posts modified after sync_cursor.modifiedAfter
 * - manual: same as full (explicit operator trigger)
 * - scheduled: incremental when cursor exists, otherwise full
 *
 * Dedupes by wordpress post id (preferred) and permalink/url.
 * Only writes changed content (sync_hash comparison).
 */
import crypto from 'crypto';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { ensureWebsiteArticlesSchema } from '../utils/ensure-website-articles-schema.js';
import { ensureWordpressIntegrationSchema } from '../utils/ensure-wordpress-integration-schema.js';
import {
	assertWordpressHttps,
	listWordpressPostsRaw,
	mapWordpressPostFull,
	getWordpressMedia,
} from './wordpress-client.js';
import { resolvePublishSite, mapWordpressSite } from './wordpress-sites.js';
import { markArticleSynced } from './article-lifecycle.js';
import logger from '../utils/logger.js';

const DEFAULT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_PAGES = 50;

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function logContextFor(ownerId, site, jobId = '') {
	return {
		ownerId,
		workspaceKey: site?.workspace_key || ownerId,
		siteId: site?.id || '',
		jobId,
	};
}

function normalizeMode(value) {
	const mode = String(value || 'manual').toLowerCase();
	if (['full', 'incremental', 'manual', 'scheduled'].includes(mode)) return mode;
	return 'manual';
}

function nextSyncAt(from = new Date(), intervalMs = DEFAULT_SYNC_INTERVAL_MS) {
	return new Date(from.getTime() + intervalMs).toISOString();
}

function stripHtml(value) {
	return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function featuredImageFromEmbedded(item) {
	const media = item?._embedded?.['wp:featuredmedia']?.[0];
	return media?.source_url || media?.media_details?.sizes?.large?.source_url || '';
}

function categoryNamesFromEmbedded(item) {
	const terms = item?._embedded?.['wp:term'] || [];
	const flat = terms.flat().filter(Boolean);
	return flat
		.filter((term) => term.taxonomy === 'category')
		.map((term) => term.name)
		.filter(Boolean);
}

function tagNamesFromEmbedded(item) {
	const terms = item?._embedded?.['wp:term'] || [];
	const flat = terms.flat().filter(Boolean);
	return flat
		.filter((term) => term.taxonomy === 'post_tag')
		.map((term) => term.name)
		.filter(Boolean);
}

function authorNameFromEmbedded(item) {
	const author = item?._embedded?.author?.[0];
	return author?.name || '';
}

async function resolveFeaturedImage(client, item, cache) {
	const embedded = featuredImageFromEmbedded(item);
	if (embedded) return embedded;
	const mediaId = Number(item.featured_media) || 0;
	if (!mediaId) return '';
	if (cache.has(mediaId)) return cache.get(mediaId);
	try {
		const media = await getWordpressMedia({ ...client, mediaId });
		const url = media.sourceUrl || '';
		cache.set(mediaId, url);
		return url;
	} catch {
		cache.set(mediaId, '');
		return '';
	}
}

async function findExistingArticle({ websiteId, websiteField, wpPostId, permalink }) {
	if (wpPostId) {
		const byWpId = await pocketbaseClient.collection('website_articles').getFirstListItem(
			pocketbaseClient.filter(`${websiteField} = {:websiteId} && wp_post_id = {:wpPostId}`, {
				websiteId,
				wpPostId,
			}),
			{ requestKey: null },
		).catch(() => null);
		if (byWpId) return byWpId;
	}

	if (permalink) {
		const byUrl = await pocketbaseClient.collection('website_articles').getFirstListItem(
			pocketbaseClient.filter(`${websiteField} = {:websiteId} && url = {:url}`, {
				websiteId,
				url: permalink,
			}),
			{ requestKey: null },
		).catch(() => null);
		if (byUrl) return byUrl;
	}

	return null;
}

function buildArticlePayload({
	mapped,
	websiteId,
	ownerId,
	websiteField,
	statusField,
	existingStatus,
}) {
	const payload = {
		[websiteField]: websiteId,
		owner: ownerId,
		url: mapped.permalink || mapped.slug || `wp://${mapped.wpPostId}`,
		slug: mapped.slug,
		title: mapped.title || mapped.slug || `Post ${mapped.wpPostId}`,
		meta_description: mapped.seoDescription || mapped.excerpt || '',
		featured_image: mapped.featuredImage || '',
		category: mapped.categories?.[0] || '',
		author: mapped.author || '',
		language: mapped.language || '',
		source: 'wordpress_sync',
		wp_post_id: mapped.wpPostId || 0,
		excerpt: mapped.excerpt || '',
		content: mapped.content || '',
		categories: mapped.categories || [],
		tags: mapped.tags || [],
		seo_title: mapped.seoTitle || mapped.title || '',
		seo_description: mapped.seoDescription || mapped.excerpt || '',
		reading_time: mapped.readingTime || 0,
		word_count: mapped.wordCount || 0,
		canonical_url: mapped.canonicalUrl || mapped.permalink || '',
		featured: Boolean(mapped.featured),
		wp_status: mapped.status || '',
		sync_hash: mapped.syncHash || '',
		author_id: mapped.authorId || '',
	};

	if (mapped.publishDate) payload.publish_date = mapped.publishDate;
	if (mapped.modifiedDate) payload.last_modified_date = mapped.modifiedDate;

	// Keep local workflow status when already processed; otherwise mark imported from WP.
	if (existingStatus && ['published', 'imported'].includes(existingStatus)) {
		payload[statusField] = existingStatus;
	} else if (mapped.status === 'publish') {
		payload[statusField] = 'imported';
	} else {
		payload[statusField] = existingStatus || 'new';
	}

	return payload;
}

async function createSyncRun({ ownerId, site, websiteId, mode }) {
	await ensureWordpressIntegrationSchema(pocketbaseClient);
	return pocketbaseClient.collection('wordpress_sync_runs').create({
		owner: ownerId,
		site: site.id,
		website: websiteId || site.website || '',
		mode,
		status: 'running',
		started_at: new Date().toISOString(),
		fetched: 0,
		created: 0,
		updated: 0,
		deleted: 0,
		unchanged: 0,
		error: '',
		summary: {},
	}).catch(() => null);
}

async function finishSyncRun(run, patch) {
	if (!run?.id) return null;
	return pocketbaseClient.collection('wordpress_sync_runs').update(run.id, {
		...patch,
		finished_at: new Date().toISOString(),
	}).catch(() => null);
}

async function listLocalWpArticles(websiteId, websiteField) {
	const items = [];
	for (let page = 1; page <= 50; page += 1) {
		const result = await pocketbaseClient.collection('website_articles').getList(page, 200, {
			filter: pocketbaseClient.filter(`${websiteField} = {:websiteId} && wp_post_id > 0`, { websiteId }),
			fields: 'id,wp_post_id,url,sync_hash,deleted_at,status',
			requestKey: null,
		}).catch(() => ({ items: [], totalPages: page }));
		items.push(...(result.items || []));
		if (page >= (result.totalPages || page)) break;
	}
	return items;
}

/**
 * Synchronize WordPress posts into website_articles.
 */
export async function syncOwnedWordpressSite(ownerId, siteId, {
	mode: rawMode = 'manual',
	maxPages = MAX_PAGES,
} = {}) {
	await ensureWordpressIntegrationSchema(pocketbaseClient);
	const articlesSchema = await ensureWebsiteArticlesSchema(pocketbaseClient);
	const websiteField = articlesSchema.websiteField;
	const statusField = articlesSchema.statusField;

	const { site, username, appPassword, authType } = await resolvePublishSite({ ownerId, siteId });
	assertWordpressHttps(site.url);

	const websiteId = site.website || site.website_id || '';
	if (!websiteId) {
		throw httpError(422, 'WordPress site is not linked to a website record', 'WP_WEBSITE_MISSING');
	}

	let mode = normalizeMode(rawMode);
	const cursor = site.sync_cursor && typeof site.sync_cursor === 'object' ? site.sync_cursor : {};
	if (mode === 'scheduled') {
		mode = cursor.modifiedAfter ? 'incremental' : 'full';
	}
	if (mode === 'manual') {
		// Manual defaults to full sync for correctness.
		mode = 'full';
	}

	const client = {
		url: site.url,
		username,
		appPassword,
		authType,
		logContext: logContextFor(ownerId, site),
	};

	const run = await createSyncRun({ ownerId, site, websiteId, mode });

	await pocketbaseClient.collection('wordpress_sites').update(site.id, {
		sync_status: 'running',
		last_sync_error: '',
	}).catch(() => null);

	const stats = {
		fetched: 0,
		created: 0,
		updated: 0,
		deleted: 0,
		unchanged: 0,
		errors: [],
	};

	const seenWpIds = new Set();
	const mediaCache = new Map();
	let newestModified = cursor.modifiedAfter || '';

	try {
		const modifiedAfter = mode === 'incremental' && cursor.modifiedAfter
			? cursor.modifiedAfter
			: '';

		for (let page = 1; page <= maxPages; page += 1) {
			const batch = await listWordpressPostsRaw({
				...client,
				page,
				perPage: 50,
				modifiedAfter: modifiedAfter || undefined,
				status: 'publish,draft,pending,private,future',
			});

			const items = batch.items || [];
			if (items.length === 0) break;
			stats.fetched += items.length;

			for (const item of items) {
				try {
					const featuredImage = await resolveFeaturedImage(client, item, mediaCache);
					const mapped = mapWordpressPostFull(item, {
						featuredImageUrl: featuredImage,
						categoryNames: categoryNamesFromEmbedded(item),
						tagNames: tagNamesFromEmbedded(item),
						authorName: authorNameFromEmbedded(item),
						language: site.language || '',
					});

					if (!mapped.wpPostId) continue;
					seenWpIds.add(mapped.wpPostId);

					if (mapped.modifiedDate && (!newestModified || mapped.modifiedDate > newestModified)) {
						newestModified = mapped.modifiedDate;
					}

					const existing = await findExistingArticle({
						websiteId,
						websiteField,
						wpPostId: mapped.wpPostId,
						permalink: mapped.permalink,
					});

					if (existing?.sync_hash && existing.sync_hash === mapped.syncHash && !existing.deleted_at) {
						stats.unchanged += 1;
						continue;
					}

					const payload = buildArticlePayload({
						mapped,
						websiteId,
						ownerId,
						websiteField,
						statusField,
						existingStatus: existing?.status,
					});

					if (existing) {
						await pocketbaseClient.collection('website_articles').update(existing.id, payload);
						if (existing.deleted_at) {
							await pocketbaseClient.collection('website_articles').update(existing.id, {
								deleted_at: '',
							}).catch(() => null);
						}
						await markArticleSynced(existing.id, {
							ownerId,
							source: `wordpress_sync:${mode}`,
							discovered: false,
						});
						stats.updated += 1;
					} else {
						const created = await pocketbaseClient.collection('website_articles').create(payload);
						await markArticleSynced(created.id, {
							ownerId,
							source: `wordpress_sync:${mode}`,
							discovered: true,
						});
						stats.created += 1;
					}
				} catch (error) {
					stats.errors.push(error.message || String(error));
					logger.warn('WordPress article sync item failed', {
						siteId: site.id,
						postId: item?.id,
						message: error.message,
					});
				}
			}

			if (page >= (batch.totalPages || page) || items.length < 50) break;
		}

		// Soft-delete remote-missing posts only on full sync.
		if (mode === 'full') {
			const local = await listLocalWpArticles(websiteId, websiteField);
			for (const row of local) {
				const wpId = Number(row.wp_post_id) || 0;
				if (!wpId || seenWpIds.has(wpId)) continue;
				if (row.deleted_at) continue;
				await pocketbaseClient.collection('website_articles').update(row.id, {
					deleted_at: new Date().toISOString(),
				}).catch(() => null);
				stats.deleted += 1;
			}
		}

		const status = stats.errors.length > 0 ? 'partial' : 'success';
		const finishedAt = new Date().toISOString();
		const syncCursor = {
			modifiedAfter: newestModified || cursor.modifiedAfter || finishedAt,
			lastMode: mode,
			lastRunAt: finishedAt,
			lastFetched: stats.fetched,
		};

		await pocketbaseClient.collection('wordpress_sites').update(site.id, {
			sync_status: status,
			last_synced_at: finishedAt,
			next_sync_at: nextSyncAt(new Date(finishedAt)),
			sync_cursor: syncCursor,
			last_sync_error: stats.errors[0] || '',
		}).catch(() => null);

		if (websiteId) {
			await pocketbaseClient.collection('websites').update(websiteId, {
				last_scan_at: finishedAt,
				next_scan_at: nextSyncAt(new Date(finishedAt)),
				last_scan_summary: {
					source: 'wordpress_sync',
					mode,
					found: stats.fetched,
					newArticles: stats.created,
					updatedArticles: stats.updated,
					deletedArticles: stats.deleted,
					unchanged: stats.unchanged,
					errors: stats.errors.slice(0, 10),
					lastScanAt: finishedAt,
					nextScheduledScan: nextSyncAt(new Date(finishedAt)),
				},
				discovery_status: status === 'failed' ? 'failed' : 'ready',
			}).catch(() => null);
		}

		await finishSyncRun(run, {
			status,
			fetched: stats.fetched,
			created: stats.created,
			updated: stats.updated,
			deleted: stats.deleted,
			unchanged: stats.unchanged,
			error: stats.errors[0] || '',
			summary: stats,
		});

		const refreshed = await pocketbaseClient.collection('wordpress_sites').getOne(site.id).catch(() => site);

		return {
			ok: true,
			mode,
			stats,
			syncCursor,
			site: mapWordpressSite(refreshed, { hasCredentials: true, username, authType }),
			runId: run?.id || '',
		};
	} catch (error) {
		await pocketbaseClient.collection('wordpress_sites').update(site.id, {
			sync_status: 'failed',
			last_sync_error: error.message || String(error),
			next_sync_at: nextSyncAt(),
		}).catch(() => null);

		await finishSyncRun(run, {
			status: 'failed',
			fetched: stats.fetched,
			created: stats.created,
			updated: stats.updated,
			deleted: stats.deleted,
			unchanged: stats.unchanged,
			error: error.message || String(error),
			summary: stats,
		});

		throw error;
	}
}

/**
 * Process due scheduled WordPress syncs (next_sync_at <= now).
 */
export async function processDueWordpressSyncs({ limit = 5 } = {}) {
	await ensureWordpressIntegrationSchema(pocketbaseClient);
	const now = new Date().toISOString();
	const due = await pocketbaseClient.collection('wordpress_sites').getList(1, limit, {
		filter: pocketbaseClient.filter(
			'next_sync_at != "" && next_sync_at <= {:now} && (sync_status = "" || sync_status = "idle" || sync_status = "success" || sync_status = "partial" || sync_status = "failed")',
			{ now },
		),
		sort: 'next_sync_at',
		requestKey: null,
	}).catch(() => ({ items: [] }));

	const results = [];
	for (const site of due.items || []) {
		try {
			const result = await syncOwnedWordpressSite(site.owner, site.id, { mode: 'scheduled' });
			results.push({ siteId: site.id, ok: true, stats: result.stats });
		} catch (error) {
			results.push({ siteId: site.id, ok: false, error: error.message });
		}
	}
	return { processed: results.length, results };
}

export function hashContent(value) {
	return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

export { stripHtml };
