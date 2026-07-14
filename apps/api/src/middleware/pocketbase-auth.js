import { Buffer } from 'node:buffer';
import Pocketbase from 'pocketbase';
import logger from '../utils/logger.js';
import { getEnv } from '../utils/env.js';

const PB_BASE_URL = getEnv('PB_BASE_URL', 'http://localhost:8090');

function unauthorizedError(message) {
	const error = new Error(message);
	error.status = 401;
	return error;
}

export async function pocketbaseAuth(req, res, next) {
	const token = req.headers.authorization?.split(' ')?.[1];

	// Auth is enforced by default. To allow public (anonymous) access, remove this
	// middleware from the route (apps/api/src/routes/integrated-ai.js).
	if (!token) {
		logger.warn('Authentication failed: missing bearer token');
		return next(unauthorizedError('Please sign in or create an account to use the chat.'));
	}

	try {
		const base64Decoded = Buffer.from(token, 'base64').toString('utf-8');
		const tokenData = JSON.parse(base64Decoded);

		if (!tokenData?.token || !tokenData?.record) {
			return next(unauthorizedError('Your session has expired. Please sign in again.'));
		}

		// by refreshing token we verify that it was not intercepted by a malicious user
		const pocketbaseClient = new Pocketbase(PB_BASE_URL);
		pocketbaseClient.authStore.save(tokenData.token, tokenData.record);
		const newToken = await pocketbaseClient.collection(tokenData.record.collectionName).authRefresh();

		req.pocketbaseUserId = newToken.record.id;
		logger.info(`Authentication success for user ${req.pocketbaseUserId}`);

		return next();
	} catch {
		logger.warn('Authentication failed: invalid or expired token');
		return next(unauthorizedError('Your session has expired. Please sign in again.'));
	}
}
