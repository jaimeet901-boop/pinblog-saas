import { httpError } from '../middleware/require-admin.js';

/** @typedef {'owner'|'editor'|'author'|'viewer'} WorkspaceRole */

export const WORKSPACE_CAPABILITIES = {
	'workspace.read': true,
	'workspace.members.manage': true,
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
};

const ROLE_CAPS = {
	owner: Object.keys(WORKSPACE_CAPABILITIES),
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
};

export function roleHasCapability(role, capability) {
	const caps = ROLE_CAPS[role] || ROLE_CAPS.viewer;
	return caps.includes(capability);
}

export function assertCapability(req, capability) {
	const role = req.workspaceRole || 'viewer';
	if (!roleHasCapability(role, capability)) {
		throw httpError(403, `Missing capability: ${capability}`, 'FORBIDDEN');
	}
}

export function mapMemberDto(record) {
	return {
		id: record.id,
		workspaceId: typeof record.workspace === 'string' ? record.workspace : record.workspace,
		userId: typeof record.user === 'string' ? record.user : record.user,
		role: record.role || 'viewer',
		status: record.status || 'active',
		joinedAt: record.joined_at || record.created,
		created: record.created,
		updated: record.updated,
	};
}
