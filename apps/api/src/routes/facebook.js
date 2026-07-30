import { Router } from 'express';
import { pocketbaseAuth } from '../middleware/pocketbase-auth.js';
import { attachWorkspace, requireWorkspaceRead, requireWorkspaceMutation } from '../middleware/product-access.js';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import {
	buildFacebookOAuthAppRedirect,
	completeFacebookOAuthCallback,
	createFacebookOAuthState,
	disconnectFacebookAccount,
	getOwnedFacebookAccountById,
	getOwnedFacebookAccounts,
	mapAccount,
	mapPage,
	refreshFacebookAccessToken,
	setDefaultFacebookAccount,
	setDefaultFacebookPage,
	syncFacebookPagesForOwner,
} from '../services/facebook/api.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

function httpError(status, message, errorCode = 'FACEBOOK_ERROR') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function getOwner(req) {
	return req.workspaceOwnerId || req.pocketbaseUserId || '';
}

/** Public OAuth callback — must stay before auth middleware. */
router.get('/oauth/callback', asyncHandler(async (req, res) => {
	const errorParam = String(req.query.error || '').trim();
	const errorDescription = String(req.query.error_description || req.query.error_message || '').trim();
	if (errorParam) {
		const redirect = await buildFacebookOAuthAppRedirect({
			facebook_error: errorDescription || errorParam || 'OAuth denied',
		});
		return res.redirect(redirect);
	}

	const code = String(req.query.code || '').trim();
	const state = String(req.query.state || '').trim();
	if (!code || !state) {
		const redirect = await buildFacebookOAuthAppRedirect({ facebook_error: 'Missing OAuth code or state' });
		return res.redirect(redirect);
	}

	try {
		const result = await completeFacebookOAuthCallback({ code, state });
		const query = {
			facebook_connected: '1',
			account_id: result.account.id,
		};
		if (result.pagesSyncWarning) query.pages_sync_warning = result.pagesSyncWarning;
		const redirect = await buildFacebookOAuthAppRedirect(query);
		return res.redirect(redirect);
	} catch (error) {
		logger.warn('[facebook-oauth] callback failed', { message: error.message });
		const redirect = await buildFacebookOAuthAppRedirect({
			facebook_error: error.message || 'Facebook connect failed',
		});
		return res.redirect(redirect);
	}
}));

router.use(pocketbaseAuth);
router.use(attachWorkspace);
router.use(requireWorkspaceRead);
router.use(requireWorkspaceMutation(['workspace.facebook.manage', 'workspace.facebook.publish']));

router.post('/oauth/start', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const body = req.body || {};
	const result = await createFacebookOAuthState({
		owner,
		accountId: String(body.accountId || '').trim(),
		requestedLabel: String(body.label || '').trim(),
		workspaceId: req.workspaceId || '',
		returnPath: String(body.returnPath || '').trim(),
		websiteId: String(body.websiteId || '').trim(),
	});
	res.json({
		authUrl: result.authUrl,
		redirectUri: result.redirectUri,
		clientId: result.clientId,
		scopes: result.scopes,
		responseType: result.responseType,
	});
}));

router.post('/accounts/:accountId/reconnect', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const account = await getOwnedFacebookAccountById({ owner, accountId: req.params.accountId, req });
	if (!account) throw httpError(404, 'Facebook account not found');
	const result = await createFacebookOAuthState({
		owner,
		accountId: account.id,
		requestedLabel: account.label || '',
		workspaceId: req.workspaceId || account.workspace || '',
	});
	res.json({
		authUrl: result.authUrl,
		redirectUri: result.redirectUri,
		clientId: result.clientId,
		scopes: result.scopes,
		responseType: result.responseType,
	});
}));

router.get('/accounts', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const filter = String(req.query.filter || '').trim().toLowerCase();
	let accounts = await getOwnedFacebookAccounts(owner, req);

	if (filter === 'connected' || filter === 'active') {
		accounts = accounts.filter((item) => item.connected && (!item.status || item.status === 'connected'));
	} else if (filter === 'expired') {
		accounts = accounts.filter((item) => item.status === 'expired');
	} else if (filter === 'error') {
		accounts = accounts.filter((item) => item.status === 'error' || item.status === 'disconnected');
	}

	const items = await Promise.all(accounts.map(async (account) => {
		const pages = await pocketbaseClient.collection('facebook_pages').getList(1, 1, {
			filter: pocketbaseClient.filter('account = {:account}', { account: account.id }),
			requestKey: null,
		}).catch(() => ({ totalItems: 0 }));
		return {
			...mapAccount(account),
			pageCount: Number(pages.totalItems) || 0,
		};
	}));

	res.json({
		summary: {
			totalAccounts: items.length,
			totalPages: items.reduce((sum, item) => sum + (item.pageCount || 0), 0),
			connectedAccounts: items.filter((item) => item.status === 'connected').length,
		},
		items,
	});
}));

router.patch('/accounts/:accountId', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const account = await getOwnedFacebookAccountById({ owner, accountId: req.params.accountId, req });
	if (!account) throw httpError(404, 'Facebook account not found');
	const label = String(req.body?.label || '').trim().slice(0, 255);
	const updated = await pocketbaseClient.collection('facebook_accounts').update(account.id, { label });
	res.json(mapAccount(updated));
}));

router.post('/accounts/:accountId/default', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const account = await setDefaultFacebookAccount({ owner, accountId: req.params.accountId, req });
	res.json({ account: mapAccount(account) });
}));

router.post('/accounts/:accountId/disconnect', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	await disconnectFacebookAccount({
		owner,
		accountId: req.params.accountId,
		req,
		actor: { id: req.pocketbaseUserId, email: req.pocketbaseUser?.email },
	});
	res.status(204).end();
}));

router.get('/pages', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const accountId = String(req.query.accountId || '').trim();
	if (!accountId) throw httpError(422, 'accountId is required');

	const account = await getOwnedFacebookAccountById({ owner, accountId, req });
	if (!account) throw httpError(404, 'Facebook account not found');

	if (String(req.query.sync || '') === '1') {
		await syncFacebookPagesForOwner({ owner, account });
	}

	const { andWorkspaceScope } = await import('../services/workspace-ownership.js');
	const filter = andWorkspaceScope(req, pocketbaseClient.filter('account = {:account}', { account: accountId }));
	const pages = await pocketbaseClient.collection('facebook_pages').getFullList({
		filter,
		sort: 'name',
	});
	res.json({ items: pages.map(mapPage) });
}));

router.post('/pages/sync', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const accountId = String(req.body?.accountId || '').trim();
	if (!accountId) throw httpError(422, 'accountId is required');
	const account = await getOwnedFacebookAccountById({ owner, accountId, req });
	if (!account) throw httpError(404, 'Facebook account not found');
	const pages = await syncFacebookPagesForOwner({ owner, account });
	res.json({ items: pages.map(mapPage) });
}));

router.post('/accounts/:accountId/pages/:pageId/default', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const page = await setDefaultFacebookPage({
		owner,
		accountId: req.params.accountId,
		pageRecordId: req.params.pageId,
		req,
	});
	res.json(mapPage(page));
}));

router.post('/token/refresh', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const accountId = String(req.body?.accountId || '').trim();
	if (!accountId) throw httpError(422, 'accountId is required');
	const account = await getOwnedFacebookAccountById({ owner, accountId, req });
	if (!account) throw httpError(404, 'Facebook account not found');
	const refreshed = await refreshFacebookAccessToken({ account });
	res.json({
		ok: true,
		accountId: refreshed.id,
		tokenExpiresAt: refreshed.token_expires_at || '',
		account: mapAccount(refreshed),
	});
}));

export default router;
