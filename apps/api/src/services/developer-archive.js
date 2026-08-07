/**
 * Developer Archive — internal-only template inventory (Phase 1 design).
 *
 * NOT part of Marketplace. Never exposed via customer gallery / Choose Template.
 * Same `ai_pin_templates` collection; separate access plane when implemented.
 *
 * Planned internal API (Phase 1+):
 *   GET /internal/v1/developer-archive/templates
 *   GET /internal/v1/developer-archive/templates/:id
 *   POST /internal/v1/developer-archive/templates/:id/promote  (future → Official)
 *
 * Required capability: platform.developer_archive.read (platform admin / dev tooling)
 *
 * Archive eligibility (read-only classification for the 510 legacy rows):
 *   - owner === platform library owner (first user)
 *   - NOT marketplace official (no meta.official, no chefia-official-* uuid)
 *   - optional future: internal_meta.archive === true
 */

import { httpError } from '../middleware/require-admin.js';

export const DEVELOPER_ARCHIVE_CAPABILITY = 'platform.developer_archive.read';

export function isMarketplaceOfficialRow(record = {}) {
	const meta = record.marketplace_meta && typeof record.marketplace_meta === 'object'
		? record.marketplace_meta
		: {};
	const uuid = String(record.template_uuid || '').trim();
	return record.visibility === 'official'
		|| meta.official === true
		|| uuid.startsWith('chefia-official-');
}

/**
 * Classify whether a row belongs in Developer Archive (not customer Marketplace).
 */
export function isDeveloperArchiveRow(record = {}, platformOwnerId = '') {
	if (!record || typeof record !== 'object') return false;
	if (isMarketplaceOfficialRow(record)) return false;

	const owner = String(record.owner || '').trim();
	const platformId = String(platformOwnerId || '').trim();

	if (platformId && owner === platformId) return true;

	const meta = record.marketplace_meta && typeof record.marketplace_meta === 'object'
		? record.marketplace_meta
		: {};
	if (meta.internal?.archive === true || meta.archive === true) return true;

	return false;
}

/**
 * Phase 1 stub — internal list not wired to routes yet.
 */
export async function listDeveloperArchiveTemplates(_req, _query = {}) {
	throw httpError(501, 'Developer Archive API is not enabled in Phase 1', 'NOT_IMPLEMENTED');
}

export async function getDeveloperArchiveTemplate(_req, _id) {
	throw httpError(501, 'Developer Archive API is not enabled in Phase 1', 'NOT_IMPLEMENTED');
}
