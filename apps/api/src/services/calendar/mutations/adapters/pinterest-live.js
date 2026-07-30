/**
 * Live PocketBase wiring for the Pinterest calendar mutation adapter.
 */

import pocketbaseClient from '../../../../utils/pocketbaseClient.js';
import { sanitizeCollectionPayload } from '../../../../utils/pocketbase-safe-query.js';
import { resolveScheduledAtUtc } from '../../../../utils/timezone.js';
import { getWorkspaceActor } from '../../../workspace-ownership.js';
import {
	getOwnedPinterestAccount,
	getOwnedPinterestAccountById,
} from '../../../pinterest-api.js';
import { createPinterestMutationAdapter } from './pinterest.js';

function freezeError(status, message, errorCode = 'VALIDATION_ERROR') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

async function assertPinterestConnected(owner, accountId = '', req = null) {
	const account = accountId
		? await getOwnedPinterestAccountById({ owner, accountId, req })
		: await getOwnedPinterestAccount(owner, req);

	if (!account) {
		throw freezeError(422, 'Pinterest account is not connected');
	}
	const status = String(account.status || '').trim();
	const usable = account.connected && (!status || status === 'connected');
	if (!usable) {
		throw freezeError(422, 'Selected Pinterest account is not connected. Please reconnect it.');
	}
	return account;
}

export function createLivePinterestMutationAdapter() {
	return createPinterestMutationAdapter({
		getOwner: (req) => getWorkspaceActor(req).workspaceOwnerId || req.pocketbaseUserId,
		getJob: async (jobId) => pocketbaseClient.collection('pinterest_publish_jobs').getOne(jobId).catch(() => null),
		updateJob: async (jobId, payload) => pocketbaseClient.collection('pinterest_publish_jobs').update(jobId, payload),
		updatePin: async (pinId, payload) => pocketbaseClient.collection('ai_pins').update(pinId, payload),
		createEvent: async (payload) => pocketbaseClient.collection('pinterest_publish_events').create(payload),
		sanitize: sanitizeCollectionPayload,
		resolveScheduledAtUtc,
		assertPinterestConnected,
	});
}
