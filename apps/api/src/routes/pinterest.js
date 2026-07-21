import { Router } from 'express';
import { pocketbaseAuth } from '../middleware/pocketbase-auth.js';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import {
	createPinterestOAuthState,
	ensureValidPinterestAccessToken,
	exchangeOAuthCodeForTokens,
	fetchPinterestProfile,
	getOwnedPinterestAccountById,
	getOwnedPinterestAccountByPinterestUserId,
	getOwnedPinterestAccounts,
	getOwnedPinterestAccount,
	getOwnedPinterestBoard,
	getPinterestRedirectUri,
	getWebAppBaseUrl,
	markPinterestAccountStatus,
	mapAccount,
	mapBoard,
	normalizePinterestError,
	syncPinterestBoardsForOwner,
} from '../services/pinterest-api.js';
import { decryptSecret, encryptSecret } from '../utils/secretCrypto.js';
import {
	buildSchemaSafeFilter,
	safeGetFirstListItem,
	safeGetFullList,
	safeGetList,
	sanitizeCollectionPayload,
	verifyCollectionFields,
} from '../utils/pocketbase-safe-query.js';
import { listPublishProviders, setPublishProvider, PinterestPublishProvider } from '../services/publish-providers/index.js';

const router = Router();
const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;

setPublishProvider(new PinterestPublishProvider({
	createJobs: async ({ pins, mode, ...options }) => ({
		provider: 'pinterest',
		mode,
		pins,
		options,
	}),
}));

function httpError(status, message, extras = {}) {
	const error = new Error(message);
	error.status = status;
	Object.assign(error, extras);
	return error;
}

function normalizeString(value, fieldName, { max = 0, required = false } = {}) {
	if (value == null) {
		if (required) {
			throw httpError(422, `${fieldName} is required`);
		}
		return '';
	}

	if (typeof value !== 'string') {
		throw httpError(422, `${fieldName} must be a string`);
	}

	const normalized = value.trim();
	if (required && !normalized) {
		throw httpError(422, `${fieldName} is required`);
	}

	if (max > 0 && normalized.length > max) {
		throw httpError(422, `${fieldName} must be ${max} characters or less`);
	}

	return normalized;
}

function normalizeDateTime(value, fieldName) {
	const normalized = normalizeString(value, fieldName, { required: true, max: 80 });
	const date = new Date(normalized);
	if (Number.isNaN(date.getTime())) {
		throw httpError(422, `${fieldName} must be a valid date/time`);
	}
	return date.toISOString();
}

function normalizePositiveInt(value, fallback, max = 200) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return Math.min(parsed, max);
}

function normalizePinIds(value) {
	if (!Array.isArray(value) || value.length === 0) {
		throw httpError(422, 'pinIds must be a non-empty array');
	}

	const ids = value
		.map((item) => (typeof item === 'string' ? item.trim() : ''))
		.filter(Boolean);

	if (ids.length === 0) {
		throw httpError(422, 'pinIds must contain valid ids');
	}

	return [...new Set(ids)];
}

function normalizeObject(value, fieldName) {
	if (value == null) {
		return {};
	}
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw httpError(422, `${fieldName} must be an object`);
	}
	return value;
}

async function getOwnedAIPins({ owner, pinIds }) {
	const pins = await Promise.all(pinIds.map((pinId) => pocketbaseClient.collection('ai_pins').getOne(pinId).catch(() => null)));
	const filtered = pins.filter(Boolean);
	if (filtered.length !== pinIds.length) {
		throw httpError(404, 'One or more selected pins were not found');
	}

	for (const pin of filtered) {
		if (pin.owner !== owner) {
			throw httpError(403, 'You do not have access to one or more selected pins');
		}
	}

	return filtered;
}

function mapJob(record, pinRecord = null) {
	return {
		id: record.id,
		aiPinId: record.ai_pin,
		accountId: record.account || '',
		accountLabel: record.account_label || '',
		accountUsername: record.account_username || '',
		websiteId: record.websiteId || '',
		articleId: record.articleId || '',
		boardId: record.board_id,
		boardName: record.board_name || '',
		scheduledAt: record.scheduled_at,
		timezone: record.timezone || '',
		status: record.status,
		attemptCount: record.attempt_count || 0,
		maxAttempts: record.max_attempts || 3,
		nextRetryAt: record.next_retry_at || '',
		lastError: record.last_error || '',
		pinterestPinId: record.pinterest_pin_id || '',
		pinterestPinUrl: record.pinterest_pin_url || '',
		publishedAt: record.published_at || '',
		performance: record.performance || {
			impressions: null,
			saves: null,
			outboundClicks: null,
			closeups: null,
			readyForAnalyticsSync: true,
		},
		createdAt: record.created,
		updatedAt: record.updated,
		pin: pinRecord
			? {
				id: pinRecord.id,
				title: pinRecord.title,
				description: pinRecord.description,
				overlayText: pinRecord.overlay_text,
				imageUrl: pinRecord.image_url || '',
				status: pinRecord.status,
			}
			: null,
	};
}

async function assertPinterestConnected(owner, accountId = '') {
	const account = accountId
		? await getOwnedPinterestAccountById({ owner, accountId })
		: await getOwnedPinterestAccount(owner);

	if (!account) {
		throw httpError(401, 'Pinterest account is not connected');
	}
	if (!account.connected || account.status !== 'connected') {
		throw httpError(401, 'Selected Pinterest account is not connected');
	}
	return account;
}

async function resolveTargetForPin({ owner, pin, defaultTarget, perPinTargets }) {
	const override = perPinTargets?.[pin.id] || {};
	const targetBoardId = normalizeString(override.boardId || defaultTarget.boardId || '', 'boardId', { required: true, max: 120 });
	const requestedAccountId = normalizeString(override.accountId || defaultTarget.accountId || '', 'accountId', { max: 80 });

	let account;
	let board;

	if (requestedAccountId) {
		account = await assertPinterestConnected(owner, requestedAccountId);
		board = await getOwnedPinterestBoard({ owner, boardId: targetBoardId, accountId: account.id });
	} else {
		board = await getOwnedPinterestBoard({ owner, boardId: targetBoardId });
		account = await assertPinterestConnected(owner, board.account);
	}

	return {
		account,
		board,
	};
}

async function createPublishJobs({ owner, pinIds, defaultTarget, perPinTargets, scheduledAt, timezone }) {
	const pins = await getOwnedAIPins({ owner, pinIds });
	const jobs = [];

	for (const pin of pins) {
		const existingFilter = await buildSchemaSafeFilter({
			collection: 'pinterest_publish_jobs',
			context: 'pinterest:create-publish-jobs:existing-active',
			parts: [
				{ field: 'owner', expression: pocketbaseClient.filter('owner = {:owner}', { owner }) },
				{ field: 'ai_pin', expression: pocketbaseClient.filter('ai_pin = {:pinId}', { pinId: pin.id }) },
				{ field: 'status', expression: '(status = "scheduled" || status = "publishing")' },
			],
		});

		const existingActiveJob = await safeGetFirstListItem({
			collection: 'pinterest_publish_jobs',
			context: 'pinterest:create-publish-jobs:existing-active',
			filter: existingFilter.filter,
		});

		if (existingActiveJob) {
			jobs.push(existingActiveJob);
			continue;
		}

		if (!['draft', 'failed'].includes(pin.status)) {
			throw httpError(422, 'Only Draft or Failed pins can be scheduled/published');
		}
		if (!String(pin.image_url || '').trim()) {
			throw httpError(422, `Pin "${pin.title || pin.id}" must have an image URL before publishing`);
		}

		const { account, board } = await resolveTargetForPin({
			owner,
			pin,
			defaultTarget,
			perPinTargets,
		});

		const createPayload = await sanitizeCollectionPayload({
			collection: 'pinterest_publish_jobs',
			context: 'pinterest:create-publish-job',
			payload: {
				owner,
				account: account.id,
				account_label: account.label || account.account_name || account.username || '',
				account_username: account.username || '',
				ai_pin: pin.id,
				websiteId: pin.websiteId || '',
				articleId: pin.articleId || '',
				board_id: board.board_id,
				board_name: board.name,
				scheduled_at: scheduledAt,
				timezone,
				status: 'scheduled',
				attempt_count: 0,
				max_attempts: 3,
				next_retry_at: '',
				last_error: '',
			},
		});

		const job = await pocketbaseClient.collection('pinterest_publish_jobs').create(createPayload);

		await pocketbaseClient.collection('ai_pins').update(pin.id, {
			status: 'scheduled',
			scheduled_at: scheduledAt,
			scheduled_timezone: timezone,
			pinterest_account_id: account.id,
			pinterest_account_label: account.label || account.account_name || account.username || '',
			pinterest_board_id: board.board_id,
			pinterest_board_name: board.name,
			publish_job_id: job.id,
			publish_error: '',
		});

		await pocketbaseClient.collection('pinterest_publish_events').create({
			owner,
			job: job.id,
			event_type: 'scheduled',
			message: 'Pin scheduled for publishing',
			payload: { scheduledAt, timezone, boardId: board.board_id, accountId: account.id },
		});

		jobs.push(job);
	}

	return jobs;
}

async function buildAccountStats(owner) {
	const ownerPublishedFilter = await buildSchemaSafeFilter({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:account-stats:published',
		parts: [
			{ field: 'owner', expression: pocketbaseClient.filter('owner = {:owner}', { owner }) },
			{ field: 'status', expression: pocketbaseClient.filter('status = {:status}', { status: 'published' }) },
		],
	});

	const [accounts, boards, publishedJobsCount] = await Promise.all([
		getOwnedPinterestAccounts(owner),
		pocketbaseClient.collection('pinterest_boards').getFullList({
			filter: pocketbaseClient.filter('owner = {:owner}', { owner }),
		}),
		safeGetList({
			collection: 'pinterest_publish_jobs',
			context: 'pinterest:account-stats:published-count',
			page: 1,
			perPage: 1,
			filter: ownerPublishedFilter.filter,
		}),
	]);

	const publishedJobs = await safeGetFullList({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:account-stats:published-items',
		filter: ownerPublishedFilter.filter,
	});

	const boardsByAccount = new Map();
	for (const board of boards) {
		boardsByAccount.set(board.account, (boardsByAccount.get(board.account) || 0) + 1);
	}

	const publishedByAccount = new Map();
	for (const job of publishedJobs) {
		publishedByAccount.set(job.account, (publishedByAccount.get(job.account) || 0) + 1);
	}

	const accountItems = accounts.map((account) => ({
		...mapAccount(account),
		boardCount: boardsByAccount.get(account.id) || 0,
		publishedPins: publishedByAccount.get(account.id) || 0,
	}));

	return {
		items: accountItems,
		summary: {
			totalAccounts: accountItems.length,
			totalBoards: boards.length,
			totalPublishedPins: publishedJobsCount.totalItems,
		},
	};
}

router.get('/oauth/callback', async (req, res) => {
	const callbackError = normalizeString(req.query.error, 'error', { max: 400 });
	const webAppBase = getWebAppBaseUrl();

	if (callbackError) {
		const reason = encodeURIComponent(normalizeString(req.query.error_description, 'error_description', { max: 1000 }) || callbackError);
		return res.redirect(`${webAppBase}/app/pinterest?pinterest_error=${reason}`);
	}

	const code = normalizeString(req.query.code, 'code', { required: true, max: 400 });
	const state = normalizeString(req.query.state, 'state', { required: true, max: 400 });

	try {
		const stateRecord = await pocketbaseClient.collection('pinterest_oauth_states').getFirstListItem(
			pocketbaseClient.filter('state = {:state}', { state }),
		).catch(() => null);

		if (!stateRecord) {
			throw httpError(400, 'Invalid OAuth state');
		}
		if (stateRecord.used) {
			throw httpError(400, 'OAuth state already used');
		}
		if (new Date(stateRecord.expires_at).getTime() < Date.now()) {
			throw httpError(400, 'OAuth state expired');
		}

		const tokenPayload = await exchangeOAuthCodeForTokens({
			code,
			redirectUri: getPinterestRedirectUri(),
		});

		const accessToken = normalizeString(tokenPayload.access_token, 'access_token', { required: true, max: 4000 });
		const refreshToken = normalizeString(tokenPayload.refresh_token, 'refresh_token', { required: true, max: 4000 });
		const expiresAt = tokenPayload.expires_in
			? new Date(Date.now() + Number(tokenPayload.expires_in) * 1000).toISOString()
			: '';
		const scope = normalizeString(tokenPayload.scope, 'scope', { max: 1000 });
		const profile = await fetchPinterestProfile({ accessToken });

		const requestedLabel = normalizeString(stateRecord.requested_label, 'requested_label', { max: 255 });
		const reconnectAccountId = normalizeString(stateRecord.account_id, 'account_id', { max: 80 });
		const reconnectAccount = reconnectAccountId
			? await getOwnedPinterestAccountById({ owner: stateRecord.owner, accountId: reconnectAccountId })
			: null;
		const existingByPinterestUser = await getOwnedPinterestAccountByPinterestUserId({
			owner: stateRecord.owner,
			pinterestUserId: normalizeString(profile?.id || '', 'pinterest_user_id', { max: 120 }),
		});

		if (existingByPinterestUser && !reconnectAccountId) {
			throw httpError(409, 'This Pinterest account is already connected. Please use reconnect or rename the existing account.');
		}

		if (existingByPinterestUser && reconnectAccount && existingByPinterestUser.id !== reconnectAccount.id) {
			throw httpError(409, 'Another connected account already uses this Pinterest profile.');
		}

		const accountName = normalizeString(profile?.account_name || profile?.full_name || profile?.business_name || '', 'account_name', { max: 255 });
		const profileImageUrl = normalizeString(
			profile?.profile_image || profile?.profile_image_url || profile?.image_medium_url || profile?.image_small_url || '',
			'profile_image_url',
			{ max: 1000 },
		);

		const payload = {
			owner: stateRecord.owner,
			pinterest_user_id: normalizeString(profile?.id || '', 'pinterest_user_id', { max: 120 }),
			username: normalizeString(profile?.username || profile?.profile_username || '', 'username', { max: 255 }),
			account_name: accountName,
			profile_image_url: profileImageUrl,
			access_token: encryptSecret(accessToken),
			refresh_token: encryptSecret(refreshToken),
			token_expires_at: expiresAt,
			scope,
			connected: true,
			status: 'connected',
			status_error: '',
			connected_at: reconnectAccount?.connected_at || new Date().toISOString(),
			label: requestedLabel || reconnectAccount?.label || existingByPinterestUser?.label || accountName || normalizeString(profile?.username || '', 'username', { max: 255 }) || 'Pinterest Account',
			last_sync_at: '',
		};

		const targetAccount = reconnectAccount || existingByPinterestUser;
		const account = targetAccount
			? await pocketbaseClient.collection('pinterest_accounts').update(targetAccount.id, payload)
			: await pocketbaseClient.collection('pinterest_accounts').create(payload);

		await syncPinterestBoardsForOwner({ owner: stateRecord.owner, account });
		await pocketbaseClient.collection('pinterest_oauth_states').update(stateRecord.id, { used: true });

		return res.redirect(`${webAppBase}/app/pinterest?pinterest_connected=1&account_id=${encodeURIComponent(account.id)}`);
	} catch (error) {
		const message = encodeURIComponent(error?.message || 'Pinterest OAuth callback failed');
		return res.redirect(`${webAppBase}/app/pinterest?pinterest_error=${message}`);
	}
});

router.use(pocketbaseAuth);

router.get('/account', async (req, res) => {
	const account = await getOwnedPinterestAccount(req.pocketbaseUserId);
	res.json(mapAccount(account));
});

router.get('/accounts', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const filterBy = normalizeString(req.query.filter, 'filter', { max: 40 }).toLowerCase();

	const payload = await buildAccountStats(owner);
	let filtered = payload.items;

	if (filterBy === 'connected') {
		filtered = payload.items.filter((item) => item.status === 'connected');
	}
	if (filterBy === 'expired') {
		filtered = payload.items.filter((item) => item.status === 'expired');
	}
	if (filterBy === 'active') {
		filtered = payload.items.filter((item) => item.status === 'connected' && item.connected);
	}
	if (filterBy === 'error') {
		filtered = payload.items.filter((item) => item.status === 'error');
	}

	res.json({
		summary: payload.summary,
		items: filtered,
	});
});

router.post('/oauth/start', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const accountId = normalizeString(req.body?.accountId, 'accountId', { max: 80 });
	if (accountId) {
		const account = await getOwnedPinterestAccountById({ owner, accountId });
		if (!account) {
			throw httpError(404, 'Pinterest account not found for reconnect');
		}
	}

	const requestedLabel = normalizeString(req.body?.label, 'label', { max: 255 });
	const { authUrl } = await createPinterestOAuthState({ owner, accountId, requestedLabel });
	res.json({ authUrl });
});

router.post('/accounts/:accountId/reconnect', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const account = await getOwnedPinterestAccountById({ owner, accountId: req.params.accountId });
	if (!account) {
		throw httpError(404, 'Pinterest account not found');
	}

	const { authUrl } = await createPinterestOAuthState({
		owner,
		accountId: account.id,
		requestedLabel: normalizeString(req.body?.label, 'label', { max: 255 }) || account.label || '',
	});
	res.json({ authUrl });
});

router.patch('/accounts/:accountId', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const account = await getOwnedPinterestAccountById({ owner, accountId: req.params.accountId });
	if (!account) {
		throw httpError(404, 'Pinterest account not found');
	}

	const label = normalizeString(req.body?.label, 'label', { required: true, max: 255 });
	const updated = await pocketbaseClient.collection('pinterest_accounts').update(account.id, { label });

	const jobsFilter = await buildSchemaSafeFilter({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:account-label-sync:list-jobs',
		parts: [
			{ field: 'owner', expression: pocketbaseClient.filter('owner = {:owner}', { owner }) },
			{ field: 'account', expression: pocketbaseClient.filter('account = {:account}', { account: account.id }) },
		],
	});

	await safeGetFullList({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:account-label-sync:list-jobs',
		filter: jobsFilter.filter,
	}).then((jobs) => Promise.all(jobs.map(async (job) => {
		const payload = await sanitizeCollectionPayload({
			collection: 'pinterest_publish_jobs',
			context: 'pinterest:account-label-sync:update-job',
			payload: { account_label: label },
		});
		return pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, payload).catch(() => {});
	})));

	res.json(mapAccount(updated));
});

router.post('/accounts/:accountId/disconnect', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const account = await getOwnedPinterestAccountById({ owner, accountId: req.params.accountId });
	if (!account) {
		throw httpError(404, 'Pinterest account not found');
	}

	await pocketbaseClient.collection('pinterest_boards').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner} && account = {:account}', { owner, account: account.id }),
	}).then((boards) => Promise.all(boards.map((board) => pocketbaseClient.collection('pinterest_boards').delete(board.id).catch(() => {}))));

	await pocketbaseClient.collection('pinterest_accounts').delete(account.id).catch(() => {});
	res.status(204).send();
});

router.post('/disconnect', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const account = await getOwnedPinterestAccount(owner);
	if (account) {
		await pocketbaseClient.collection('pinterest_accounts').delete(account.id).catch(() => {});
	}

	const boards = await pocketbaseClient.collection('pinterest_boards').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner}', { owner }),
	});

	await Promise.all(boards.map((board) => pocketbaseClient.collection('pinterest_boards').delete(board.id).catch(() => {})));
	res.status(204).send();
});

router.get('/boards', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const accountId = normalizeString(req.query.accountId, 'accountId', { max: 80 });

	const forceSync = String(req.query.sync || '').toLowerCase() === '1';

	if (!accountId) {
		if (forceSync) {
			const accounts = await getOwnedPinterestAccounts(owner);
			const connectedAccounts = accounts.filter((account) => account.connected && account.status === 'connected');
			for (const account of connectedAccounts) {
				await syncPinterestBoardsForOwner({ owner, account });
			}
		}

		const allBoards = await pocketbaseClient.collection('pinterest_boards').getFullList({
			sort: 'name',
			filter: pocketbaseClient.filter('owner = {:owner}', { owner }),
		});

		return res.json(allBoards.map(mapBoard));
	}

	const account = await assertPinterestConnected(owner, accountId);

	if (forceSync) {
		const boards = await syncPinterestBoardsForOwner({ owner, account });
		return res.json(boards);
	}

	const boards = await pocketbaseClient.collection('pinterest_boards').getFullList({
		sort: 'name',
		filter: pocketbaseClient.filter('owner = {:owner} && account = {:account}', { owner, account: account.id }),
	});

	res.json(boards.map(mapBoard));
});

router.post('/boards/sync', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const accountId = normalizeString(req.body?.accountId, 'accountId', { max: 80 });

	if (accountId) {
		const account = await assertPinterestConnected(owner, accountId);
		const boards = await syncPinterestBoardsForOwner({ owner, account });
		return res.json({ items: boards });
	}

	const accounts = await getOwnedPinterestAccounts(owner);
	const connectedAccounts = accounts.filter((account) => account.connected && account.status === 'connected');
	const synced = [];

	for (const account of connectedAccounts) {
		const boards = await syncPinterestBoardsForOwner({ owner, account });
		synced.push(...boards);
	}

	res.json({ items: synced });
});

router.post('/publish', async (req, res) => {
	const owner = req.pocketbaseUserId;

	const pinIds = normalizePinIds(req.body?.pinIds);
	const scheduledAt = new Date().toISOString();
	const timezone = normalizeString(req.body?.timezone, 'timezone', { max: 80 }) || 'UTC';
	const defaultTarget = {
		accountId: normalizeString(req.body?.accountId, 'accountId', { max: 80 }),
		boardId: normalizeString(req.body?.boardId, 'boardId', { max: 120 }),
	};
	const perPinTargets = normalizeObject(req.body?.perPinTargets, 'perPinTargets');

	if (!defaultTarget.boardId && Object.keys(perPinTargets).length === 0) {
		throw httpError(422, 'boardId is required when perPinTargets are not provided');
	}

	const jobs = await createPublishJobs({ owner, pinIds, defaultTarget, perPinTargets, scheduledAt, timezone });
	res.status(201).json({ jobs: jobs.map((job) => mapJob(job)) });
});

router.post('/schedule', async (req, res) => {
	const owner = req.pocketbaseUserId;

	const pinIds = normalizePinIds(req.body?.pinIds);
	const scheduledAt = normalizeDateTime(req.body?.scheduledAt, 'scheduledAt');
	const timezone = normalizeString(req.body?.timezone, 'timezone', { required: true, max: 80 });
	const defaultTarget = {
		accountId: normalizeString(req.body?.accountId, 'accountId', { max: 80 }),
		boardId: normalizeString(req.body?.boardId, 'boardId', { max: 120 }),
	};
	const perPinTargets = normalizeObject(req.body?.perPinTargets, 'perPinTargets');

	if (!defaultTarget.boardId && Object.keys(perPinTargets).length === 0) {
		throw httpError(422, 'boardId is required when perPinTargets are not provided');
	}

	const jobs = await createPublishJobs({ owner, pinIds, defaultTarget, perPinTargets, scheduledAt, timezone });
	res.status(201).json({ jobs: jobs.map((job) => mapJob(job)) });
});

router.patch('/jobs/:jobId', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const job = await pocketbaseClient.collection('pinterest_publish_jobs').getOne(req.params.jobId).catch(() => null);
	if (!job) {
		throw httpError(404, 'Scheduled job not found');
	}
	if (job.owner !== owner) {
		throw httpError(403, 'You do not have access to this scheduled job');
	}
	if (job.status !== 'scheduled') {
		throw httpError(422, 'Only scheduled jobs can be edited');
	}

	const updates = {};

	if ('scheduledAt' in (req.body || {})) {
		updates.scheduled_at = normalizeDateTime(req.body.scheduledAt, 'scheduledAt');
	}
	if ('timezone' in (req.body || {})) {
		updates.timezone = normalizeString(req.body.timezone, 'timezone', { required: true, max: 80 });
	}
	if ('boardId' in (req.body || {})) {
		const boardId = normalizeString(req.body.boardId, 'boardId', { required: true, max: 120 });
		const currentAccountId = normalizeString(req.body?.accountId, 'accountId', { max: 80 }) || updates.account || job.account;
		const board = await getOwnedPinterestBoard({ owner, boardId, accountId: currentAccountId });
		updates.account = currentAccountId;
		updates.board_id = board.board_id;
		updates.board_name = board.name;
	}
	if ('accountId' in (req.body || {})) {
		const account = await assertPinterestConnected(owner, normalizeString(req.body.accountId, 'accountId', { required: true, max: 80 }));
		updates.account = account.id;
		updates.account_label = account.label || account.account_name || account.username || '';
		updates.account_username = account.username || '';
	}

	if (Object.keys(updates).length === 0) {
		return res.json(mapJob(job));
	}

	const sanitizedUpdates = await sanitizeCollectionPayload({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:patch-job:update',
		payload: updates,
	});

	const updated = await pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, sanitizedUpdates);
	await pocketbaseClient.collection('ai_pins').update(job.ai_pin, {
		...(updates.scheduled_at ? { scheduled_at: updates.scheduled_at } : {}),
		...(updates.timezone ? { scheduled_timezone: updates.timezone } : {}),
		...(updates.account ? { pinterest_account_id: updates.account } : {}),
		...(updates.account_label ? { pinterest_account_label: updates.account_label } : {}),
		...(updates.board_id ? { pinterest_board_id: updates.board_id } : {}),
		...(updates.board_name ? { pinterest_board_name: updates.board_name } : {}),
	});

	await pocketbaseClient.collection('pinterest_publish_events').create({
		owner,
		job: updated.id,
		event_type: 'schedule_updated',
		message: 'Scheduled job updated',
		payload: sanitizedUpdates,
	});

	res.json(mapJob(updated));
});

router.post('/jobs/:jobId/cancel', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const job = await pocketbaseClient.collection('pinterest_publish_jobs').getOne(req.params.jobId).catch(() => null);
	if (!job) {
		throw httpError(404, 'Scheduled job not found');
	}
	if (job.owner !== owner) {
		throw httpError(403, 'You do not have access to this scheduled job');
	}
	if (!['scheduled', 'failed'].includes(job.status)) {
		throw httpError(422, 'Only scheduled or failed jobs can be cancelled');
	}

	const cancelledPayload = await sanitizeCollectionPayload({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:cancel-job:update',
		payload: {
			status: 'cancelled',
			next_retry_at: '',
		},
	});

	const updated = await pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, cancelledPayload);

	await pocketbaseClient.collection('ai_pins').update(job.ai_pin, {
		status: 'draft',
		scheduled_at: '',
		scheduled_timezone: '',
		pinterest_account_id: '',
		pinterest_account_label: '',
		publish_error: '',
	});

	await pocketbaseClient.collection('pinterest_publish_events').create({
		owner,
		job: updated.id,
		event_type: 'cancelled',
		message: 'Scheduled job cancelled',
		payload: null,
	});

	res.json(mapJob(updated));
});

router.post('/jobs/:jobId/retry', async (req, res) => {
	const owner = req.pocketbaseUserId;

	const job = await pocketbaseClient.collection('pinterest_publish_jobs').getOne(req.params.jobId).catch(() => null);
	if (!job) {
		throw httpError(404, 'Job not found');
	}
	if (job.owner !== owner) {
		throw httpError(403, 'You do not have access to this job');
	}
	if (job.status !== 'failed') {
		throw httpError(422, 'Only failed jobs can be retried manually');
	}

	await assertPinterestConnected(owner, job.account);

	const now = new Date().toISOString();
	const retryPayload = await sanitizeCollectionPayload({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:retry-job:update',
		payload: {
			status: 'scheduled',
			scheduled_at: now,
			next_retry_at: now,
			last_error: '',
		},
	});

	const updated = await pocketbaseClient.collection('pinterest_publish_jobs').update(job.id, retryPayload);

	await pocketbaseClient.collection('ai_pins').update(job.ai_pin, {
		status: 'scheduled',
		scheduled_at: now,
		publish_error: '',
	});

	await pocketbaseClient.collection('pinterest_publish_events').create({
		owner,
		job: updated.id,
		event_type: 'retry_manual',
		message: 'Failed job moved back to queue',
		payload: null,
	});

	res.json(mapJob(updated));
});

router.get('/jobs', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const page = normalizePositiveInt(req.query.page, DEFAULT_PAGE);
	const perPage = normalizePositiveInt(req.query.perPage, DEFAULT_PER_PAGE, 200);
	const status = normalizeString(req.query.status, 'status', { max: 60 });
	const dateFrom = normalizeString(req.query.dateFrom, 'dateFrom', { max: 80 });
	const dateTo = normalizeString(req.query.dateTo, 'dateTo', { max: 80 });

	const filters = [pocketbaseClient.filter('owner = {:owner}', { owner })];
	if (status) {
		filters.push(pocketbaseClient.filter('status = {:status}', { status }));
	}
	if (dateFrom) {
		filters.push(pocketbaseClient.filter('scheduled_at >= {:dateFrom}', { dateFrom }));
	}
	if (dateTo) {
		filters.push(pocketbaseClient.filter('scheduled_at <= {:dateTo}', { dateTo }));
	}

	const result = await safeGetList({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:list-jobs',
		page,
		perPage,
		sort: '-scheduled_at,-created',
		filter: filters.join(' && '),
		expand: 'ai_pin,account',
	});

	res.json({
		page: result.page,
		perPage: result.perPage,
		totalItems: result.totalItems,
		totalPages: result.totalPages,
		items: result.items.map((item) => mapJob(item, item.expand?.ai_pin || null)),
	});
});

router.get('/calendar', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const month = normalizeString(req.query.month, 'month', { max: 20 });
	const reference = month ? new Date(`${month}-01T00:00:00.000Z`) : new Date();
	if (Number.isNaN(reference.getTime())) {
		throw httpError(422, 'month must be in YYYY-MM format');
	}

	const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
	const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));

	const calendarFilter = await buildSchemaSafeFilter({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:calendar',
		parts: [
			{ field: 'owner', expression: pocketbaseClient.filter('owner = {:owner}', { owner }) },
			{ field: 'status', expression: pocketbaseClient.filter('status = {:status}', { status: 'scheduled' }) },
			{ field: 'scheduled_at', expression: pocketbaseClient.filter('scheduled_at >= {:start}', { start: start.toISOString() }) },
			{ field: 'scheduled_at', expression: pocketbaseClient.filter('scheduled_at < {:end}', { end: end.toISOString() }) },
		],
	});

	const result = await safeGetFullList({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:calendar',
		sort: 'scheduled_at',
		filter: calendarFilter.filter,
		expand: 'ai_pin,account',
	});

	res.json(result.map((item) => mapJob(item, item.expand?.ai_pin || null)));
});

router.get('/history', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const statuses = ['published', 'failed', 'scheduled'];
	const page = normalizePositiveInt(req.query.page, DEFAULT_PAGE);
	const perPage = normalizePositiveInt(req.query.perPage, DEFAULT_PER_PAGE, 100);
	const historyFilter = await buildSchemaSafeFilter({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:history',
		parts: [
			{ field: 'owner', expression: pocketbaseClient.filter('owner = {:owner}', { owner }) },
			{ field: 'status', expression: `(${statuses.map((item) => pocketbaseClient.filter('status = {:status}', { status: item })).join(' || ')})` },
		],
	});

	const result = await safeGetList({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:history',
		page,
		perPage,
		sort: '-updated,-scheduled_at',
		filter: historyFilter.filter,
		expand: 'ai_pin,account',
	});

	res.json({
		page: result.page,
		perPage: result.perPage,
		totalItems: result.totalItems,
		totalPages: result.totalPages,
		items: result.items.map((item) => mapJob(item, item.expand?.ai_pin || null)),
	});
});

router.get('/analytics', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const publishedFilter = await buildSchemaSafeFilter({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:analytics:published',
		parts: [
			{ field: 'owner', expression: pocketbaseClient.filter('owner = {:owner}', { owner }) },
			{ field: 'status', expression: pocketbaseClient.filter('status = {:status}', { status: 'published' }) },
		],
	});
	const failedFilter = await buildSchemaSafeFilter({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:analytics:failed',
		parts: [
			{ field: 'owner', expression: pocketbaseClient.filter('owner = {:owner}', { owner }) },
			{ field: 'status', expression: pocketbaseClient.filter('status = {:status}', { status: 'failed' }) },
		],
	});
	const scheduledFilter = await buildSchemaSafeFilter({
		collection: 'pinterest_publish_jobs',
		context: 'pinterest:analytics:scheduled',
		parts: [
			{ field: 'owner', expression: pocketbaseClient.filter('owner = {:owner}', { owner }) },
			{ field: 'status', expression: pocketbaseClient.filter('status = {:status}', { status: 'scheduled' }) },
		],
	});
	const [published, failedCount, scheduledCount] = await Promise.all([
		safeGetFullList({
			collection: 'pinterest_publish_jobs',
			context: 'pinterest:analytics:published',
			sort: '-published_at,-updated',
			filter: publishedFilter.filter,
			expand: 'ai_pin,account',
		}),
		safeGetList({
			collection: 'pinterest_publish_jobs',
			context: 'pinterest:analytics:failed',
			page: 1,
			perPage: 1,
			filter: failedFilter.filter,
		}),
		safeGetList({
			collection: 'pinterest_publish_jobs',
			context: 'pinterest:analytics:scheduled',
			page: 1,
			perPage: 1,
			filter: scheduledFilter.filter,
		}),
	]);

	res.json({
		summary: {
			published: published.length,
			failed: failedCount.totalItems,
			scheduled: scheduledCount.totalItems,
		},
		items: published.map((item) => mapJob(item, item.expand?.ai_pin || null)),
	});
});

router.post('/token/refresh', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const account = await assertPinterestConnected(owner, normalizeString(req.body?.accountId, 'accountId', { max: 80 }));

	try {
		const tokenState = await ensureValidPinterestAccessToken({ account });
		const accessToken = decryptSecret(tokenState.account.access_token || '');
		if (!accessToken) {
			throw httpError(401, 'Unable to refresh Pinterest token. Please reconnect your account.');
		}
		res.json({ ok: true, accountId: tokenState.account.id, tokenExpiresAt: tokenState.account.token_expires_at || '' });
	} catch (error) {
		await markPinterestAccountStatus({ accountId: account.id, status: 'expired', statusError: error?.message || 'Token refresh failed' });
		throw normalizePinterestError(error);
	}
});

router.get('/providers', async (req, res) => {
	res.json({ providers: listPublishProviders() });
});

export default router;

verifyCollectionFields({
	collection: 'websites',
	requiredFields: ['owner', 'url', 'domain', 'discovery_status', 'status'],
	context: 'websites-schema-check',
}).catch(() => null);
