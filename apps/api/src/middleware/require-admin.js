import { getEnv } from '../utils/env.js';
import pocketbaseClient from '../utils/pocketbaseClient.js';

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

/**
 * Ensure the caller is an authenticated platform admin.
 * Must run after pocketbaseAuth (req.pocketbaseUserId set).
 */
export async function requireAdmin(req, res, next) {
	try {
		const userId = req.pocketbaseUserId;
		if (!userId) {
			return next(httpError(401, 'Please sign in to continue.', 'UNAUTHENTICATED'));
		}

		const user = await pocketbaseClient.collection('users').getOne(userId);
		const role = String(user?.role || '').toLowerCase();
		if (role !== 'admin') {
			return next(httpError(403, 'Admin access required.', 'ADMIN_REQUIRED'));
		}

		req.adminUser = user;
		return next();
	} catch (error) {
		if (error?.status) {
			return next(error);
		}
		return next(httpError(401, 'Your session has expired. Please sign in again.', 'UNAUTHENTICATED'));
	}
}

export function assertAdminEnabled() {
	const disabled = String(getEnv('ADMIN_API_DISABLED', '')).toLowerCase() === 'true';
	if (disabled) {
		throw httpError(503, 'Admin API is temporarily disabled.', 'ADMIN_DISABLED');
	}
}

export { httpError };
