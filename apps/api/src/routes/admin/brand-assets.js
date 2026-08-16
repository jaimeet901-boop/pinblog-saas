import { Router } from 'express';
import { uploadFiles } from '../../middleware/file-upload.js';
import { httpError } from '../../middleware/require-admin.js';
import {
	PLATFORM_BRAND_ASSET_KEYS,
	PLATFORM_BRAND_ASSET_RULES,
	removePlatformBrandAsset,
	restorePlatformBrandAsset,
	uploadPlatformBrandAsset,
} from '../../services/platform-brand-assets.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

function actorFromReq(req) {
	return {
		id: req.adminUser?.id || req.pocketbaseUserId,
		email: req.adminUser?.email,
		name: req.adminUser?.name,
	};
}

function parseDimension(value) {
	if (value == null || value === '') return null;
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return null;
	return Math.round(n);
}

const ALL_MIME = Array.from(new Set(
	Object.values(PLATFORM_BRAND_ASSET_RULES).flatMap((rule) => rule.allowedMimeTypes),
));

const uploadBrandAsset = uploadFiles({
	maxCount: 1,
	maxSizeMB: 5,
	allowedMimeTypes: ALL_MIME,
	fieldName: 'file',
});

router.get('/', asyncHandler(async (_req, res) => {
	res.json({
		assets: PLATFORM_BRAND_ASSET_KEYS.map((key) => ({
			key,
			...PLATFORM_BRAND_ASSET_RULES[key],
		})),
	});
}));

router.post('/:assetKey/restore', asyncHandler(async (req, res) => {
	const result = await restorePlatformBrandAsset({
		assetKey: req.params.assetKey,
		actor: actorFromReq(req),
	});
	res.json(result);
}));

router.post('/:assetKey', (req, res, next) => {
	uploadBrandAsset(req, res, (error) => {
		if (error) {
			if (error.code === 'LIMIT_FILE_SIZE') {
				return next(httpError(413, 'Image is too large (max 5MB). Compress and try again.', 'PAYLOAD_TOO_LARGE'));
			}
			return next(httpError(422, error.message || 'Invalid brand asset upload', 'VALIDATION_ERROR'));
		}
		return next();
	});
}, asyncHandler(async (req, res) => {
	const file = Array.isArray(req.files) ? req.files[0] : null;
	const result = await uploadPlatformBrandAsset({
		assetKey: req.params.assetKey,
		file,
		width: parseDimension(req.body?.width),
		height: parseDimension(req.body?.height),
		actor: actorFromReq(req),
	});
	res.status(201).json(result);
}));

router.delete('/:assetKey', asyncHandler(async (req, res) => {
	const result = await removePlatformBrandAsset({
		assetKey: req.params.assetKey,
		actor: actorFromReq(req),
	});
	res.json(result);
}));

export default router;
