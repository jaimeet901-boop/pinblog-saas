import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { writeAuditLog } from './audit/write.js';
import {
	getLegalPageTemplate,
	LEGAL_PAGE_TEMPLATES,
	listLegalPageTemplateMeta,
} from './legal-page-templates.js';

export const LEGAL_PAGE_SLUGS = Object.freeze(LEGAL_PAGE_TEMPLATES.map((item) => item.slug));

const SITE_URL = 'https://tbuy.store';

function normalizeSlug(value) {
	return String(value || '').trim().toLowerCase();
}

function assertSlug(slug) {
	const normalized = normalizeSlug(slug);
	if (!LEGAL_PAGE_SLUGS.includes(normalized)) {
		throw httpError(422, `Invalid legal page slug. Allowed: ${LEGAL_PAGE_SLUGS.join(', ')}`, 'VALIDATION_ERROR');
	}
	return normalized;
}

function normalizeStatus(value, fallback = 'draft') {
	const status = String(value || fallback).trim().toLowerCase();
	if (status !== 'draft' && status !== 'published') {
		throw httpError(422, 'Status must be draft or published.', 'VALIDATION_ERROR');
	}
	return status;
}

function clip(value, max) {
	return String(value || '').trim().slice(0, max);
}

function actorLabel(adminUser) {
	if (!adminUser) return 'admin';
	return String(adminUser.email || adminUser.name || adminUser.id || 'admin').slice(0, 200);
}

export function mapLegalPage(record) {
	if (!record) return null;
	return {
		id: record.id,
		slug: record.slug,
		title: record.title || '',
		seoTitle: record.seo_title || record.title || '',
		metaDescription: record.meta_description || '',
		content: record.content || '',
		status: record.status || 'draft',
		version: Number(record.version) || 1,
		updatedBy: record.updated_by || '',
		createdAt: record.created || '',
		updatedAt: record.updated || '',
		canonicalPath: `/${record.slug}`,
		canonicalUrl: `${SITE_URL}/${record.slug}`,
	};
}

export function mapLegalPageVersion(record) {
	if (!record) return null;
	return {
		id: record.id,
		pageId: record.page || '',
		slug: record.slug,
		version: Number(record.version) || 1,
		title: record.title || '',
		seoTitle: record.seo_title || '',
		metaDescription: record.meta_description || '',
		content: record.content || '',
		status: record.status || 'draft',
		updatedBy: record.updated_by || '',
		snapshotAt: record.snapshot_at || record.created || '',
		createdAt: record.created || '',
	};
}

async function getBySlugRecord(slug) {
	const normalized = assertSlug(slug);
	return pocketbaseClient.collection('legal_pages').getFirstListItem(
		pocketbaseClient.filter('slug = {:slug}', { slug: normalized }),
		{ requestKey: null },
	).catch(() => null);
}

async function countLegalPages() {
	const rows = await pocketbaseClient.collection('legal_pages').getFullList({
		fields: 'id,slug',
		requestKey: null,
	}).catch(() => []);
	return Array.isArray(rows) ? rows.length : 0;
}

async function snapshotVersion(page, adminUser) {
	const now = new Date().toISOString();
	return pocketbaseClient.collection('legal_page_versions').create({
		page: page.id,
		slug: page.slug,
		version: Number(page.version) || 1,
		title: page.title || '',
		seo_title: page.seo_title || '',
		meta_description: page.meta_description || '',
		content: page.content || '',
		status: page.status || 'draft',
		updated_by: page.updated_by || actorLabel(adminUser),
		snapshot_at: now,
	}, { requestKey: null });
}

/**
 * Seed all five default legal pages only when the collection is empty.
 * Never overwrites existing pages. Always seeds as draft.
 */
export async function ensureDefaultLegalPages(adminUser = null) {
	const existingCount = await countLegalPages();
	if (existingCount > 0) {
		return [];
	}

	const created = [];
	for (const item of LEGAL_PAGE_TEMPLATES) {
		const existing = await getBySlugRecord(item.slug);
		if (existing) continue;
		const record = await pocketbaseClient.collection('legal_pages').create({
			slug: item.slug,
			title: item.title,
			seo_title: item.seoTitle,
			meta_description: item.metaDescription,
			content: item.content,
			status: 'draft',
			version: 1,
			updated_by: actorLabel(adminUser) || 'system',
		}, { requestKey: null });
		await snapshotVersion(record, adminUser).catch(() => null);
		created.push(mapLegalPage(record));
	}
	return created;
}

export async function listLegalPages({ q = '', seed = true } = {}) {
	if (seed) {
		await ensureDefaultLegalPages();
	}
	const rows = await pocketbaseClient.collection('legal_pages').getFullList({
		sort: 'slug',
		requestKey: null,
	}).catch(() => []);
	const query = String(q || '').trim().toLowerCase();
	const mapped = rows.map(mapLegalPage);
	if (!query) return { items: mapped, total: mapped.length };
	const filtered = mapped.filter((item) => (
		item.slug.includes(query)
		|| item.title.toLowerCase().includes(query)
		|| item.seoTitle.toLowerCase().includes(query)
		|| item.status.includes(query)
	));
	return { items: filtered, total: filtered.length };
}

export async function getQuickStartCatalog() {
	const { items } = await listLegalPages({ seed: false });
	const existing = new Set(items.map((item) => item.slug));
	return {
		items: listLegalPageTemplateMeta().map((template) => ({
			...template,
			created: existing.has(template.slug),
			creationStatus: existing.has(template.slug) ? 'Created' : 'Not Created',
		})),
		existingCount: items.length,
		isEmpty: items.length === 0,
	};
}

export async function createLegalPageFromTemplate(slug, adminUser = null) {
	const normalized = assertSlug(slug);
	const template = getLegalPageTemplate(normalized);
	if (!template) {
		throw httpError(404, 'Legal page template not found.', 'LEGAL_PAGE_TEMPLATE_NOT_FOUND');
	}

	return createLegalPage({
		slug: template.slug,
		title: template.title,
		seoTitle: template.seoTitle,
		metaDescription: template.metaDescription,
		content: template.content,
		status: 'draft',
	}, adminUser);
}

export async function getLegalPageBySlug(slug) {
	const record = await getBySlugRecord(slug);
	if (!record) {
		throw httpError(404, 'Legal page not found.', 'LEGAL_PAGE_NOT_FOUND');
	}
	return mapLegalPage(record);
}

export async function getPublishedLegalPageBySlug(slug) {
	await ensureDefaultLegalPages();
	const record = await getBySlugRecord(slug);
	if (!record || record.status !== 'published') {
		throw httpError(404, 'Legal page not found.', 'LEGAL_PAGE_NOT_FOUND');
	}
	return mapLegalPage(record);
}

export async function createLegalPage(body = {}, adminUser = null) {
	const slug = assertSlug(body.slug);
	const existing = await getBySlugRecord(slug);
	if (existing) {
		throw httpError(409, `Legal page "${slug}" already exists.`, 'LEGAL_PAGE_EXISTS');
	}

	const title = clip(body.title, 300);
	if (!title) {
		throw httpError(422, 'Title is required.', 'VALIDATION_ERROR');
	}
	const content = String(body.content || '').trim();
	if (!content) {
		throw httpError(422, 'Content is required.', 'VALIDATION_ERROR');
	}

	const record = await pocketbaseClient.collection('legal_pages').create({
		slug,
		title,
		seo_title: clip(body.seoTitle ?? body.seo_title ?? title, 300),
		meta_description: clip(body.metaDescription ?? body.meta_description ?? '', 600),
		content,
		status: normalizeStatus(body.status, 'draft'),
		version: 1,
		updated_by: actorLabel(adminUser),
	}, { requestKey: null });

	await snapshotVersion(record, adminUser).catch(() => null);
	await writeAuditLog({
		category: 'admin',
		action: 'legal_page_created',
		message: `Created legal page ${slug}`,
		actorUserId: adminUser?.id,
		actorLabel: actorLabel(adminUser),
		service: 'LegalPages',
		metadata: { slug, version: 1 },
	}).catch(() => null);

	return mapLegalPage(record);
}

export async function updateLegalPage(slug, body = {}, adminUser = null) {
	const record = await getBySlugRecord(slug);
	if (!record) {
		throw httpError(404, 'Legal page not found.', 'LEGAL_PAGE_NOT_FOUND');
	}

	const title = body.title != null ? clip(body.title, 300) : record.title;
	if (!title) {
		throw httpError(422, 'Title is required.', 'VALIDATION_ERROR');
	}
	const content = body.content != null ? String(body.content).trim() : record.content;
	if (!content) {
		throw httpError(422, 'Content is required.', 'VALIDATION_ERROR');
	}

	const nextVersion = (Number(record.version) || 1) + 1;
	const payload = {
		title,
		seo_title: body.seoTitle != null || body.seo_title != null
			? clip(body.seoTitle ?? body.seo_title, 300)
			: (record.seo_title || title),
		meta_description: body.metaDescription != null || body.meta_description != null
			? clip(body.metaDescription ?? body.meta_description, 600)
			: (record.meta_description || ''),
		content,
		status: body.status != null ? normalizeStatus(body.status, record.status) : record.status,
		version: nextVersion,
		updated_by: actorLabel(adminUser),
	};

	const updated = await pocketbaseClient.collection('legal_pages').update(record.id, payload, { requestKey: null });
	await snapshotVersion(updated, adminUser).catch(() => null);
	await writeAuditLog({
		category: 'admin',
		action: 'legal_page_updated',
		message: `Updated legal page ${updated.slug} to v${nextVersion}`,
		actorUserId: adminUser?.id,
		actorLabel: actorLabel(adminUser),
		service: 'LegalPages',
		metadata: { slug: updated.slug, version: nextVersion, status: updated.status },
	}).catch(() => null);

	return mapLegalPage(updated);
}

export async function deleteLegalPage(slug, adminUser = null) {
	const record = await getBySlugRecord(slug);
	if (!record) {
		throw httpError(404, 'Legal page not found.', 'LEGAL_PAGE_NOT_FOUND');
	}
	await pocketbaseClient.collection('legal_pages').delete(record.id, { requestKey: null });
	await writeAuditLog({
		category: 'admin',
		action: 'legal_page_deleted',
		message: `Deleted legal page ${record.slug}`,
		actorUserId: adminUser?.id,
		actorLabel: actorLabel(adminUser),
		service: 'LegalPages',
		metadata: { slug: record.slug, version: record.version },
	}).catch(() => null);
	return { ok: true, slug: record.slug };
}

export async function listLegalPageVersions(slug) {
	assertSlug(slug);
	const rows = await pocketbaseClient.collection('legal_page_versions').getFullList({
		filter: pocketbaseClient.filter('slug = {:slug}', { slug: normalizeSlug(slug) }),
		sort: '-version',
		requestKey: null,
	}).catch(() => []);
	return { items: rows.map(mapLegalPageVersion), total: rows.length };
}

export async function restoreLegalPageVersion(slug, version, adminUser = null) {
	const normalized = assertSlug(slug);
	const versionNumber = Number(version);
	if (!Number.isFinite(versionNumber) || versionNumber < 1) {
		throw httpError(422, 'Valid version number is required.', 'VALIDATION_ERROR');
	}

	const snapshot = await pocketbaseClient.collection('legal_page_versions').getFirstListItem(
		pocketbaseClient.filter('slug = {:slug} && version = {:version}', {
			slug: normalized,
			version: versionNumber,
		}),
		{ requestKey: null },
	).catch(() => null);

	if (!snapshot) {
		throw httpError(404, 'Version not found.', 'LEGAL_PAGE_VERSION_NOT_FOUND');
	}

	return updateLegalPage(normalized, {
		title: snapshot.title,
		seoTitle: snapshot.seo_title,
		metaDescription: snapshot.meta_description,
		content: snapshot.content,
		status: snapshot.status,
	}, adminUser);
}
