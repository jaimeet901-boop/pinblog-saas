import { Router } from 'express';
import {
	archiveAdminMarketplaceTemplate,
	createAdminMarketplaceTemplate,
	getAdminMarketplaceTemplate,
	listAdminMarketplaceTemplates,
	updateAdminMarketplaceTemplate,
} from '../../services/admin/marketplace-templates.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/', asyncHandler(async (req, res) => {
	res.json(await listAdminMarketplaceTemplates(req.query || {}));
}));

router.post('/', asyncHandler(async (req, res) => {
	res.status(201).json(await createAdminMarketplaceTemplate(req.body || {}, req.adminUser));
}));

router.get('/:id', asyncHandler(async (req, res) => {
	const includeConfiguration = req.query.includeConfiguration === '1' || req.query.includeConfiguration === 'true';
	res.json(await getAdminMarketplaceTemplate(req.params.id, { includeConfiguration }));
}));

router.put('/:id', asyncHandler(async (req, res) => {
	res.json(await updateAdminMarketplaceTemplate(req.params.id, req.body || {}, req.adminUser));
}));

router.post('/:id/archive', asyncHandler(async (req, res) => {
	res.json(await archiveAdminMarketplaceTemplate(req.params.id));
}));

export default router;
