/**
 * Billing Control Plane RBAC (BP-1).
 * Platform admins (role === 'admin') are Super Admins and hold all billing permissions.
 */

import { httpError } from './require-admin.js';

export const BILLING_PERMISSIONS = Object.freeze({
	READ: 'admin.billing.read',
	MANAGE: 'admin.billing.manage',
	SECRETS_WRITE: 'admin.billing.secrets.write',
});

export function isBillingSuperAdmin(user) {
	return String(user?.role || '').toLowerCase() === 'admin';
}

export function getBillingPermissions(user) {
	const allowed = isBillingSuperAdmin(user);
	return {
		[BILLING_PERMISSIONS.READ]: allowed,
		[BILLING_PERMISSIONS.MANAGE]: allowed,
		[BILLING_PERMISSIONS.SECRETS_WRITE]: allowed,
	};
}

export function assertBillingPermission(user, permission) {
	const permissions = getBillingPermissions(user);
	if (!permissions[permission]) {
		throw httpError(403, `Missing permission: ${permission}`, 'BILLING_PERMISSION_DENIED');
	}
}

export function requireBillingPermission(permission) {
	return (req, _res, next) => {
		try {
			assertBillingPermission(req.adminUser, permission);
			req.billingPermissions = getBillingPermissions(req.adminUser);
			return next();
		} catch (error) {
			return next(error);
		}
	};
}
