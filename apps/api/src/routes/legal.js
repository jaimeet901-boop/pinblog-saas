import { Router } from 'express';
import { getPublishedLegalPageBySlug, LEGAL_PAGE_SLUGS } from '../services/legal-pages.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/', asyncHandler(async (_req, res) => {
	res.json({
		items: LEGAL_PAGE_SLUGS.map((slug) => ({
			slug,
			path: `/${slug}`,
			url: `https://tbuy.store/${slug}`,
		})),
	});
}));

router.get('/:slug', asyncHandler(async (req, res) => {
	res.json(await getPublishedLegalPageBySlug(req.params.slug));
}));

export default router;
