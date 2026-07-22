import { getEnv } from '../utils/env.js';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { writeSecurityEvent } from '../services/audit/write.js';

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
			writeSecurityEvent({
				eventType: 'permission_denied',
				title: 'Permission Denied',
				detail: `Non-admin user attempted admin API (${req.originalUrl || req.url || ''})`,
				actorUserId: userId,
				actorLabel: user?.name || user?.email || userId,
				ip: String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
				severity: 'warn',
				meta: { path: req.originalUrl || req.url || '', role },
			}).catch(() => null);
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
