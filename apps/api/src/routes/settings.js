import { Router } from 'express';
import { pocketbaseAuth } from '../middleware/pocketbase-auth.js';
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

router.get('/', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const record = await getOwnedUserSettings(owner);
	res.json(mapSettingsResponse(record));
});

router.put('/', async (req, res) => {
	const owner = req.pocketbaseUserId;
	const payload = {
		openai_key: 'openai_key' in (req.body || {}) ? normalizeOptionalString(req.body.openai_key, 'openai_key', 500) : undefined,
		gemini_key: normalizeOptionalString(req.body?.gemini_key, 'gemini_key', 300),
		fal_key: normalizeOptionalString(req.body?.fal_key, 'fal_key', 300),
		pinterest_token: normalizeOptionalString(req.body?.pinterest_token, 'pinterest_token', 500),
		email_from: normalizeOptionalString(req.body?.email_from, 'email_from', 200),
	};

	const updated = await upsertOwnedUserSettings({ owner, payload });
	res.json(mapSettingsResponse(updated));
});

export default router;
