export function canAccessAdminConsole(user) {
	return String(user?.role || '').toLowerCase() === 'admin';
}

/** Frontend RBAC preparation — billing write actions are enforced on the API. */
export const BILLING_PERMISSIONS = Object.freeze({
	READ: 'admin.billing.read',
	MANAGE: 'admin.billing.manage',
	SECRETS_WRITE: 'admin.billing.secrets.write',
});

/** Super Admin (platform admin role) holds all billing Control Plane permissions. */
export function getBillingPermissions(user) {
	const allowed = canAccessAdminConsole(user);
	return {
		[BILLING_PERMISSIONS.READ]: allowed,
		[BILLING_PERMISSIONS.MANAGE]: allowed,
		[BILLING_PERMISSIONS.SECRETS_WRITE]: allowed,
	};
}

/** Frontend RBAC preparation only — no backend enforcement for nav visibility. */
export const ADMIN_NAV = [
	{ to: '/admin/dashboard', label: 'Dashboard', end: true },
	{ to: '/admin/users', label: 'Users' },
	{ to: '/admin/workspaces', label: 'Workspaces' },
	{ to: '/admin/plans', label: 'Plans & Credits' },
	{ to: '/admin/credits', label: 'Credits' },
	{ to: '/admin/billing/providers', label: 'Billing Providers' },
	{ to: '/admin/billing/logs', label: 'Billing Logs' },
	{ to: '/admin/billing/health', label: 'Provider Health' },
	{ to: '/admin/billing/price-mapping', label: 'Price Mapping' },
	{ to: '/admin/billing/failover', label: 'Failover & Recovery' },
	{ to: '/admin/billing/events', label: 'Payment Events' },
	{ to: '/admin/billing/webhooks', label: 'Webhook Monitor' },
	{ to: '/admin/billing/monitoring', label: 'Billing Monitoring' },
	{ to: '/admin/billing/backup', label: 'Disaster Recovery' },
	{ to: '/admin/billing', label: 'Billing Dashboard', end: true },
	{ to: '/admin/providers', label: 'AI Providers' },
	{ to: '/admin/models', label: 'AI Models' },
	{ to: '/admin/websites', label: 'Websites' },
	{ to: '/admin/pinterest', label: 'Pinterest Accounts' },
	{ to: '/admin/facebook', label: 'Facebook Accounts' },
	{ to: '/admin/authentication-providers', label: 'Authentication Providers' },
	{ to: '/admin/mail', label: 'Mail Diagnostics' },
	{ to: '/admin/analytics', label: 'Analytics' },
	{ to: '/admin/queue', label: 'Queue Monitor' },
	{ to: '/admin/jobs', label: 'Jobs' },
	{ to: '/admin/logs', label: 'Logs' },
	{ to: '/admin/notifications', label: 'Notifications' },
	{ to: '/admin/legal-pages', label: 'Legal Pages' },
	{ to: '/admin/platform-identity', label: 'Platform Identity' },
	{ to: '/admin/settings', label: 'Global Settings' },
	{ to: '/admin/system', label: 'System Health' },
	// Workspace managers — same routes, not shown in user sidebar
	{ to: '/app/ai-pins/templates', label: 'Templates' },
	{ to: '/app/ai-pins/brand-kit', label: 'Brand Kit' },
];
