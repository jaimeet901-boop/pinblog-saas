import { Router } from 'express';
import { httpError } from '../../middleware/require-admin.js';
import {
	createModel,
	deleteModel,
	getModelById,
	listModels,
	setModelDefault,
	setModelEnabled,
	updateModel,
} from '../../services/ai-models.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

function notFound(error) {
	if (error?.status === 404) {
		throw httpError(404, 'Model not found', 'MODEL_NOT_FOUND');
	}
	throw error;
}

router.get('/', asyncHandler(async (req, res) => {
	const result = await listModels(req.query || {});
	res.json(result);
}));

router.post('/', asyncHandler(async (req, res) => {
	const model = await createModel(req.body || {});
	res.status(201).json(model);
}));

router.get('/:id', asyncHandler(async (req, res) => {
	try {
		const model = await getModelById(req.params.id);
		res.json(model);
	} catch (error) {
		notFound(error);
	}
}));

router.patch('/:id', asyncHandler(async (req, res) => {
	try {
		const model = await updateModel(req.params.id, req.body || {});
		res.json(model);
	} catch (error) {
		notFound(error);
	}
}));

router.post('/:id/enable', asyncHandler(async (req, res) => {
	try {
		const model = await setModelEnabled(req.params.id, true);
		res.json(model);
	} catch (error) {
		notFound(error);
	}
}));

router.post('/:id/disable', asyncHandler(async (req, res) => {
	try {
		const model = await setModelEnabled(req.params.id, false);
		res.json(model);
	} catch (error) {
		notFound(error);
	}
}));

router.post('/:id/default', asyncHandler(async (req, res) => {
	try {
		const model = await setModelDefault(req.params.id);
		res.json(model);
	} catch (error) {
		notFound(error);
	}
}));

router.delete('/:id', asyncHandler(async (req, res) => {
	try {
		const result = await deleteModel(req.params.id);
		res.json(result);
	} catch (error) {
		notFound(error);
	}
}));

export default router;
