/**
 * Facebook Channel Pack — pure destination/post validators (F3-1).
 * No PocketBase, Graph, or route dependencies.
 */

import { normalizeDestinationUrl } from '../../utils/pin-publish-destination.js';
import { analyzeGrantedScopes, REQUIRED_PAGE_SCOPES } from './scopes.js';

/** Meta Page tasks required to publish feed posts (Graph /me/accounts tasks snapshot). */
export const REQUIRED_PAGE_TASKS = Object.freeze(['CREATE_CONTENT']);

const FACEBOOK_MESSAGE_MAX_LENGTH = 63206;

function normalizeTasks(value) {
	if (Array.isArray(value)) {
		return value.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean);
	}
	return [];
}

function normalizeScopeString(account = {}) {
	return String(account.scope || account.scopes || '').trim();
}

function isAccountConnected(account = {}) {
	if (!account || account.connected === false) return false;
	const status = String(account.status || account.accountStatus || '').trim().toLowerCase();
	if (status === 'expired' || status === 'error' || status === 'disconnected') return false;
	return true;
}

function isPageConnected(page = {}) {
	if (!page) return false;
	return page.connected !== false;
}

function resolvePageId(page = {}) {
	return String(page.page_id || page.pageId || '').trim();
}

function resolveAccountId(account = {}) {
	return String(account.id || account.accountId || '').trim();
}

/**
 * Derive publish permission flags from page tasks, OAuth scopes, and token presence.
 *
 * @param {{
 *   tasks?: string[],
 *   grantedScopes?: string,
 *   scope?: string,
 *   scopes?: string,
 *   hasPageToken?: boolean,
 *   accountStatus?: string,
 *   status?: string,
 *   accountConnected?: boolean,
 * }} input
 */
export function derivePagePermissions(input = {}) {
	const tasks = normalizeTasks(input.tasks);
	const scopeAnalysis = analyzeGrantedScopes({
		requested: REQUIRED_PAGE_SCOPES,
		granted: input.grantedScopes ?? input.scope ?? input.scopes ?? '',
	});
	const hasPageToken = Boolean(input.hasPageToken);
	const hasRequiredScopes = scopeAnalysis.ok;
	const missingTasks = REQUIRED_PAGE_TASKS.filter((task) => !tasks.includes(task));
	const hasRequiredTasks = missingTasks.length === 0;

	const accountStatus = String(input.accountStatus ?? input.status ?? '').trim().toLowerCase();
	const blockedReasons = [];

	if (input.accountConnected === false) {
		blockedReasons.push('Facebook account is not connected');
	}
	if (accountStatus === 'expired') {
		blockedReasons.push('Facebook account token has expired');
	} else if (accountStatus === 'error' || accountStatus === 'disconnected') {
		blockedReasons.push('Facebook account is not connected');
	}
	if (!hasRequiredScopes) {
		blockedReasons.push(`Missing OAuth scopes: ${scopeAnalysis.missing.join(', ')}`);
	}
	if (!hasRequiredTasks) {
		blockedReasons.push(`Missing page tasks: ${missingTasks.join(', ')}`);
	}
	if (!hasPageToken) {
		blockedReasons.push('Page access token is missing');
	}

	const accountUsable = input.accountConnected !== false
		&& accountStatus !== 'expired'
		&& accountStatus !== 'error'
		&& accountStatus !== 'disconnected';

	const canPublish = accountUsable && hasRequiredScopes && hasRequiredTasks && hasPageToken;

	return {
		canPublish,
		hasPageToken,
		hasRequiredScopes,
		hasRequiredTasks,
		missingScopes: scopeAnalysis.missing,
		missingTasks,
		blockedReasons,
	};
}

/**
 * Validate a Facebook Page destination is ready for publish (read/preflight only).
 *
 * @param {{
 *   account?: object,
 *   page?: object,
 *   hasPageToken?: boolean,
 * }} input
 */
export function validateFacebookDestinationReady(input = {}) {
	const account = input.account || {};
	const page = input.page || {};
	const reasons = [];

	const accountConnected = isAccountConnected(account);
	if (!accountConnected) {
		reasons.push('Facebook account is not connected');
	}

	const pageConnected = isPageConnected(page);
	if (!pageConnected) {
		reasons.push('Facebook Page is not connected');
	}

	const pageId = resolvePageId(page);
	if (!pageId) {
		reasons.push('Facebook Page id is missing');
	}

	const permissions = derivePagePermissions({
		tasks: page.tasks,
		grantedScopes: normalizeScopeString(account),
		hasPageToken: Boolean(input.hasPageToken),
		accountStatus: account.status || account.accountStatus,
		accountConnected,
	});

	for (const reason of permissions.blockedReasons) {
		if (!reasons.includes(reason)) reasons.push(reason);
	}

	const ready = accountConnected && pageConnected && Boolean(pageId) && permissions.canPublish;

	return {
		ready,
		reasons,
		permissions,
	};
}

/**
 * Validate studio post payload + destination selection for Facebook publish readiness.
 *
 * @param {{
 *   post?: object,
 *   account?: object,
 *   page?: object,
 *   hasPageToken?: boolean,
 *   destinationReadiness?: { ready?: boolean, reasons?: string[] },
 * }} input
 */
export function validateFacebookPostForPublish(input = {}) {
	const post = input.post || {};
	const account = input.account || {};
	const page = input.page || {};
	const errors = [];
	const warnings = [];

	const message = String(post.message ?? post.caption ?? post.title ?? post.body ?? '').trim();
	const rawImageUrl = String(post.imageUrl ?? post.image_url ?? '').trim();
	const rawLinkUrl = String(post.linkUrl ?? post.link_url ?? post.destinationUrl ?? post.destination_url ?? post.sourceUrl ?? post.source_url ?? '').trim();
	const imageUrl = rawImageUrl ? normalizeDestinationUrl(rawImageUrl) : '';
	const linkUrl = rawLinkUrl ? normalizeDestinationUrl(rawLinkUrl) : '';

	const accountId = String(post.accountId ?? post.account_id ?? account.id ?? account.accountId ?? '').trim();
	const pageId = String(post.pageId ?? post.page_id ?? page.pageId ?? page.page_id ?? '').trim();

	if (!accountId) {
		errors.push('Facebook account is required');
	}
	if (!pageId) {
		errors.push('Facebook Page is required');
	}

	if (!message && !rawImageUrl && !rawLinkUrl) {
		errors.push('Post content is required (message, image, or link)');
	}
	if (message.length > FACEBOOK_MESSAGE_MAX_LENGTH) {
		errors.push(`Message exceeds ${FACEBOOK_MESSAGE_MAX_LENGTH} characters`);
	}
	if (rawImageUrl && !imageUrl) {
		errors.push('Image URL must be a valid http(s) URL');
	}
	if (rawLinkUrl && !linkUrl) {
		errors.push('Link URL must be a valid http(s) URL');
	}

	if (message && !rawImageUrl && !rawLinkUrl) {
		warnings.push('Text-only posts are supported; add an image or link for richer posts');
	}

	const destinationReadiness = input.destinationReadiness
		|| validateFacebookDestinationReady({
			account,
			page,
			hasPageToken: input.hasPageToken,
		});

	if (!destinationReadiness.ready) {
		for (const reason of destinationReadiness.reasons || []) {
			const label = `Destination not ready: ${reason}`;
			if (!errors.includes(label)) errors.push(label);
		}
	}

	return {
		ok: errors.length === 0,
		errors,
		warnings,
		normalized: {
			message,
			linkUrl,
			imageUrl,
			pageId,
			accountId,
		},
	};
}
