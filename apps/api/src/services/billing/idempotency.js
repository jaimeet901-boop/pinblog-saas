import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { httpError } from '../../middleware/require-admin.js';

/**
 * Persist processed payment / purchase / webhook keys to prevent duplicates.
 */
export async function claimIdempotencyKey({
	idempotencyKey,
	scope = 'payment',
	workspaceKey = '',
	provider = '',
	eventType = '',
	payload = {},
} = {}) {
	const key = String(idempotencyKey || '').trim().slice(0, 180);
	if (!key) {
		throw httpError(422, 'idempotencyKey is required', 'VALIDATION_ERROR');
	}

	const existing = await pocketbaseClient.collection('billing_idempotency').getFirstListItem(
		pocketbaseClient.filter('idempotency_key = {:key}', { key }),
		{ requestKey: null },
	).catch(() => null);

	if (existing) {
		return {
			claimed: false,
			duplicate: true,
			record: existing,
			result: existing.result || null,
		};
	}

	try {
		const created = await pocketbaseClient.collection('billing_idempotency').create({
			idempotency_key: key,
			scope: String(scope || 'payment').slice(0, 40),
			workspace_key: workspaceKey || '',
			provider: provider || '',
			event_type: String(eventType || '').slice(0, 120),
			status: 'processing',
			payload: payload || {},
			result: {},
			processed_at: null,
		});
		return { claimed: true, duplicate: false, record: created };
	} catch (error) {
		// Unique index race — treat as duplicate.
		const raced = await pocketbaseClient.collection('billing_idempotency').getFirstListItem(
			pocketbaseClient.filter('idempotency_key = {:key}', { key }),
			{ requestKey: null },
		).catch(() => null);
		if (raced) {
			return {
				claimed: false,
				duplicate: true,
				record: raced,
				result: raced.result || null,
			};
		}
		throw error;
	}
}

export async function completeIdempotency(recordId, result = {}, status = 'completed') {
	if (!recordId) return null;
	return pocketbaseClient.collection('billing_idempotency').update(recordId, {
		status,
		result: result || {},
		processed_at: new Date().toISOString(),
	}).catch(() => null);
}

export async function failIdempotency(recordId, errorMessage = '') {
	if (!recordId) return null;
	return pocketbaseClient.collection('billing_idempotency').update(recordId, {
		status: 'failed',
		result: { error: String(errorMessage || '').slice(0, 1000) },
		processed_at: new Date().toISOString(),
	}).catch(() => null);
}
