import { Router } from 'express';
import { pocketbaseAuth } from '../middleware/pocketbase-auth.js';
import { attachWorkspace, requireWorkspaceCapability, requireWorkspaceRead } from '../middleware/product-access.js';
import { mapSettingsResponse, getOwnedUserSettings, upsertOwnedUserSettings } from '../services/user-settings.js';

const router = Router();

function httpError(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

function normalizeOptionalString(value, fieldName, max = 0) {
	if (value == null) {
		return '';
	}
	if (typeof value !== 'string') {
		throw httpError(422, `${fieldName} must be a string`);
	}
	const normalized = value.trim();
	if (max > 0 && normalized.length > max) {
		throw httpError(422, `${fieldName} must be ${max} characters or less`);
	}
	return normalized;
}

router.use(pocketbaseAuth);
router.use(attachWorkspace);
router.use(requireWorkspaceRead);

router.get('/', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const record = await getOwnedUserSettings(owner, req);
	res.json(mapSettingsResponse(record));
});

router.put('/', requireWorkspaceCapability('workspace.api_keys.manage'), async (req, res) => {
	const owner = req.pocketbaseUserId;
	const body = req.body || {};
	const hasLegacyAiKey = ['openai_key', 'gemini_key', 'fal_key'].some((field) => field in body);
	if (hasLegacyAiKey) {
		throw httpError(422, 'AI settings cannot be updated here.');
	}
	const payload = {
		email_from: normalizeOptionalString(body.email_from, 'email_from', 200),
	};
	if ('pinterest_token' in body) {
		payload.pinterest_token = normalizeOptionalString(body.pinterest_token, 'pinterest_token', 500);
	}

	const updated = await upsertOwnedUserSettings({ owner, payload, req });
	res.json(mapSettingsResponse(updated));
});

export default router;
