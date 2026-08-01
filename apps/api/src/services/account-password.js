import Pocketbase from 'pocketbase';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { getEnv } from '../utils/env.js';
import logger from '../utils/logger.js';

const PB_BASE_URL = getEnv('PB_BASE_URL', 'http://localhost:8090');
const MIN_PASSWORD_LENGTH = 10;

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function validateNewPassword(password, passwordConfirm) {
	const next = String(password || '');
	const confirm = String(passwordConfirm || '');

	if (next.length < MIN_PASSWORD_LENGTH) {
		throw httpError(422, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, 'PASSWORD_TOO_SHORT');
	}
	if (next !== confirm) {
		throw httpError(422, 'Password confirmation does not match.', 'PASSWORD_MISMATCH');
	}
}

async function listExternalAuths(userId) {
	try {
		const result = await pocketbaseClient.collection('_externalAuths').getList(1, 50, {
			filter: `recordRef = "${userId}"`,
		});
		return Array.isArray(result?.items) ? result.items : [];
	} catch (error) {
		logger.warn('account-password: failed to list external auths', {
			userId,
			message: error?.message,
		});
		return [];
	}
}

/**
 * Status for the Change/Set Password UI.
 * "No usable password" cannot be proven from PocketBase; OAuth-linked users
 * may set a password without knowing the current one (session-authenticated).
 */
export async function getAccountPasswordStatus(req) {
	const userId = req.pocketbaseUserId;
	const user = await pocketbaseClient.collection('users').getOne(userId);
	const externalAuths = await listExternalAuths(userId);
	const providers = externalAuths
		.map((item) => String(item?.provider || item?.name || '').toLowerCase())
		.filter(Boolean);

	return {
		userId,
		email: user?.email || '',
		verified: Boolean(user?.verified),
		hasExternalAuth: providers.length > 0,
		providers,
		canSetWithoutOldPassword: providers.length > 0,
		googleLinked: providers.includes('google'),
	};
}

async function verifyOldPassword(email, oldPassword) {
	const client = new Pocketbase(PB_BASE_URL);
	client.autoCancellation(false);
	try {
		await client.collection('users').authWithPassword(String(email || '').trim(), String(oldPassword || ''));
		return true;
	} catch {
		throw httpError(400, 'Current password is incorrect.', 'INVALID_OLD_PASSWORD');
	} finally {
		client.authStore.clear();
	}
}

/**
 * Change or set password for the authenticated user.
 *
 * - With oldPassword: verifies credentials, then updates via PocketBase password fields.
 * - Without oldPassword: allowed only when the account has linked OAuth (e.g. Google)
 *   so OAuth-only / random-reset users can recover while logged in.
 */
export async function updateAccountPassword(req, body = {}) {
	const userId = req.pocketbaseUserId;
	if (!userId) {
		throw httpError(401, 'Please sign in to continue.', 'UNAUTHENTICATED');
	}

	const password = body.password;
	const passwordConfirm = body.passwordConfirm;
	const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';

	validateNewPassword(password, passwordConfirm);

	const user = await pocketbaseClient.collection('users').getOne(userId);
	const email = String(user?.email || '').trim();
	if (!email) {
		throw httpError(400, 'Account email is missing.', 'EMAIL_REQUIRED');
	}

	const externalAuths = await listExternalAuths(userId);
	const hasExternalAuth = externalAuths.length > 0;

	if (!oldPassword && !hasExternalAuth) {
		throw httpError(
			400,
			'Current password is required to change your password.',
			'OLD_PASSWORD_REQUIRED',
		);
	}

	if (oldPassword) {
		await verifyOldPassword(email, oldPassword);
		// Official PocketBase password change: authenticated update with oldPassword.
		const userClient = new Pocketbase(PB_BASE_URL);
		userClient.autoCancellation(false);
		try {
			await userClient.collection('users').authWithPassword(email, oldPassword);
			await userClient.collection('users').update(userId, {
				oldPassword: String(oldPassword),
				password: String(password),
				passwordConfirm: String(passwordConfirm),
			});
		} catch (error) {
			logger.error('account-password: official change failed', {
				userId,
				message: error?.message,
				data: error?.response || error?.data,
			});
			const message = error?.response?.message || error?.message || 'Could not update password.';
			throw httpError(error?.status || 500, message, 'PASSWORD_UPDATE_FAILED');
		} finally {
			userClient.authStore.clear();
		}
	} else {
		try {
			// Session-authenticated set for OAuth-linked / random-reset accounts.
			// Client-side update requires oldPassword; superuser sets the new hash.
			await pocketbaseClient.collection('users').update(userId, {
				password: String(password),
				passwordConfirm: String(passwordConfirm),
			});
		} catch (error) {
			logger.error('account-password: set failed', {
				userId,
				message: error?.message,
				data: error?.response || error?.data,
			});
			const message = error?.response?.message || error?.message || 'Could not update password.';
			throw httpError(error?.status || 500, message, 'PASSWORD_UPDATE_FAILED');
		}
	}

	logger.info('account-password: password updated', {
		userId,
		mode: oldPassword ? 'change' : 'set',
		hasExternalAuth,
	});

	return {
		ok: true,
		mode: oldPassword ? 'change' : 'set',
		message: oldPassword
			? 'Password updated successfully.'
			: 'Password set successfully. You can now sign in with email and password.',
	};
}
