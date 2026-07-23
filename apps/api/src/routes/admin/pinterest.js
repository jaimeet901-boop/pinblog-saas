import { Router } from 'express';
import { httpError } from '../../middleware/require-admin.js';
import {
	ensurePinterestAppCredentialsSeeded,
	getPinterestAppCredentialsPublic,
	upsertPinterestAppCredentials,
} from '../../services/pinterest-app-credentials.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/oauth-config', asyncHandler(async (_req, res) => {
	await ensurePinterestAppCredentialsSeeded().catch(() => null);
	const config = await getPinterestAppCredentialsPublic();
	res.json(config);
}));

router.put('/oauth-config', asyncHandler(async (req, res) => {
	const body = req.body || {};
	const appId = body.appId != null ? String(body.appId).trim() : undefined;
	const redirectUri = body.redirectUri != null ? String(body.redirectUri).trim() : undefined;
	const scopes = body.scopes != null ? String(body.scopes).trim() : undefined;

	if (appId !== undefined && !appId) {
		throw httpError(422, 'appId is required', 'VALIDATION_ERROR');
	}
	if (redirectUri !== undefined && !redirectUri) {
		throw httpError(422, 'redirectUri is required', 'VALIDATION_ERROR');
	}

	const config = await upsertPinterestAppCredentials({
		appId,
		appSecret: body.appSecret,
		redirectUri,
		scopes,
		enabled: body.enabled,
		trialAccessPending: body.trialAccessPending,
	}, {
		id: req.adminUser?.id || req.pocketbaseUserId,
		email: req.adminUser?.email,
		name: req.adminUser?.name,
	});

	res.json(config);
}));

export default router;
