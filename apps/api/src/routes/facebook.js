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
import {
	FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
	facebookOAuthCallbackBrowserError,
	facebookOAuthCallbackFailureLog,
	facebookOAuthProviderDeniedBrowserError,
	facebookOAuthProviderDeniedLog,
} from '../services/facebook/workspace-isolation.js';
import {
	assertFacebookAccountConnected,
	getFacebookDestination,
	listFacebookDestinations,
	mapLegacyPageItem,
	validateFacebookDestinationPost,
} from '../services/facebook/destinations.js';
import {
	mapFacebookPublishJobDto,
	prepareFacebookPublishJob,
} from '../services/facebook/publish.js';
import { persistFacebookPublishJobWithCreatedEvent } from '../services/facebook/publish-persist.js';
import { throwForFacebookPublishValidation } from '../services/facebook/publish-validation.js';
import { scheduleFacebookPublishJobs } from '../services/facebook/schedule.js';
import {
	cancelFacebookPublishJob,
	publishNowFacebookPublishJob,
	rescheduleFacebookPublishJob,
	retryFacebookPublishJob,
} from '../services/facebook/job-mutations.js';
import { listFacebookPublishingHistory } from '../services/facebook/history.js';
import { getFacebookPublishingAnalytics } from '../services/facebook/analytics.js';
import { andWorkspaceScope, recordBelongsToWorkspace } from '../services/workspace-ownership.js';
import { safeGetList } from '../utils/pocketbase-safe-query.js';

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

function normalizePositiveInt(value, fallback, max = 200) {
	const parsed = Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return Math.min(parsed, max);
}

function throwForPublishValidation(result = {}) {
	throwForFacebookPublishValidation(result);
}

async function getOwnedFacebookPublishJob(req, jobId) {
	const owner = getOwner(req);
	const job = await pocketbaseClient.collection('facebook_publish_jobs').getOne(jobId, { requestKey: null }).catch(() => null);
	if (!job) {
		throw httpError(404, 'Facebook publish job not found', 'FACEBOOK_PUBLISH_JOB_NOT_FOUND');
	}
	if (job.owner !== owner) {
		throw httpError(403, 'You do not have access to this Facebook publish job', 'FORBIDDEN');
	}
	if (!recordBelongsToWorkspace(req, job)) {
		throw httpError(403, 'You do not have access to this Facebook publish job', 'FORBIDDEN');
	}
	return job;
}

/** Public OAuth callback — must stay before auth middleware. */
router.get('/oauth/callback', asyncHandler(async (req, res) => {
	const errorParam = String(req.query.error || '').trim();
	const hasErrorDescription = Boolean(String(req.query.error_description || req.query.error_message || '').trim());
	if (errorParam) {
		logger.warn('[facebook-oauth] provider denied', facebookOAuthProviderDeniedLog({
			hasError: true,
			hasErrorDescription,
		}));
		const redirect = await buildFacebookOAuthAppRedirect({
			facebook_error: facebookOAuthProviderDeniedBrowserError(),
		});
		return res.redirect(redirect);
	}

	const code = String(req.query.code || '').trim();
	const state = String(req.query.state || '').trim();
	if (!code || !state) {
		const redirect = await buildFacebookOAuthAppRedirect({
			facebook_error: FACEBOOK_OAUTH_CALLBACK_FAILED_MESSAGE,
		});
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
		logger.warn('[facebook-oauth] callback failed', facebookOAuthCallbackFailureLog(error));
		const redirect = await buildFacebookOAuthAppRedirect({
			facebook_error: facebookOAuthCallbackBrowserError(error),
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
		workspaceId: req.workspace?.id || '',
		workspaceKey: req.workspaceKey || '',
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
		workspaceId: req.workspace?.id || '',
		workspaceKey: req.workspaceKey || '',
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
	res.json({ items: pages.map((page) => mapLegacyPageItem(page, account)) });
}));

router.get('/destinations', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const accountId = String(req.query.accountId || '').trim();
	if (!accountId) throw httpError(422, 'accountId is required');

	const account = await getOwnedFacebookAccountById({ owner, accountId, req });
	if (!account) throw httpError(404, 'Facebook account not found');

	if (String(req.query.sync || '') === '1') {
		const connectedAccount = await assertFacebookAccountConnected({ owner, accountId, req });
		await syncFacebookPagesForOwner({ owner, account: connectedAccount });
	}

	const result = await listFacebookDestinations({ owner, accountId, req });
	if (!result) throw httpError(404, 'Facebook account not found');
	res.json(result);
}));

router.post('/destinations/validate', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const body = req.body || {};
	const accountId = String(body.accountId || '').trim();
	const pageId = String(body.pageId || '').trim();
	const post = body.post && typeof body.post === 'object' ? body.post : {};

	const result = await validateFacebookDestinationPost({
		owner,
		accountId,
		pageId,
		post,
		req,
	});
	res.json(result);
}));

router.get('/destinations/:destinationId', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const destination = await getFacebookDestination({
		owner,
		destinationId: req.params.destinationId,
		req,
	});
	if (!destination) throw httpError(404, 'Facebook destination not found');
	res.json(destination);
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

router.post('/publish', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const body = req.body || {};
	const accountId = String(body.accountId || '').trim();
	const pageId = String(body.pageId || '').trim();
	const aiPinId = String(body.aiPinId || body.ai_pin || '').trim();
	const post = body.post && typeof body.post === 'object' ? body.post : {};
	const timezone = String(body.timezone || 'UTC').trim() || 'UTC';

	if (!accountId) throw httpError(422, 'accountId is required', 'FACEBOOK_ACCOUNT_ID_REQUIRED');
	if (!pageId) throw httpError(422, 'pageId is required', 'FACEBOOK_PAGE_ID_REQUIRED');

	const prepared = await prepareFacebookPublishJob({
		owner,
		accountId,
		pageId,
		aiPinId,
		post,
		timezone,
		scheduledAt: new Date().toISOString(),
		req,
	});
	throwForPublishValidation(prepared);

	const job = await persistFacebookPublishJobWithCreatedEvent({
		prepared,
		publishMode: 'now',
	});

	res.status(201).json(mapFacebookPublishJobDto(job));
}));

router.post('/schedule', asyncHandler(async (req, res) => {
	const owner = getOwner(req);
	const body = req.body || {};
	const timezone = String(body.timezone || '').trim();
	const scheduledAt = body.scheduledAt ?? body.scheduled_at;
	const post = body.post && typeof body.post === 'object' ? body.post : {};
	const aiPinIds = body.aiPinIds ?? (body.aiPinId || body.ai_pin ? [body.aiPinId || body.ai_pin] : null);

	const result = await scheduleFacebookPublishJobs({
		owner,
		aiPinIds,
		accountId: String(body.accountId || '').trim(),
		pageId: String(body.pageId || '').trim(),
		timezone,
		scheduledAt,
		post,
		perPinTargets: body.perPinTargets,
		req,
	});

	res.status(201).json(result);
}));

router.get('/history', asyncHandler(async (req, res) => {
	const payload = await listFacebookPublishingHistory(req, req.query || {});
	res.json(payload);
}));

router.get('/analytics', asyncHandler(async (req, res) => {
	const payload = await getFacebookPublishingAnalytics(req);
	res.json(payload);
}));

router.get('/jobs', asyncHandler(async (req, res) => {
	const page = normalizePositiveInt(req.query.page, 1);
	const perPage = normalizePositiveInt(req.query.perPage, 20, 100);
	const accountId = String(req.query.accountId || '').trim();
	const aiPinId = String(req.query.aiPinId || req.query.ai_pin || '').trim();
	const pageId = String(req.query.pageId || req.query.page_id || '').trim();
	const status = String(req.query.status || '').trim();

	const filters = [];
	if (accountId) {
		filters.push(pocketbaseClient.filter('account = {:accountId}', { accountId }));
	}
	if (aiPinId) {
		filters.push(pocketbaseClient.filter('ai_pin = {:aiPinId}', { aiPinId }));
	}
	if (pageId) {
		filters.push(pocketbaseClient.filter('page_id = {:pageId}', { pageId }));
	}
	if (status) {
		filters.push(pocketbaseClient.filter('status = {:status}', { status }));
	}

	const filter = andWorkspaceScope(req, filters.length ? filters.join(' && ') : '');

	const result = await safeGetList({
		collection: 'facebook_publish_jobs',
		context: 'facebook:list-publish-jobs',
		page,
		perPage,
		sort: '-scheduled_at,-created',
		filter,
	});

	res.json({
		page: result.page,
		perPage: result.perPage,
		totalItems: result.totalItems,
		totalPages: result.totalPages,
		items: result.items.map((item) => mapFacebookPublishJobDto(item)),
	});
}));

router.get('/jobs/:jobId', asyncHandler(async (req, res) => {
	const job = await getOwnedFacebookPublishJob(req, req.params.jobId);
	res.json(mapFacebookPublishJobDto(job));
}));

router.patch('/jobs/:jobId', asyncHandler(async (req, res) => {
	const result = await rescheduleFacebookPublishJob({
		req,
		jobId: req.params.jobId,
		body: req.body || {},
	});
	res.json(result.job);
}));

router.post('/jobs/:jobId/cancel', asyncHandler(async (req, res) => {
	const result = await cancelFacebookPublishJob({
		req,
		jobId: req.params.jobId,
	});
	res.json({ ok: true, job: result.job });
}));

router.post('/jobs/:jobId/retry', asyncHandler(async (req, res) => {
	const result = await retryFacebookPublishJob({
		req,
		jobId: req.params.jobId,
	});
	res.json({ ok: true, job: result.job });
}));

router.post('/jobs/:jobId/publish-now', asyncHandler(async (req, res) => {
	const result = await publishNowFacebookPublishJob({
		req,
		jobId: req.params.jobId,
	});
	res.json({ ok: true, job: result.job });
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
