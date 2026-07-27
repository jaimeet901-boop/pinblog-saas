import { httpError } from '../middleware/require-admin.js';

/** @typedef {'owner'|'administrator'|'editor'|'author'|'viewer'|'custom'} WorkspaceRole */

export const WORKSPACE_ROLES = ['owner', 'administrator', 'editor', 'author', 'viewer', 'custom'];

export const WORKSPACE_CAPABILITIES = {
	'workspace.read': true,
	'workspace.members.manage': true,
	'workspace.roles.manage': true,
	'workspace.billing.manage': true,
	'workspace.websites.manage': true,
	'workspace.wordpress.publish': true,
	'workspace.pinterest.manage': true,
	'workspace.pinterest.publish': true,
	'workspace.content.write': true,
	'workspace.content.publish': true,
	'workspace.ai.generate': true,
	'workspace.templates.manage': true,
	'workspace.brandkits.manage': true,
	'workspace.analytics.read': true,
	'workspace.settings.manage': true,
	'workspace.api_keys.manage': true,
	'workspace.exports.create': true,
	'workspace.notifications.manage': true,
	'workspace.calendar.manage': true,
	'workspace.ownership.transfer': true,
};

const ALL_CAPS = Object.keys(WORKSPACE_CAPABILITIES);

const ROLE_CAPS = {
	owner: ALL_CAPS,
	administrator: ALL_CAPS.filter((cap) => cap !== 'workspace.ownership.transfer'),
	editor: [
		'workspace.read',
		'workspace.websites.manage',
		'workspace.wordpress.publish',
		'workspace.pinterest.manage',
		'workspace.pinterest.publish',
		'workspace.content.write',
		'workspace.content.publish',
		'workspace.ai.generate',
		'workspace.templates.manage',
		'workspace.brandkits.manage',
		'workspace.analytics.read',
		'workspace.settings.manage',
		'workspace.exports.create',
		'workspace.notifications.manage',
		'workspace.calendar.manage',
	],
	author: [
		'workspace.read',
		'workspace.wordpress.publish',
		'workspace.pinterest.publish',
		'workspace.content.write',
		'workspace.content.publish',
		'workspace.ai.generate',
		'workspace.analytics.read',
		'workspace.exports.create',
		'workspace.calendar.manage',
	],
	viewer: [
		'workspace.read',
		'workspace.analytics.read',
	],
	custom: [
		'workspace.read',
	],
};

export function normalizeWorkspaceRole(role) {
	const raw = String(role || 'viewer').trim().toLowerCase();
	if (raw === 'admin' || raw === 'administrator') return 'administrator';
	if (WORKSPACE_ROLES.includes(raw)) return raw;
	return 'viewer';
}

function parsePermissions(raw) {
	if (Array.isArray(raw)) {
		return raw.map((item) => String(item || '').trim()).filter((item) => WORKSPACE_CAPABILITIES[item]);
	}
	if (raw && typeof raw === 'object') {
		return Object.entries(raw)
			.filter(([, enabled]) => Boolean(enabled))
			.map(([key]) => String(key).trim())
			.filter((key) => WORKSPACE_CAPABILITIES[key]);
	}
	if (typeof raw === 'string' && raw.trim()) {
		try {
			return parsePermissions(JSON.parse(raw));
		} catch {
			return [];
		}
	}
	return [];
}

export function capabilitiesForMembership(membership = {}) {
	const role = normalizeWorkspaceRole(membership.role);
	const base = ROLE_CAPS[role] || ROLE_CAPS.viewer;
	const custom = parsePermissions(membership.permissions)
		.filter((cap) => role === 'owner' || cap !== 'workspace.ownership.transfer');
	if (role === 'custom') {
		return Array.from(new Set(['workspace.read', ...custom]));
	}
	if (!custom.length) return [...base];
	if (role === 'owner') return ALL_CAPS;
	return Array.from(new Set([...base, ...custom]));
}

export function roleHasCapability(role, capability, membership = null) {
	if (membership) {
		return capabilitiesForMembership(membership).includes(capability);
	}
	const caps = ROLE_CAPS[normalizeWorkspaceRole(role)] || ROLE_CAPS.viewer;
	return caps.includes(capability);
}

export function assertCapability(req, capability) {
	const membership = req.workspaceMembership || { role: req.workspaceRole || 'viewer' };
	if (membership.status === 'suspended') {
		throw httpError(403, 'Member is suspended', 'MEMBER_SUSPENDED');
	}
	if (!roleHasCapability(membership.role, capability, membership)) {
		throw httpError(403, `Missing capability: ${capability}`, 'FORBIDDEN');
	}
}

export function mapMemberDto(record, extras = {}) {
	const role = normalizeWorkspaceRole(record.role || 'viewer');
	const permissions = capabilitiesForMembership(record);
	const isSelfInvite = Boolean(
		extras.viewerId
		&& record.user
		&& String(extras.viewerId) === String(record.user)
		&& record.status === 'invited',
	);
	return {
		id: record.id,
		workspaceId: typeof record.workspace === 'string' ? record.workspace : record.workspace,
		userId: typeof record.user === 'string' ? record.user : (record.user || ''),
		email: extras.email || record.invite_email || extras.user?.email || '',
		name: extras.name || extras.user?.name || '',
		role,
		customRoleName: record.custom_role_name || '',
		status: record.status || 'active',
		permissions,
		permissionOverrides: parsePermissions(record.permissions),
		joinedAt: record.joined_at || record.created,
		lastActiveAt: record.last_active_at || null,
		suspendedAt: record.suspended_at || null,
		suspendedReason: record.suspended_reason || '',
		inviteExpiresAt: record.invite_expires_at || null,
		...(isSelfInvite ? { inviteToken: record.invite_token || '' } : {}),
		created: record.created,
		updated: record.updated,
	};
}

export function listSystemRoles() {
	return WORKSPACE_ROLES.filter((role) => role !== 'custom').map((role) => ({
		id: role,
		name: role === 'administrator' ? 'Administrator' : role.charAt(0).toUpperCase() + role.slice(1),
		permissions: ROLE_CAPS[role] || [],
		system: true,
	}));
}
