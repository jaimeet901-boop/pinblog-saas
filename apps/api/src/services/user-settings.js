import pocketbaseClient from '../utils/pocketbaseClient.js';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../utils/secretCrypto.js';

export async function getOwnedUserSettings(owner) {
	return pocketbaseClient.collection('user_settings').getFirstListItem(
		pocketbaseClient.filter('owner = {:owner}', { owner }),
	).catch(() => null);
}

function hasStoredSecret(value) {
	return Boolean(String(value || '').trim());
}

export function mapSettingsResponse(record) {
	if (!record) {
		return {
			openai_key: '',
			has_openai_key: false,
			gemini_key: '',
			has_gemini_key: false,
			fal_key: '',
			has_fal_key: false,
			pinterest_token: '',
			has_pinterest_token: false,
			email_from: '',
		};
	}

	return {
		openai_key: '',
		has_openai_key: hasStoredSecret(record.openai_key),
		gemini_key: '',
		has_gemini_key: hasStoredSecret(record.gemini_key),
		fal_key: '',
		has_fal_key: hasStoredSecret(record.fal_key),
		pinterest_token: '',
		has_pinterest_token: hasStoredSecret(record.pinterest_token),
		email_from: record.email_from || '',
	};
}

function encryptOptionalSecret(value) {
	const normalized = typeof value === 'string' ? value.trim() : '';
	if (!normalized) return '';
	return encryptSecret(normalized);
}

async function migratePlaintextSecret({ recordId, field, plainValue }) {
	if (!recordId || !plainValue || isEncryptedSecret(plainValue)) {
		return;
	}
	await pocketbaseClient.collection('user_settings').update(recordId, {
		[field]: encryptSecret(String(plainValue).trim()),
	}).catch(() => null);
}

async function readDecryptedField(settings, field) {
	const raw = settings?.[field] || '';
	if (!raw) return '';
	const key = isEncryptedSecret(raw) ? decryptSecret(raw) : String(raw).trim();
	if (key && settings?.id && !isEncryptedSecret(raw)) {
		await migratePlaintextSecret({ recordId: settings.id, field, plainValue: raw });
	}
	return key;
}

export async function upsertOwnedUserSettings({ owner, payload }) {
	const existing = await getOwnedUserSettings(owner);
	const updates = {};

	if ('email_from' in payload) {
		updates.email_from = payload.email_from || '';
	}

	if ('gemini_key' in payload) {
		updates.gemini_key = encryptOptionalSecret(payload.gemini_key);
	}
	if ('fal_key' in payload) {
		updates.fal_key = encryptOptionalSecret(payload.fal_key);
	}
	if ('pinterest_token' in payload) {
		updates.pinterest_token = encryptOptionalSecret(payload.pinterest_token);
	}
	if (typeof payload.openai_key === 'string') {
		updates.openai_key = encryptOptionalSecret(payload.openai_key);
	}

	if (existing) {
		return pocketbaseClient.collection('user_settings').update(existing.id, updates);
	}

	return pocketbaseClient.collection('user_settings').create({
		owner,
		openai_key: updates.openai_key || '',
		gemini_key: updates.gemini_key || '',
		fal_key: updates.fal_key || '',
		pinterest_token: updates.pinterest_token || '',
		email_from: updates.email_from || '',
	});
}

export async function getDecryptedOpenAIKey(owner) {
	const settings = await getOwnedUserSettings(owner);
	return readDecryptedField(settings, 'openai_key');
}

export async function getDecryptedFalKey(owner) {
	const settings = await getOwnedUserSettings(owner);
	return readDecryptedField(settings, 'fal_key');
}

export async function getDecryptedGeminiKey(owner) {
	const settings = await getOwnedUserSettings(owner);
	return readDecryptedField(settings, 'gemini_key');
}

export async function getDecryptedPinterestToken(owner) {
	const settings = await getOwnedUserSettings(owner);
	return readDecryptedField(settings, 'pinterest_token');
}
