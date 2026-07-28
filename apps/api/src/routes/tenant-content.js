/**
 * Tenant content API for Chef IA Writer (articles) and Images (pins) collections.
 * Workspace-scoped via workspaceScopeFilter / stampCreateOwnership.
 */
import { Router } from 'express';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import {
	stampCreateOwnership,
	listWorkspaceResources,
	listWorkspaceResourcesFull,
	getWorkspaceOwnedRecord,
} from '../services/workspace-ownership.js';

const router = Router();

function httpError(status, message, errorCode = 'ERROR') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function requireAuth(req) {
	if (!req.pocketbaseUserId) {
		throw httpError(401, 'You must be signed in', 'UNAUTHENTICATED');
	}
}

/**
 * GET /content/articles?perPage=6
 */
router.get('/articles', async (req, res) => {
	requireAuth(req);
	const perPage = Math.min(Math.max(Number(req.query.perPage) || 6, 1), 50);
	const result = await listWorkspaceResources('articles', req, {
		page: 1,
		perPage,
		sort: '-created',
	});
	res.json({ items: result.items || [], totalItems: result.totalItems || 0 });
});

/**
 * POST /content/articles
 */
router.post('/articles', async (req, res) => {
	requireAuth(req);
	const body = req.body && typeof req.body === 'object' ? req.body : {};
	const stamped = stampCreateOwnership(req, {
		keyword: String(body.keyword || '').trim().slice(0, 300),
		seo_title: String(body.seo_title || '').trim().slice(0, 300),
		meta_description: String(body.meta_description || '').trim().slice(0, 1000),
		slug: String(body.slug || '').trim().slice(0, 200),
		language: String(body.language || '').trim().slice(0, 60),
		country: String(body.country || '').trim().slice(0, 60),
		tone: String(body.tone || '').trim().slice(0, 60),
		body: body.body && typeof body.body === 'object' ? body.body : null,
		status: String(body.status || 'draft').trim().slice(0, 40),
		...(body.scheduled_at ? { scheduled_at: String(body.scheduled_at).trim().slice(0, 64) } : {}),
	});

	const created = await pocketbaseClient.collection('articles').create(stamped);
	res.status(201).json(created);
});

/**
 * GET /content/pins
 */
router.get('/pins', async (req, res) => {
	requireAuth(req);
	const items = await listWorkspaceResourcesFull('pins', req, { sort: '-created' });
	res.json({ items });
});

/**
 * POST /content/pins
 */
router.post('/pins', async (req, res) => {
	requireAuth(req);
	const body = req.body && typeof req.body === 'object' ? req.body : {};
	const stamped = stampCreateOwnership(req, {
		title: String(body.title || '').trim().slice(0, 120),
		image_url: String(body.image_url || '').trim().slice(0, 2000),
		format: String(body.format || 'portrait').trim().slice(0, 40),
		status: String(body.status || 'draft').trim().slice(0, 40),
	});

	const created = await pocketbaseClient.collection('pins').create(stamped);
	res.status(201).json(created);
});

/**
 * DELETE /content/pins/:id
 */
router.delete('/pins/:id', async (req, res) => {
	requireAuth(req);
	const pin = await getWorkspaceOwnedRecord('pins', req.params.id, req, {
		notFoundMessage: 'Pin not found',
	});
	await pocketbaseClient.collection('pins').delete(pin.id);
	res.status(204).end();
});

export default router;
