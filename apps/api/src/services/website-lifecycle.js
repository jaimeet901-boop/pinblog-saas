/**
 * Website lifecycle: soft disconnect + permanent delete with related-data cleanup.
 *
 * Permanent delete is best-effort atomic for PocketBase (no multi-collection SQL txn):
 * 1) mark lifecycle_state=purging
 * 2) delete discovered dependents (schema relations + known logical refs)
 * 3) delete the websites row
 * 4) invalidate caches
 * On failure while purging, the row stays in purging so delete can be retried.
 */
import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import { invalidateCacheByPrefix } from '../utils/cache.js';
import { safeGetFullList } from '../utils/pocketbase-safe-query.js';
import { ensureWebsiteLifecycleSchema } from '../utils/ensure-website-lifecycle-schema.js';
import {
	andWorkspaceScope,
	assertWorkspaceOwnedRecord,
	getWorkspaceActor,
	recordBelongsToWorkspace,
	stampUpdateOwnership,
	workspaceScopeFilter,
} from './workspace-ownership.js';
import { refreshAnalyticsCaches } from './analytics/refresh.js';
import { writeAuditLog } from './audit/write.js';

function httpError(status, message, errorCode = 'WEBSITE_LIFECYCLE_ERROR', details = null) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	if (details) error.details = details;
	return error;
}

function recordId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

/** Canonical domain key for workspace-scoped uniqueness (strip www, lowercase). */
export function normalizeDomainKey(value) {
	const raw = String(value || '').trim().toLowerCase();
	if (!raw) return '';
	try {
		if (raw.includes('://') || raw.startsWith('//')) {
			const host = new URL(raw.includes('://') ? raw : `https:${raw}`).hostname.toLowerCase();
			return host.replace(/^www\./, '');
		}
	} catch {
		// fall through
	}
	return raw.replace(/^www\./, '').split('/')[0].split(':')[0];
}

export function deriveDomainFromUrl(url) {
	try {
		return normalizeDomainKey(new URL(String(url || '').trim()).hostname);
	} catch {
		return normalizeDomainKey(url);
	}
}

export function isWebsiteSoftRemoved(site) {
	if (!site) return true;
	const lifecycle = String(site.lifecycle_state || '').trim().toLowerCase();
	if (lifecycle === 'disconnected' || lifecycle === 'purging') return true;
	if (site.removed_at) return true;
	return false;
}

export function isWebsiteActive(site) {
	return Boolean(site) && !isWebsiteSoftRemoved(site);
}

function collectionFields(model) {
	if (Array.isArray(model?.fields)) return model.fields;
	if (Array.isArray(model?.schema)) return model.schema;
	return [];
}

/**
 * Discover every PocketBase collection that relates to `websites`
 * (relation field collectionId === websites.id). No hardcoded table list for relations.
 */
export async function discoverWebsiteRelationTargets() {
	const collections = await pocketbaseClient.collections.getFullList({ requestKey: null }).catch(() => []);
	const websites = (collections || []).find((item) => item.name === 'websites');
	if (!websites?.id) return [];

	const targets = [];
	for (const collection of collections || []) {
		if (!collection || collection.name === 'websites') continue;
		for (const field of collectionFields(collection)) {
			if (field?.type !== 'relation') continue;
			if (String(field.collectionId || '') !== String(websites.id)) continue;
			targets.push({
				collection: collection.name,
				field: field.name,
				cascadeDelete: Boolean(field.cascadeDelete),
				required: Boolean(field.required),
			});
		}
	}
	return targets;
}

async function listScopedByRelation({ req, collection, field, websiteId }) {
	const filter = andWorkspaceScope(
		req,
		pocketbaseClient.filter(`${field} = {:websiteId}`, { websiteId }),
	);
	return safeGetFullList({
		collection,
		context: `website-lifecycle:${collection}:${field}`,
		filter,
	}).catch(() => []);
}

async function deleteRecordsByIds(collection, ids, { context } = {}) {
	const unique = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
	const deleted = [];
	const failed = [];

	for (const id of unique) {
		try {
			await pocketbaseClient.collection(collection).delete(id);
			deleted.push(id);
		} catch (error) {
			failed.push({ id, message: error?.message || String(error) });
			logger.warn('[website-lifecycle] delete record failed', {
				context,
				collection,
				id,
				message: error?.message || null,
			});
		}
	}

	return { deleted, failed };
}

async function findWordpressSitesForWebsite({ req, websiteId, site }) {
	const byRelation = await listScopedByRelation({
		req,
		collection: 'wordpress_sites',
		field: 'website',
		websiteId,
	});

	const domain = normalizeDomainKey(site?.domain || site?.url || '');
	const url = String(site?.url || '').trim();
	const extras = [];

	if (domain || url) {
		const scoped = await safeGetFullList({
			collection: 'wordpress_sites',
			context: 'website-lifecycle:wordpress_sites:domain',
			filter: workspaceScopeFilter(req),
		}).catch(() => []);

		for (const row of scoped || []) {
			if (byRelation.some((item) => item.id === row.id)) continue;
			const rowDomain = normalizeDomainKey(row.domain || row.url || '');
			const rowUrl = String(row.url || '').trim();
			const linkedWebsite = recordId(row.website);
			if (linkedWebsite && linkedWebsite !== websiteId) continue;
			if ((domain && rowDomain === domain) || (url && rowUrl === url)) {
				extras.push(row);
			}
		}
	}

	return [...byRelation, ...extras];
}

async function deleteWordpressSiteDependents({ req, wordpressSiteIds }) {
	const summary = {
		publish_jobs: { deleted: [], failed: [] },
		publish_history: { deleted: [], failed: [] },
		wordpress_sync_runs: { deleted: [], failed: [] },
		wordpress_credentials: { deleted: [], failed: [] },
	};

	for (const siteId of wordpressSiteIds) {
		for (const collection of ['publish_jobs', 'publish_history', 'wordpress_sync_runs']) {
			const rows = await safeGetFullList({
				collection,
				context: `website-lifecycle:${collection}:site`,
				filter: andWorkspaceScope(
					req,
					pocketbaseClient.filter('site = {:siteId}', { siteId }),
				),
			}).catch(() => []);
			const result = await deleteRecordsByIds(collection, rows.map((row) => row.id), {
				context: `purge:${collection}`,
			});
			summary[collection].deleted.push(...result.deleted);
			summary[collection].failed.push(...result.failed);
		}

		const credentials = await safeGetFullList({
			collection: 'wordpress_credentials',
			context: 'website-lifecycle:wordpress_credentials',
			filter: pocketbaseClient.filter('site = {:siteId}', { siteId }),
		}).catch(() => []);
		const credResult = await deleteRecordsByIds(
			'wordpress_credentials',
			credentials.map((row) => row.id),
			{ context: 'purge:wordpress_credentials' },
		);
		summary.wordpress_credentials.deleted.push(...credResult.deleted);
		summary.wordpress_credentials.failed.push(...credResult.failed);
	}

	return summary;
}

async function deleteQueueJobsForWebsite({ req, websiteId, purgeCompleted = false }) {
	const jobs = await safeGetFullList({
		collection: 'queue_jobs',
		context: 'website-lifecycle:queue_jobs',
		filter: workspaceScopeFilter(req),
	}).catch(() => []);

	const matching = (jobs || []).filter((job) => {
		const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
		const meta = job?.meta && typeof job.meta === 'object' ? job.meta : {};
		const candidates = [
			payload.websiteId,
			payload.website_id,
			payload.website,
			meta.websiteId,
			meta.website_id,
			meta.website,
		].map(recordId);
		return candidates.includes(websiteId);
	});

	// Disconnect (remove) should cancel unfinished work but preserve job history.
	// Permanent delete should purge all queued references.
	const deleted = [];
	const cancelled = [];
	const failed = [];

	for (const job of matching) {
		const status = String(job.status || '').toLowerCase();
		try {
			if (['queued', 'pending', 'running', 'claimed', 'retry', 'scheduled'].includes(status)) {
				await pocketbaseClient.collection('queue_jobs').update(job.id, stampUpdateOwnership(req, {
					status: 'cancelled',
					last_error: purgeCompleted ? 'Website permanently deleted' : 'Website disconnected',
				}));
				cancelled.push(job.id);
			} else if (purgeCompleted) {
				await pocketbaseClient.collection('queue_jobs').delete(job.id);
				deleted.push(job.id);
			}
		} catch (error) {
			failed.push({ id: job.id, message: error?.message || String(error) });
		}
	}

	return { deleted, cancelled, failed };
}

async function clearBrandKitWebsiteUrls({ req, site }) {
	const domain = normalizeDomainKey(site?.domain || site?.url || '');
	const url = String(site?.url || '').trim();
	if (!domain && !url) return { cleared: [] };

	const kits = await safeGetFullList({
		collection: 'brand_kits',
		context: 'website-lifecycle:brand_kits',
		filter: workspaceScopeFilter(req),
	}).catch(() => []);

	const cleared = [];
	for (const kit of kits || []) {
		const kitUrl = String(kit.website_url || '').trim();
		if (!kitUrl) continue;
		const kitDomain = deriveDomainFromUrl(kitUrl);
		if ((url && kitUrl === url) || (domain && kitDomain === domain)) {
			await pocketbaseClient.collection('brand_kits').update(kit.id, stampUpdateOwnership(req, {
				website_url: '',
			})).catch(() => null);
			cleared.push(kit.id);
		}
	}
	return { cleared };
}

async function clearUserDefaultWebsitePreferences({ req, websiteId }) {
	// Frontend stores defaultWebsiteId in local preferences; there is no server preferences field.
	// Keep a no-op hook so callers can still report cleanup completeness.
	void req;
	void websiteId;
	return { cleared: false, note: 'defaultWebsiteId is client-local; frontend clears on delete response' };
}

function invalidateWebsiteCaches(site) {
	invalidateCacheByPrefix('website-metadata:');
	const url = String(site?.url || '').trim();
	if (url) {
		invalidateCacheByPrefix(`website-metadata:${url}`);
	}
}

/**
 * Find workspace websites matching a domain (active and/or disconnected).
 */
export async function findWorkspaceWebsitesByDomain({ req, domain, url }) {
	await ensureWebsiteLifecycleSchema(pocketbaseClient);
	const key = normalizeDomainKey(domain || url || '');
	const urlOrigin = String(url || '').trim();
	if (!key && !urlOrigin) return [];

	const rows = await safeGetFullList({
		collection: 'websites',
		context: 'website-lifecycle:find-by-domain',
		filter: workspaceScopeFilter(req),
		sort: '-created',
	}).catch(() => []);

	return (rows || []).filter((row) => {
		if (!recordBelongsToWorkspace(row, req)) return false;
		const rowDomain = normalizeDomainKey(row.domain || row.url || '');
		const rowUrl = String(row.url || '').trim();
		if (key && rowDomain === key) return true;
		if (urlOrigin && rowUrl === urlOrigin) return true;
		return false;
	});
}

/**
 * Workspace-scoped duplicate protection for create/reconnect.
 */
export async function assertDomainAvailableInWorkspace({ req, domain, url, excludeWebsiteId = '' }) {
	const matches = await findWorkspaceWebsitesByDomain({ req, domain, url });
	const others = matches.filter((row) => row.id !== excludeWebsiteId);

	const active = others.find((row) => isWebsiteActive(row));
	if (active) {
		throw httpError(
			409,
			`This domain is already connected in your workspace (${normalizeDomainKey(active.domain || active.url || domain)}).`,
			'WEBSITE_DOMAIN_EXISTS',
			{ websiteId: active.id, domain: normalizeDomainKey(active.domain || active.url || domain) },
		);
	}

	const purging = others.find((row) => String(row.lifecycle_state || '') === 'purging');
	if (purging) {
		throw httpError(
			409,
			'This domain is being permanently deleted. Please try again shortly.',
			'WEBSITE_PURGING',
			{ websiteId: purging.id, domain: normalizeDomainKey(purging.domain || purging.url || domain) },
		);
	}

	const disconnected = others.find((row) => isWebsiteSoftRemoved(row) && String(row.lifecycle_state || '') !== 'purging');
	if (disconnected) {
		throw httpError(
			409,
			'This domain was removed but its data is still kept. Reconnect it instead of creating a duplicate.',
			'WEBSITE_DOMAIN_DISCONNECTED',
			{ websiteId: disconnected.id, domain: normalizeDomainKey(disconnected.domain || disconnected.url || domain) },
		);
	}

	return true;
}

export async function disconnectWebsite({ req, websiteId }) {
	await ensureWebsiteLifecycleSchema(pocketbaseClient);
	const site = await pocketbaseClient.collection('websites').getOne(websiteId).catch(() => null);
	if (!site) throw httpError(404, 'Website not found', 'WEBSITE_NOT_FOUND');
	assertWorkspaceOwnedRecord(site, req);

	const actor = getWorkspaceActor(req);
	try {
		if (String(site.lifecycle_state || '') === 'purging') {
			throw httpError(409, 'This website is being permanently deleted. Retry permanent delete if it did not finish.', 'WEBSITE_PURGING');
		}

		if (isWebsiteSoftRemoved(site)) {
			await writeAuditLog({
				category: 'workspace',
				uiCategory: 'System',
				severity: 'success',
				action: 'remove',
				message: 'Website remove (idempotent disconnect)',
				actorUserId: actor.creatorId,
				actorLabel: actor.creatorId || 'user',
				workspaceId: actor.workspaceId,
				workspaceKey: actor.workspaceKey || actor.workspaceId,
				service: 'Website Lifecycle',
				resourceType: 'website',
				resourceId: websiteId,
				result: 'success',
				metadata: { domain: site.domain || site.url || '' },
			});

			return { ok: true, mode: 'disconnect', website: site, alreadyDisconnected: true };
		}

		const updated = await pocketbaseClient.collection('websites').update(websiteId, stampUpdateOwnership(req, {
			removed_at: new Date().toISOString(),
			lifecycle_state: 'disconnected',
			discovery_status: 'pending',
		}));

		// Cancel unfinished queue work without deleting historical data.
		await deleteQueueJobsForWebsite({ req, websiteId }).catch(() => null);
		invalidateWebsiteCaches(site);

		await refreshAnalyticsCaches({
			ownerId: actor.workspaceOwnerId || actor.creatorId,
			workspaceKey: actor.workspaceKey || actor.workspaceId,
		}).catch(() => null);

		logger.info('[website-lifecycle] disconnected', {
			websiteId,
			workspaceId: actor.workspaceId,
			domain: site.domain || '',
		});

		await writeAuditLog({
			category: 'workspace',
			uiCategory: 'System',
			severity: 'success',
			action: 'remove',
			message: 'Website removed (disconnected)',
			actorUserId: actor.creatorId,
			actorLabel: actor.creatorId || 'user',
			workspaceId: actor.workspaceId,
			workspaceKey: actor.workspaceKey || actor.workspaceId,
			service: 'Website Lifecycle',
			resourceType: 'website',
			resourceId: websiteId,
			result: 'success',
			metadata: { domain: site.domain || site.url || '' },
		});

		return { ok: true, mode: 'disconnect', website: updated, alreadyDisconnected: false };
	} catch (error) {
		await writeAuditLog({
			category: 'workspace',
			uiCategory: 'System',
			severity: 'error',
			action: 'remove',
			message: 'Website remove failed',
			actorUserId: actor.creatorId,
			actorLabel: actor.creatorId || 'user',
			workspaceId: actor.workspaceId,
			workspaceKey: actor.workspaceKey || actor.workspaceId,
			service: 'Website Lifecycle',
			resourceType: 'website',
			resourceId: websiteId,
			result: 'failure',
			metadata: {
				domain: site.domain || site.url || '',
				reason: error?.message || String(error),
			},
		});
		throw error;
	}
}

export async function reconnectWebsite({ req, websiteId }) {
	await ensureWebsiteLifecycleSchema(pocketbaseClient);
	const site = await pocketbaseClient.collection('websites').getOne(websiteId).catch(() => null);
	if (!site) throw httpError(404, 'Website not found', 'WEBSITE_NOT_FOUND');
	assertWorkspaceOwnedRecord(site, req);

	const actor = getWorkspaceActor(req);
	try {
		if (String(site.lifecycle_state || '') === 'purging') {
			throw httpError(409, 'This website is being permanently deleted and cannot be reconnected.', 'WEBSITE_PURGING');
		}

		await assertDomainAvailableInWorkspace({
			req,
			domain: site.domain,
			url: site.url,
			excludeWebsiteId: site.id,
		});

		const updated = await pocketbaseClient.collection('websites').update(websiteId, stampUpdateOwnership(req, {
			removed_at: null,
			lifecycle_state: 'active',
			status: site.status === 'failed' ? 'active' : (site.status || 'active'),
			discovery_status: site.discovery_status || 'pending',
		}));

		invalidateWebsiteCaches(site);

		logger.info('[website-lifecycle] reconnected', {
			websiteId,
			workspaceId: actor.workspaceId,
			domain: site.domain || '',
		});

		await writeAuditLog({
			category: 'workspace',
			uiCategory: 'System',
			severity: 'success',
			action: 'reconnect',
			message: 'Website reconnected (reactivated)',
			actorUserId: actor.creatorId,
			actorLabel: actor.creatorId || 'user',
			workspaceId: actor.workspaceId,
			workspaceKey: actor.workspaceKey || actor.workspaceId,
			service: 'Website Lifecycle',
			resourceType: 'website',
			resourceId: websiteId,
			result: 'success',
			metadata: { domain: site.domain || site.url || '' },
		});

		return { ok: true, mode: 'reconnect', website: updated };
	} catch (error) {
		await writeAuditLog({
			category: 'workspace',
			uiCategory: 'System',
			severity: 'error',
			action: 'reconnect',
			message: 'Website reconnect failed',
			actorUserId: actor.creatorId,
			actorLabel: actor.creatorId || 'user',
			workspaceId: actor.workspaceId,
			workspaceKey: actor.workspaceKey || actor.workspaceId,
			service: 'Website Lifecycle',
			resourceType: 'website',
			resourceId: websiteId,
			result: 'failure',
			metadata: {
				domain: site.domain || site.url || '',
				reason: error?.message || String(error),
			},
		});
		throw error;
	}
}

/**
 * Reset Website:
 * - Re-activates the website identity (does not change id)
 * - Marks discovery_status = pending
 * - Cancels unfinished queue work (keeps historical jobs)
 */
export async function resetWebsite({ req, websiteId }) {
	await ensureWebsiteLifecycleSchema(pocketbaseClient);
	const site = await pocketbaseClient.collection('websites').getOne(websiteId).catch(() => null);
	if (!site) throw httpError(404, 'Website not found', 'WEBSITE_NOT_FOUND');
	assertWorkspaceOwnedRecord(site, req);

	if (String(site.lifecycle_state || '') === 'purging') {
		throw httpError(409, 'This website is being permanently deleted. Retry shortly.', 'WEBSITE_PURGING');
	}

	const actor = getWorkspaceActor(req);
	const updated = await pocketbaseClient.collection('websites').update(websiteId, stampUpdateOwnership(req, {
		removed_at: null,
		lifecycle_state: 'active',
		status: site.status === 'failed' ? 'active' : (site.status || 'active'),
		discovery_status: 'pending',
	}));

	// Cancel unfinished work but preserve queue history rows.
	await deleteQueueJobsForWebsite({ req, websiteId, purgeCompleted: false }).catch(() => null);

	invalidateWebsiteCaches(site);
	await refreshAnalyticsCaches({
		ownerId: actor.workspaceOwnerId || actor.creatorId,
		workspaceKey: actor.workspaceKey || actor.workspaceId,
	}).catch(() => null);

	logger.info('[website-lifecycle] reset', {
		websiteId,
		workspaceId: actor.workspaceId,
		domain: site.domain || '',
	});

	return { ok: true, mode: 'reset', website: updated };
}

/**
 * Permanent delete: purge related data then delete the websites row.
 */
export async function permanentlyDeleteWebsite({ req, websiteId, confirmDomain = '' }) {
	await ensureWebsiteLifecycleSchema(pocketbaseClient);
	const site = await pocketbaseClient.collection('websites').getOne(websiteId).catch(() => null);
	if (!site) throw httpError(404, 'Website not found', 'WEBSITE_NOT_FOUND');
	assertWorkspaceOwnedRecord(site, req);

	const expected = normalizeDomainKey(site.domain || site.url || '');
	const provided = normalizeDomainKey(confirmDomain);
	// Permanent delete must always be explicitly confirmed (no silent bypass).
	if (!provided || provided !== expected) {
		throw httpError(
			422,
			`Type the website domain (${expected || 'domain'}) to confirm permanent deletion.`,
			'WEBSITE_DELETE_CONFIRMATION_REQUIRED',
			{ expectedDomain: expected },
		);
	}

	const actor = getWorkspaceActor(req);
	const summary = {
		websiteId,
		domain: expected,
		relations: {},
		wordpress: null,
		queue: null,
		brandKits: null,
		preferences: null,
	};

	// Phase 1 — mark purging (idempotent retry support)
	await pocketbaseClient.collection('websites').update(websiteId, stampUpdateOwnership(req, {
		removed_at: site.removed_at || new Date().toISOString(),
		lifecycle_state: 'purging',
	})).catch(() => null);

	try {
		// Phase 2 — WordPress bridge + non-cascade WP publish/history/sync
		const wordpressSites = await findWordpressSitesForWebsite({ req, websiteId, site });
		const wordpressSiteIds = wordpressSites.map((row) => row.id);
		summary.wordpress = await deleteWordpressSiteDependents({ req, wordpressSiteIds });
		summary.wordpress.sites = await deleteRecordsByIds('wordpress_sites', wordpressSiteIds, {
			context: 'purge:wordpress_sites',
		});

		const wpFailedCount = (
			(summary.wordpress?.publish_jobs?.failed?.length || 0)
			+ (summary.wordpress?.publish_history?.failed?.length || 0)
			+ (summary.wordpress?.wordpress_sync_runs?.failed?.length || 0)
			+ (summary.wordpress?.wordpress_credentials?.failed?.length || 0)
			+ (summary.wordpress?.sites?.failed?.length || 0)
		);
		if (wpFailedCount > 0) {
			throw httpError(
				500,
				'Permanent delete failed while purging WordPress dependents',
				'WEBSITE_PURGE_WORDPRESS_FAILED',
				{ websiteId, failedCount: wpFailedCount },
			);
		}

		// Phase 3 — schema-discovered relations to websites
		const relations = await discoverWebsiteRelationTargets();
		// Delete non-cascade first, then cascade fields (explicit cleanup before parent delete).
		const ordered = [
			...relations.filter((item) => !item.cascadeDelete),
			...relations.filter((item) => item.cascadeDelete),
		];

		for (const target of ordered) {
			if (target.collection === 'wordpress_sites') continue; // already handled
			const rows = await listScopedByRelation({
				req,
				collection: target.collection,
				field: target.field,
				websiteId,
			});
			const deletionResult = await deleteRecordsByIds(
				target.collection,
				rows.map((row) => row.id),
				{ context: `purge:${target.collection}` },
			);
			summary.relations[`${target.collection}.${target.field}`] = deletionResult;
			if ((deletionResult?.failed?.length || 0) > 0) {
				throw httpError(
					500,
					'Permanent delete failed while purging related records',
					'WEBSITE_PURGE_DEPENDENT_FAILED',
					{ collection: target.collection, field: target.field, failedCount: deletionResult.failed.length },
				);
			}
		}

		// Phase 4 — logical refs (queue payload, brand kit URL text, user prefs)
		summary.queue = await deleteQueueJobsForWebsite({ req, websiteId, purgeCompleted: true });
		if ((summary.queue?.failed?.length || 0) > 0) {
			throw httpError(
				500,
				'Permanent delete failed while cancelling/purging queue jobs',
				'WEBSITE_PURGE_QUEUE_FAILED',
				{ websiteId, failedCount: summary.queue.failed.length },
			);
		}
		summary.brandKits = await clearBrandKitWebsiteUrls({ req, site });
		summary.preferences = await clearUserDefaultWebsitePreferences({ req, websiteId });

		// Phase 5 — delete website root (any remaining cascade children go with it)
		await pocketbaseClient.collection('websites').delete(websiteId);

		invalidateWebsiteCaches(site);
		await refreshAnalyticsCaches({
			ownerId: actor.workspaceOwnerId || actor.creatorId,
			workspaceKey: actor.workspaceKey || actor.workspaceId,
		}).catch(() => null);

		logger.info('[website-lifecycle] permanently deleted', {
			websiteId,
			workspaceId: actor.workspaceId,
			domain: expected,
			summary,
		});

		await writeAuditLog({
			category: 'workspace',
			uiCategory: 'System',
			severity: 'success',
			action: 'permanent_delete',
			message: 'Website permanently deleted',
			actorUserId: actor.creatorId,
			actorLabel: actor.creatorId || 'user',
			workspaceId: actor.workspaceId,
			workspaceKey: actor.workspaceKey || actor.workspaceId,
			service: 'Website Lifecycle',
			resourceType: 'website',
			resourceId: websiteId,
			result: 'success',
			metadata: {
				domain: expected,
				wordpressPurged: {
					publishJobs: summary.wordpress?.publish_jobs?.deleted?.length || 0,
					publishHistory: summary.wordpress?.publish_history?.deleted?.length || 0,
					wordpressSyncRuns: summary.wordpress?.wordpress_sync_runs?.deleted?.length || 0,
					credentials: summary.wordpress?.wordpress_credentials?.deleted?.length || 0,
					sites: summary.wordpress?.sites?.deleted?.length || 0,
				},
				relationsDeletedCollections: Object.keys(summary.relations || {}).length,
				queueDeleted: summary.queue?.deleted?.length || 0,
				queueCancelled: summary.queue?.cancelled?.length || 0,
			},
		});

		return { ok: true, mode: 'permanent', websiteId, domain: expected, summary };
	} catch (error) {
		await writeAuditLog({
			category: 'workspace',
			uiCategory: 'System',
			severity: 'error',
			action: 'permanent_delete',
			message: 'Website permanent delete failed',
			actorUserId: actor.creatorId,
			actorLabel: actor.creatorId || 'user',
			workspaceId: actor.workspaceId,
			workspaceKey: actor.workspaceKey || actor.workspaceId,
			service: 'Website Lifecycle',
			resourceType: 'website',
			resourceId: websiteId,
			result: 'failure',
			metadata: {
				domain: expected,
				reason: error?.message || String(error),
				summary: {
					wordpressFailedCount: (
						(summary.wordpress?.publish_jobs?.failed?.length || 0)
						+ (summary.wordpress?.publish_history?.failed?.length || 0)
						+ (summary.wordpress?.wordpress_sync_runs?.failed?.length || 0)
						+ (summary.wordpress?.wordpress_credentials?.failed?.length || 0)
						+ (summary.wordpress?.sites?.failed?.length || 0)
					),
					queueFailedCount: summary.queue?.failed?.length || 0,
				},
			},
		});
		logger.error('[website-lifecycle] permanent delete failed; left in purging for retry', {
			websiteId,
			workspaceId: actor.workspaceId,
			message: error?.message || null,
			summary,
		});
		throw error?.status
			? error
			: httpError(500, error?.message || 'Permanent website delete failed. You can retry.', 'WEBSITE_PURGE_FAILED', { summary });
	}
}

export function mapWebsiteLifecycleFields(site) {
	return {
		removed_at: site?.removed_at || null,
		lifecycle_state: site?.lifecycle_state || (site?.removed_at ? 'disconnected' : 'active'),
		is_removed: isWebsiteSoftRemoved(site),
	};
}
