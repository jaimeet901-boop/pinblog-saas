import { Router } from 'express';
import { httpError } from '../../middleware/require-admin.js';
import {
	createLegalPage,
	deleteLegalPage,
	getLegalPageBySlug,
	listLegalPages,
	listLegalPageVersions,
	restoreLegalPageVersion,
	updateLegalPage,
} from '../../services/legal-pages.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/', asyncHandler(async (req, res) => {
	res.json(await listLegalPages({ q: req.query.q || '' }));
}));

router.post('/', asyncHandler(async (req, res) => {
	res.status(201).json(await createLegalPage(req.body || {}, req.adminUser));
}));

router.get('/:slug/versions', asyncHandler(async (req, res) => {
	res.json(await listLegalPageVersions(req.params.slug));
}));

router.post('/:slug/versions/:version/restore', asyncHandler(async (req, res) => {
	res.json(await restoreLegalPageVersion(req.params.slug, req.params.version, req.adminUser));
}));

router.get('/:slug', asyncHandler(async (req, res) => {
	res.json(await getLegalPageBySlug(req.params.slug));
}));

router.put('/:slug', asyncHandler(async (req, res) => {
	res.json(await updateLegalPage(req.params.slug, req.body || {}, req.adminUser));
}));

router.delete('/:slug', asyncHandler(async (req, res) => {
	const result = await deleteLegalPage(req.params.slug, req.adminUser);
	if (!result?.ok) {
		throw httpError(500, 'Failed to delete legal page.', 'LEGAL_PAGE_DELETE_FAILED');
	}
	res.json(result);
}));

export default router;
