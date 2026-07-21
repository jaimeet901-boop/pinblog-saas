import pocketbaseClient from '../utils/pocketbaseClient.js';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../utils/secretCrypto.js';

export async function getOwnedUserSettings(owner) {
	return pocketbaseClient.collection('user_settings').getFirstListItem(
		pocketbaseClient.filter('owner = {:owner}', { owner }),
	).catch(() => null);
}

export function mapSettingsResponse(record) {
	if (!record) {
		return {
			openai_key: '',
			has_openai_key: false,
			gemini_key: '',
			fal_key: '',
			pinterest_token: '',
			email_from: '',
		};
	}

	return {
		openai_key: '',
		has_openai_key: Boolean(record.openai_key),
		gemini_key: record.gemini_key || '',
		fal_key: record.fal_key || '',
		pinterest_token: record.pinterest_token || '',
		email_from: record.email_from || '',
	};
}

export async function upsertOwnedUserSettings({ owner, payload }) {
	const existing = await getOwnedUserSettings(owner);
	const updates = {
		gemini_key: payload.gemini_key || '',
		fal_key: payload.fal_key || '',
		pinterest_token: payload.pinterest_token || '',
		email_from: payload.email_from || '',
	};

	if (typeof payload.openai_key === 'string') {
		const normalized = payload.openai_key.trim();
		updates.openai_key = normalized ? encryptSecret(normalized) : '';
	}

	if (existing) {
		return pocketbaseClient.collection('user_settings').update(existing.id, updates);
	}

	return pocketbaseClient.collection('user_settings').create({
		owner,
		...updates,
		openai_key: updates.openai_key || '',
	});
}

export async function getDecryptedOpenAIKey(owner) {
	const settings = await getOwnedUserSettings(owner);
	if (!settings?.openai_key) {
		return '';
	}

	const key = decryptSecret(settings.openai_key);
	if (!key) {
		return '';
	}

	if (!isEncryptedSecret(settings.openai_key)) {
		await pocketbaseClient.collection('user_settings').update(settings.id, {
			openai_key: encryptSecret(key),
		}).catch(() => null);
	}

	return key;
}

export async function getDecryptedFalKey(owner) {
	const settings = await getOwnedUserSettings(owner);
	const raw = settings?.fal_key || '';
	if (!raw) {
		return '';
	}
	if (isEncryptedSecret(raw)) {
		return decryptSecret(raw);
	}
	return String(raw).trim();
}
