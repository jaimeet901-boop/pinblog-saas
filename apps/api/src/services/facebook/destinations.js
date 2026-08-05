/**
 * Facebook Channel Pack — destination read service + DTO mapping (F3-2).
 * Read-only; no Graph writes; tokens never exposed in DTOs.
 */

import { analyzeGrantedScopes, REQUIRED_PAGE_SCOPES } from './scopes.js';
import { validateFacebookDestinationReady } from './validators.js';

const DTO_KEYS = new Set([
	'id',
	'pageId',
	'accountId',
	'name',
	'category',
	'thumbnailUrl',
	'fanCount',
	'isDefault',
	'connected',
	'websiteId',
	'updatedAt',
	'accountLabel',
	'accountUsername',
	'accountStatus',
	'tasks',
	'permissions',
	'publishReadiness',
	'boardId',
]);

function normalizeTasks(value) {
	if (!Array.isArray(value)) return [];
	return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeDate(value) {
	if (!value) return '';
	const ms = new Date(value).getTime();
	return Number.isFinite(ms) ? new Date(ms).toISOString() : String(value);
}

/**
 * True when an encrypted page token entry exists (ciphertext only — never decrypted).
 */
export function accountHasPageToken(account = {}, pageId = '') {
	const key = String(pageId || '').trim();
	if (!key) return false;
	const tokens = account?.page_tokens;
	if (!tokens || typeof tokens !== 'object') return false;
	return Boolean(String(tokens[key] || '').trim());
}

function resolveAccountContext(account = {}) {
	return {
		accountLabel: String(account.label || '').trim(),
		accountUsername: String(account.username || '').trim(),
		accountStatus: String(account.status || account.accountStatus || (account.connected ? 'connected' : 'error')).trim(),
	};
}

function mapPermissions(readiness) {
	const perms = readiness.permissions || {};
	return {
		canPublish: Boolean(perms.canPublish),
		hasPageToken: Boolean(perms.hasPageToken),
		hasRequiredScopes: Boolean(perms.hasRequiredScopes),
		blockedReasons: [...(perms.blockedReasons || [])],
	};
}

/**
 * Map a facebook_pages row (+ account context) to canonical FacebookDestinationDto.
 *
 * @param {object} page
 * @param {object} [account]
 * @param {{ hasPageToken?: boolean }} [options]
 */
export function mapFacebookDestination(page = {}, account = {}, options = {}) {
	const pageId = String(page.page_id || page.pageId || '').trim();
	const accountId = String(page.account || account.id || account.accountId || '').trim();
	const hasPageToken = options.hasPageToken ?? accountHasPageToken(account, pageId);

	const readiness = validateFacebookDestinationReady({
		account,
		page,
		hasPageToken,
	});

	const dto = {
		id: String(page.id || '').trim(),
		pageId,
		accountId,
		name: String(page.name || '').trim() || 'Untitled Page',
		category: String(page.category || '').trim(),
		thumbnailUrl: String(page.thumbnail_url || page.thumbnailUrl || '').trim(),
		fanCount: Number(page.fan_count ?? page.fanCount) || 0,
		isDefault: Boolean(page.is_default ?? page.isDefault),
		connected: page.connected !== false,
		websiteId: String(page.websiteId || page.website_id || '').trim(),
		updatedAt: normalizeDate(page.updated || page.updatedAt),
		...resolveAccountContext(account),
		tasks: normalizeTasks(page.tasks),
		permissions: mapPermissions(readiness),
		publishReadiness: {
			ready: Boolean(readiness.ready),
			reasons: [...(readiness.reasons || [])],
		},
		boardId: pageId,
	};

	return Object.fromEntries(Object.entries(dto).filter(([key]) => DTO_KEYS.has(key)));
}

/**
 * Build list envelope from account + page rows (pure).
 */
export function buildDestinationsListResponse(account = {}, pages = []) {
	const scopeAnalysis = analyzeGrantedScopes({
		requested: REQUIRED_PAGE_SCOPES,
		granted: account.scope || account.scopes || '',
	});

	const accountConnected = Boolean(account.connected)
		&& (!account.status || account.status === 'connected');
	const unavailable = !accountConnected || account.status === 'expired';

	let message;
	if (account.status === 'expired') {
		message = 'Facebook account token has expired. Reconnect to load Pages.';
	} else if (!accountConnected) {
		message = 'Facebook account is not connected.';
	}

	const items = (pages || []).map((page) => mapFacebookDestination(page, account));

	return {
		accountId: String(account.id || '').trim(),
		account: {
			id: String(account.id || '').trim(),
			label: String(account.label || '').trim(),
			status: String(account.status || '').trim(),
			connected: Boolean(account.connected),
			scopesOk: scopeAnalysis.ok,
			missingScopes: [...scopeAnalysis.missing],
		},
		syncedAt: account.last_sync_at ? normalizeDate(account.last_sync_at) : null,
		items,
		unavailable,
		...(message ? { message } : {}),
	};
}

async function resolveDestinationDeps(deps = {}) {
	let getOwnedFacebookAccountById = deps.getOwnedFacebookAccountById;
	if (!getOwnedFacebookAccountById) {
		({ getOwnedFacebookAccountById } = await import('./api.js'));
	}
	const pb = deps.pocketbaseClient || (await import('../../utils/pocketbaseClient.js')).default;
	let andWorkspaceScope = deps.andWorkspaceScope;
	let recordBelongsToWorkspace = deps.recordBelongsToWorkspace;
	if (!andWorkspaceScope || !recordBelongsToWorkspace) {
		const workspaceOwnership = await import('../workspace-ownership.js');
		andWorkspaceScope = andWorkspaceScope || workspaceOwnership.andWorkspaceScope;
		recordBelongsToWorkspace = recordBelongsToWorkspace || workspaceOwnership.recordBelongsToWorkspace;
	}
	return {
		getOwnedFacebookAccountById,
		pocketbaseClient: pb,
		andWorkspaceScope,
		recordBelongsToWorkspace,
	};
}

/**
 * List Facebook Page destinations for an owned account (read-only).
 *
 * @param {{ owner: string, accountId: string, req?: object, deps?: object }} input
 * @returns {Promise<object|null>} null when account not found / not owned
 */
export async function listFacebookDestinations({ owner, accountId, req = null, deps = null } = {}) {
	const id = String(accountId || '').trim();
	if (!owner || !id) return null;

	const {
		getOwnedFacebookAccountById,
		pocketbaseClient: pb,
		andWorkspaceScope,
	} = await resolveDestinationDeps(deps || {});

	const account = await getOwnedFacebookAccountById({ owner, accountId: id, req });
	if (!account) return null;

	const filter = req
		? andWorkspaceScope(req, pb.filter('account = {:account}', { account: id }))
		: pb.filter('owner = {:owner} && account = {:account}', { owner, account: id });

	const pages = await pb.collection('facebook_pages').getFullList({
		filter,
		sort: 'name',
		requestKey: null,
	}).catch(() => []);

	return buildDestinationsListResponse(account, pages);
}

/**
 * Resolve a single Facebook Page destination by PocketBase record id (read-only).
 *
 * @param {{ owner: string, destinationId: string, req?: object, deps?: object }} input
 * @returns {Promise<object|null>}
 */
export async function getFacebookDestination({ owner, destinationId, req = null, deps = null } = {}) {
	const pageRecordId = String(destinationId || '').trim();
	if (!owner || !pageRecordId) return null;

	const {
		getOwnedFacebookAccountById,
		pocketbaseClient: pb,
		recordBelongsToWorkspace,
	} = await resolveDestinationDeps(deps || {});

	const page = await pb.collection('facebook_pages').getOne(pageRecordId, {
		requestKey: null,
	}).catch(() => null);
	if (!page) return null;

	if (req) {
		if (!recordBelongsToWorkspace(page, req)) return null;
	} else if (String(page.owner || '') !== String(owner)) {
		return null;
	}

	const accountId = String(page.account || '').trim();
	if (!accountId) return null;

	const account = await getOwnedFacebookAccountById({ owner, accountId, req });
	if (!account) return null;

	return mapFacebookDestination(page, account);
}
