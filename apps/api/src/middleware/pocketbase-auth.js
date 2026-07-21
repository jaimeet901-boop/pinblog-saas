import { Buffer } from 'node:buffer';
import Pocketbase from 'pocketbase';
import logger from '../utils/logger.js';
import { getEnv } from '../utils/env.js';

const PB_BASE_URL = getEnv('PB_BASE_URL', 'http://localhost:8090');

function parseBearerToken(authorizationHeader) {
	if (typeof authorizationHeader !== 'string') {
		return '';
	}

	const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || '';
}

function parseAuthPayload(token) {
	try {
		const decoded = Buffer.from(token, 'base64').toString('utf-8');
		const parsed = JSON.parse(decoded);

		if (!parsed || typeof parsed !== 'object') {
			return { token: '', record: null };
		}

		const record = parsed.record || null;
		if (typeof parsed.token !== 'string' || !parsed.token.trim() || !record) {
			return { token: '', record: null };
		}

		return {
			token: parsed.token.trim(),
			record,
		};
	} catch {
		return { token: '', record: null };
	}
}

function unauthorizedError(message) {
	const error = new Error(message);
	error.status = 401;
	return error;
}

function isPublicWebsiteMetadataRequest(req) {
	if (req.method !== 'POST') {
		return false;
	}

	const combinedPath = `${req.baseUrl || ''}${req.path || ''}`;
	const originalUrl = String(req.originalUrl || '').split('?')[0];

	return req.path === '/metadata'
		|| combinedPath.endsWith('/websites/metadata')
		|| originalUrl.endsWith('/websites/metadata');
}

export async function pocketbaseAuth(req, res, next) {
	// Metadata enrichment is optional UX; keep it reachable even if the browser
	// momentarily fails to attach auth (create/list/scan still require auth).
	if (isPublicWebsiteMetadataRequest(req)) {
		return next();
	}

	const bearerToken = parseBearerToken(req.headers.authorization);

	// Auth is enforced by default. To allow public (anonymous) access, remove this
	// middleware from the route (apps/api/src/routes/integrated-ai.js).
	if (!bearerToken) {
		return next(unauthorizedError('Please sign in or create an account to use the chat.'));
	}

	try {
		const authPayload = parseAuthPayload(bearerToken);

		if (!authPayload.token) {
			return next(unauthorizedError('Your session has expired. Please sign in again.'));
		}

		// by refreshing token we verify that it was not intercepted by a malicious user
		const pocketbaseClient = new Pocketbase(PB_BASE_URL);
		pocketbaseClient.authStore.save(authPayload.token, authPayload.record);

		const collectionName = authPayload.record?.collectionName;
		if (!collectionName) {
			return next(unauthorizedError('Your session has expired. Please sign in again.'));
		}
		const newToken = await pocketbaseClient.collection(collectionName).authRefresh();

		req.pocketbaseUserId = newToken.record.id;
		logger.info(`Authentication success for user ${req.pocketbaseUserId}`);

		return next();
	} catch (error) {
		logger.warn('Authentication failed: invalid or expired token');
		return next(unauthorizedError('Your session has expired. Please sign in again.'));
	}
}
