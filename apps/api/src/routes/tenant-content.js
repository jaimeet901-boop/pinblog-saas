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
 * PATCH /content/articles/:id
 * Merge writer metadata into the existing JSON body (published_url, images, custom_prompt).
 * Backward compatible — no schema migration required.
 */
router.patch('/articles/:id', async (req, res) => {
	requireAuth(req);
	const record = await getWorkspaceOwnedRecord('articles', req.params.id, req, {
		notFoundMessage: 'Article not found',
	});
	const input = req.body && typeof req.body === 'object' ? req.body : {};
	const currentBody = record.body && typeof record.body === 'object' ? { ...record.body } : {};

	if (typeof input.published_url === 'string') {
		currentBody.published_url = input.published_url.trim().slice(0, 2000);
	}
	if (typeof input.published_at === 'string') {
		currentBody.published_at = input.published_at.trim().slice(0, 64);
	}
	if (typeof input.featured_image === 'string') {
		currentBody.featured_image = input.featured_image.trim().slice(0, 2000);
	}
	if (Array.isArray(input.gallery_images)) {
		currentBody.gallery_images = input.gallery_images
			.map((url) => String(url || '').trim().slice(0, 2000))
			.filter(Boolean)
			.slice(0, 40);
	}
	if (typeof input.custom_prompt === 'string') {
		currentBody.custom_prompt = input.custom_prompt.trim().slice(0, 8000);
	}
	if (input.body && typeof input.body === 'object') {
		Object.assign(currentBody, input.body);
	}

	const updated = await pocketbaseClient.collection('articles').update(record.id, {
		body: currentBody,
	});
	res.json(updated);
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
