import pocketbaseClient from '../utils/pocketbaseClient.js';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../utils/secretCrypto.js';
import { getWorkspaceActor, stampCreateOwnership, andWorkspaceScope } from './workspace-ownership.js';

export async function getOwnedUserSettings(owner, req = null) {
	if (req?.workspace?.id) {
		const workspaceScoped = await pocketbaseClient.collection('user_settings').getFirstListItem(
			andWorkspaceScope(req),
		).catch(() => null);
		if (workspaceScoped) {
			return workspaceScoped;
		}
	}
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
			pinterest_token: '',
			has_pinterest_token: false,
			email_from: '',
		};
	}

	return {
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

export async function upsertOwnedUserSettings({ owner, payload, req = null }) {
	const existing = await getOwnedUserSettings(owner, req);
	const updates = {};

	if ('email_from' in payload) {
		updates.email_from = payload.email_from || '';
	}

	if ('pinterest_token' in payload) {
		updates.pinterest_token = encryptOptionalSecret(payload.pinterest_token);
	}

	if (existing) {
		return pocketbaseClient.collection('user_settings').update(existing.id, updates);
	}

	const actor = req ? getWorkspaceActor(req) : null;
	const createPayload = {
		owner: actor?.workspaceOwnerId || owner,
		pinterest_token: updates.pinterest_token || '',
		email_from: updates.email_from || '',
	};
	return pocketbaseClient.collection('user_settings').create(
		req ? stampCreateOwnership(req, createPayload) : createPayload,
	);
}

export async function getDecryptedPinterestToken(owner) {
	const settings = await getOwnedUserSettings(owner);
	return readDecryptedField(settings, 'pinterest_token');
}
