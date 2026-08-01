import { Router } from 'express';
import {
	ensureAuthenticationProvidersSeeded,
	getAuthenticationProviderPublic,
	listAuthenticationProvidersPublic,
	resetAuthenticationProvider,
	rotateAuthenticationProviderSecret,
	testAuthenticationProviderConnection,
	upsertAuthenticationProvider,
} from '../../services/authentication-providers/credentials.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

function actor(req) {
	return req.adminUser || req.user || {};
}

router.get('/', asyncHandler(async (_req, res) => {
	await ensureAuthenticationProvidersSeeded().catch(() => null);
	res.json({ items: await listAuthenticationProvidersPublic() });
}));

router.get('/:providerId', asyncHandler(async (req, res) => {
	await ensureAuthenticationProvidersSeeded().catch(() => null);
	res.json(await getAuthenticationProviderPublic(req.params.providerId));
}));

router.put('/:providerId', asyncHandler(async (req, res) => {
	const body = req.body || {};
	const config = await upsertAuthenticationProvider(req.params.providerId, {
		clientId: body.clientId,
		clientSecret: body.clientSecret,
		redirectUri: body.redirectUri,
		scopes: body.scopes,
		enabled: body.enabled,
	}, actor(req));
	res.json(config);
}));

router.post('/:providerId/test', asyncHandler(async (req, res) => {
	const body = req.body || {};
	const result = await testAuthenticationProviderConnection(req.params.providerId, {
		clientId: body.clientId,
		clientSecret: body.clientSecret,
		redirectUri: body.redirectUri,
	}, actor(req));
	res.json(result);
}));

router.post('/:providerId/rotate-secret', asyncHandler(async (req, res) => {
	const body = req.body || {};
	const config = await rotateAuthenticationProviderSecret(
		req.params.providerId,
		body.clientSecret,
		actor(req),
	);
	res.json(config);
}));

router.post('/:providerId/reset', asyncHandler(async (req, res) => {
	const config = await resetAuthenticationProvider(req.params.providerId, actor(req));
	res.json(config);
}));

export default router;
