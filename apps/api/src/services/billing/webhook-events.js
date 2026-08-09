import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { WEBHOOK_EVENT_STATUSES } from './billing-model.js';
import {
	canRetryWebhookEvent,
	isTerminalWebhookStatus,
	sanitizeWebhookPayloadForStorage,
} from './webhook-event-status.js';

export { canRetryWebhookEvent, isTerminalWebhookStatus } from './webhook-event-status.js';

export const WEBHOOK_EVENTS_COLLECTION = 'billing_webhook_events';

function sanitizePayloadForStorage(payload = {}) {
	return sanitizeWebhookPayloadForStorage(payload);
}

export async function findWebhookEvent({ provider, eventId }) {
	const filter = pocketbaseClient.filter(
		'provider = {:provider} && event_id = {:eventId}',
		{ provider, eventId: String(eventId || '').slice(0, 180) },
	);
	return pocketbaseClient.collection(WEBHOOK_EVENTS_COLLECTION).getFirstListItem(filter, {
		requestKey: null,
	}).catch(() => null);
}

export async function createWebhookEvent({
	provider,
	eventId,
	eventType = '',
	transactionId = '',
	subscriptionId = '',
	workspaceKey = '',
	status = 'received',
	payload = null,
	error = '',
} = {}) {
	return pocketbaseClient.collection(WEBHOOK_EVENTS_COLLECTION).create({
		provider,
		event_id: String(eventId || '').slice(0, 180),
		event_type: String(eventType || '').slice(0, 120),
		transaction_id: String(transactionId || '').slice(0, 120),
		subscription_id: String(subscriptionId || '').slice(0, 120),
		workspace_key: String(workspaceKey || '').slice(0, 120),
		status,
		payload: payload != null ? sanitizePayloadForStorage(payload) : null,
		error: String(error || '').slice(0, 1000),
		processed_at: null,
	});
}

export async function updateWebhookEvent(recordId, patch = {}) {
	if (!recordId) return null;
	const body = { ...patch };
	if (patch.payload != null) {
		body.payload = sanitizePayloadForStorage(patch.payload);
	}
	if (patch.error != null) {
		body.error = String(patch.error || '').slice(0, 1000);
	}
	if (patch.status === 'processed' || patch.status === 'failed' || patch.status === 'ignored' || patch.status === 'duplicate') {
		body.processed_at = new Date().toISOString();
	}
	if (patch.status && !WEBHOOK_EVENT_STATUSES.includes(patch.status)) {
		delete body.status;
	}
	return pocketbaseClient.collection(WEBHOOK_EVENTS_COLLECTION).update(recordId, body).catch(() => null);
}
