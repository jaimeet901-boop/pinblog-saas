import { Router } from 'express';
import { httpError } from '../../middleware/require-admin.js';
import {
	createProvider,
	deleteProvider,
	getProviderById,
	listProviders,
	setProviderEnabled,
	testProviderConnection,
	updateProviderConfig,
	upsertProviderSecrets,
} from '../../services/ai-providers.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

router.get('/', asyncHandler(async (req, res) => {
	const items = await listProviders();
	res.json({
		items,
		totalItems: items.length,
	});
}));

router.post('/', asyncHandler(async (req, res) => {
	const provider = await createProvider(req.body || {});
	res.status(201).json(provider);
}));

router.get('/:id', asyncHandler(async (req, res) => {
	try {
		const provider = await getProviderById(req.params.id);
		res.json(provider);
	} catch (error) {
		if (error?.status === 404) {
			throw httpError(404, 'Provider not found', 'PROVIDER_NOT_FOUND');
		}
		throw error;
	}
}));

router.patch('/:id', asyncHandler(async (req, res) => {
	try {
		const provider = await updateProviderConfig(req.params.id, req.body || {});
		res.json(provider);
	} catch (error) {
		if (error?.status === 404) {
			throw httpError(404, 'Provider not found', 'PROVIDER_NOT_FOUND');
		}
		throw error;
	}
}));

router.put('/:id/secrets', asyncHandler(async (req, res) => {
	const { apiKey, secretKey } = req.body || {};
	if ((apiKey == null || apiKey === '') && (secretKey == null || secretKey === '')) {
		throw httpError(422, 'Provide apiKey and/or secretKey', 'VALIDATION_ERROR');
	}
	try {
		await upsertProviderSecrets(req.params.id, {
			apiKey: typeof apiKey === 'string' ? apiKey : undefined,
			secretKey: typeof secretKey === 'string' ? secretKey : undefined,
		});
		const provider = await getProviderById(req.params.id);
		res.json(provider);
	} catch (error) {
		if (error?.status === 404) {
			throw httpError(404, 'Provider not found', 'PROVIDER_NOT_FOUND');
		}
		throw error;
	}
}));

router.post('/:id/test', asyncHandler(async (req, res) => {
	try {
		const result = await testProviderConnection(req.params.id);
		res.json(result);
	} catch (error) {
		if (error?.status === 404) {
			throw httpError(404, 'Provider not found', 'PROVIDER_NOT_FOUND');
		}
		throw error;
	}
}));

router.post('/:id/enable', asyncHandler(async (req, res) => {
	try {
		const provider = await setProviderEnabled(req.params.id, true);
		res.json(provider);
	} catch (error) {
		if (error?.status === 404) {
			throw httpError(404, 'Provider not found', 'PROVIDER_NOT_FOUND');
		}
		throw error;
	}
}));

router.post('/:id/disable', asyncHandler(async (req, res) => {
	try {
		const provider = await setProviderEnabled(req.params.id, false);
		res.json(provider);
	} catch (error) {
		if (error?.status === 404) {
			throw httpError(404, 'Provider not found', 'PROVIDER_NOT_FOUND');
		}
		throw error;
	}
}));

router.delete('/:id', asyncHandler(async (req, res) => {
	try {
		const result = await deleteProvider(req.params.id);
		res.json(result);
	} catch (error) {
		if (error?.status === 404) {
			throw httpError(404, 'Provider not found', 'PROVIDER_NOT_FOUND');
		}
		throw error;
	}
}));

export default router;
