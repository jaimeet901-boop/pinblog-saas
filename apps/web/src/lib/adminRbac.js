export function canAccessAdminConsole(user) {
	return String(user?.role || '').toLowerCase() === 'admin';
}

/** Frontend RBAC preparation only — no backend enforcement. */
export const ADMIN_NAV = [
	{ to: '/admin/dashboard', label: 'Dashboard', end: true },
	{ to: '/admin/users', label: 'Users' },
	{ to: '/admin/workspaces', label: 'Workspaces' },
	{ to: '/admin/plans', label: 'Plans & Credits' },
	{ to: '/admin/credits', label: 'Credits' },
	{ to: '/admin/providers', label: 'AI Providers' },
	{ to: '/admin/models', label: 'AI Models' },
	{ to: '/admin/websites', label: 'Websites' },
	{ to: '/admin/pinterest', label: 'Pinterest Accounts' },
	{ to: '/admin/analytics', label: 'Analytics' },
	{ to: '/admin/queue', label: 'Queue Monitor' },
	{ to: '/admin/jobs', label: 'Jobs' },
	{ to: '/admin/logs', label: 'Logs' },
	{ to: '/admin/notifications', label: 'Notifications' },
	{ to: '/admin/settings', label: 'Global Settings' },
	{ to: '/admin/system', label: 'System Health' },
];
