import { Router } from 'express';
import {
	addAdminCollectionMember,
	createAdminTemplateCollection,
	deleteAdminTemplateCollection,
	getAdminTemplateCollection,
	listAdminTemplateCollections,
	removeAdminCollectionMember,
	updateAdminCollectionMember,
	updateAdminTemplateCollection,
} from '../../services/admin/template-collections.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/', asyncHandler(async (req, res) => {
	res.json(await listAdminTemplateCollections(req.query || {}));
}));

router.post('/', asyncHandler(async (req, res) => {
	res.status(201).json(await createAdminTemplateCollection(req.body || {}, req.adminUser));
}));

router.get('/:id', asyncHandler(async (req, res) => {
	res.json(await getAdminTemplateCollection(req.params.id));
}));

router.put('/:id', asyncHandler(async (req, res) => {
	res.json(await updateAdminTemplateCollection(req.params.id, req.body || {}, req.adminUser));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
	res.json(await deleteAdminTemplateCollection(req.params.id));
}));

router.post('/:id/members', asyncHandler(async (req, res) => {
	res.status(201).json(await addAdminCollectionMember(req.params.id, req.body || {}, req.adminUser));
}));

router.patch('/members/:memberId', asyncHandler(async (req, res) => {
	res.json(await updateAdminCollectionMember(req.params.memberId, req.body || {}));
}));

router.delete('/members/:memberId', asyncHandler(async (req, res) => {
	res.json(await removeAdminCollectionMember(req.params.memberId));
}));

export default router;
