import crypto from 'crypto';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import {
	assertCapability,
	capabilitiesForMembership,
	listSystemRoles,
	mapMemberDto,
	normalizeWorkspaceRole,
	WORKSPACE_CAPABILITIES,
} from './workspace-rbac.js';
import { recordTypedWorkspaceActivity } from './workspace-activity.js';
import { notifyWorkspaceById } from './workspace-notify.js';
import { auditFromRequest, writeWorkspaceAudit } from './workspace-audit.js';
import { getPlatformSettings } from './platform-settings.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function slugify(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
}

async function loadUserMap(userIds = []) {
	const unique = [...new Set(userIds.filter(Boolean))];
	const map = new Map();
	await Promise.all(unique.map(async (id) => {
		const user = await pocketbaseClient.collection('users').getOne(id).catch(() => null);
		if (user) map.set(id, user);
	}));
	return map;
}

async function findMembershipById(workspaceId, membershipId) {
	const record = await pocketbaseClient.collection('workspace_members').getOne(membershipId).catch(() => null);
	if (!record || String(record.workspace) !== String(workspaceId)) {
		throw httpError(404, 'Member not found', 'NOT_FOUND');
	}
	return record;
}

async function findMembership(workspaceId, userId, statuses = ['active', 'invited', 'suspended']) {
	const rows = await pocketbaseClient.collection('workspace_members').getFullList({
		filter: pocketbaseClient.filter('workspace = {:ws} && user = {:user}', {
			ws: workspaceId,
			user: userId,
		}),
		requestKey: null,
	}).catch(() => []);
	return rows.find((row) => statuses.includes(row.status)) || null;
}

async function countActiveSeats(workspaceId) {
	const rows = await pocketbaseClient.collection('workspace_members').getFullList({
		filter: pocketbaseClient.filter('workspace = {:ws} && (status = "active" || status = "invited")', {
			ws: workspaceId,
		}),
		fields: 'id,status',
		requestKey: null,
	}).catch(() => []);
	return rows.length;
}

async function assertSeatAvailable(req) {
	const seats = Number(req.workspaceSubscription?.seats) || 1;
	const used = await countActiveSeats(req.workspace.id);
	if (used >= seats) {
		throw httpError(402, `Seat limit reached (${used}/${seats}). Upgrade plan or free a seat.`, 'SEAT_LIMIT');
	}
}

function parsePermissionOverrides(input, { allowOwnershipTransfer = false } = {}) {
	if (!input) return [];
	let caps = [];
	if (Array.isArray(input)) {
		caps = input.map((item) => String(item || '').trim()).filter((item) => WORKSPACE_CAPABILITIES[item]);
	} else if (typeof input === 'object') {
		caps = Object.entries(input)
			.filter(([, enabled]) => Boolean(enabled))
			.map(([key]) => key)
			.filter((key) => WORKSPACE_CAPABILITIES[key]);
	}
	if (!allowOwnershipTransfer) {
		caps = caps.filter((cap) => cap !== 'workspace.ownership.transfer');
	}
	return caps;
}

export async function listWorkspaceMembers(req, query = {}) {
	assertCapability(req, 'workspace.read');
	const includeRemoved = String(query.includeRemoved || '') === '1';
	const records = await pocketbaseClient.collection('workspace_members').getFullList({
		filter: pocketbaseClient.filter('workspace = {:ws}', { ws: req.workspace.id }),
		sort: '-updated',
		requestKey: null,
	}).catch(() => []);

	const filtered = records.filter((row) => includeRemoved || row.status !== 'removed');
	const userMap = await loadUserMap(filtered.map((row) => row.user).filter(Boolean));

	return {
		items: filtered.map((row) => mapMemberDto(row, {
			user: userMap.get(row.user),
			viewerId: req.pocketbaseUserId,
		})),
		totalItems: filtered.length,
		seats: {
			used: filtered.filter((row) => row.status === 'active' || row.status === 'invited').length,
			limit: Number(req.workspaceSubscription?.seats) || 1,
		},
		roles: listSystemRoles(),
		capabilities: Object.keys(WORKSPACE_CAPABILITIES),
	};
}

export async function inviteWorkspaceMember(req, payload = {}) {
	assertCapability(req, 'workspace.members.manage');
	const email = String(payload.email || '').trim().toLowerCase();
	const role = normalizeWorkspaceRole(payload.role || 'viewer');
	const permissions = parsePermissionOverrides(payload.permissions);
	const customRoleName = String(payload.customRoleName || payload.custom_role_name || '').trim().slice(0, 80);

	if (!email || !email.includes('@')) {
		throw httpError(422, 'Valid email is required', 'VALIDATION_ERROR');
	}
	if (role === 'owner') {
		throw httpError(422, 'Use ownership transfer to assign owner', 'VALIDATION_ERROR');
	}

	await assertSeatAvailable(req);

	let invitee = null;
	try {
		invitee = await pocketbaseClient.collection('users').getFirstListItem(
			pocketbaseClient.filter('email = {:email}', { email }),
			{ requestKey: null },
		);
	} catch {
		invitee = null;
	}

	if (invitee && String(invitee.id) === String(req.workspace.owner)) {
		throw httpError(409, 'Owner is already a member', 'ALREADY_MEMBER');
	}

	// Existing membership by user id or pending invite by email
	let existing = invitee
		? await findMembership(req.workspace.id, invitee.id, ['active', 'invited', 'suspended', 'removed'])
		: null;
	if (!existing) {
		const byEmail = await pocketbaseClient.collection('workspace_members').getFullList({
			filter: pocketbaseClient.filter('workspace = {:ws} && invite_email = {:email}', {
				ws: req.workspace.id,
				email,
			}),
			requestKey: null,
		}).catch(() => []);
		existing = byEmail.find((row) => ['active', 'invited', 'suspended'].includes(row.status)) || null;
	}

	if (existing?.status === 'active') {
		throw httpError(409, 'User is already an active member', 'ALREADY_MEMBER');
	}
	if (existing?.status === 'suspended') {
		throw httpError(409, 'User is suspended. Reactivate instead of inviting.', 'MEMBER_SUSPENDED');
	}

	const token = crypto.randomBytes(24).toString('hex');
	const invitePayload = {
		workspace: req.workspace.id,
		role,
		status: 'invited',
		permissions,
		custom_role_name: role === 'custom' ? customRoleName : '',
		invite_email: email,
		invite_token: token,
		invite_expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
		invite_sent_at: new Date().toISOString(),
		invited_by: req.pocketbaseUserId,
		suspended_at: null,
		suspended_reason: '',
	};
	if (invitee?.id) {
		invitePayload.user = invitee.id;
	}

	const membership = existing
		? await pocketbaseClient.collection('workspace_members').update(existing.id, invitePayload)
		: await pocketbaseClient.collection('workspace_members').create(invitePayload);

	await afterInvite(req, membership, email, { pendingAccount: !invitee });
	const { sendWorkspaceInviteEmail } = await import('./workspace-invite-mail.js');
	await sendWorkspaceInviteEmail({
		to: email,
		workspaceName: req.workspace.name,
		role: membership.role,
		token: membership.invite_token,
		inviterName: req.workspaceUser?.name || req.workspaceUser?.email || '',
	}).catch(() => null);
	await auditFromRequest(req, {
		action: 'invitation',
		title: 'Invitation sent',
		summary: `${email} invited as ${role}${invitee ? '' : ' (pending account)'}`,
		resourceType: 'workspace_members',
		resourceId: membership.id,
		meta: { email, role, pendingAccount: !invitee },
		mirrorActivity: false,
	});
	return mapMemberDto(membership, { user: invitee, email });
}

async function afterInvite(req, membership, email, { pendingAccount = false } = {}) {
	await recordTypedWorkspaceActivity(req, {
		type: 'members',
		title: 'Member invited',
		summary: `${email} invited as ${membership.role}${pendingAccount ? ' — awaiting signup' : ''}`,
		tone: 'default',
		meta: { event: 'invitation', email, role: membership.role, membershipId: membership.id, pendingAccount },
	});

	const { settings } = await getPlatformSettings().catch(() => ({ settings: null }));
	const platformName = String(settings?.general?.platformName || 'Chef IA').trim() || 'Chef IA';

	await notifyWorkspaceById({
		workspaceId: req.workspace.id,
		userId: req.workspace.owner,
		title: 'Workspace invitation sent',
		body: pendingAccount
			? `${email} was invited. They will join automatically after creating a ${platformName} account.`
			: `${email} was invited to ${req.workspace.name || 'the workspace'} as ${membership.role}.`,
		priority: 'normal',
		meta: { type: 'invitation', event: 'invitation', membershipId: membership.id },
		recordActivity: false,
	});

	if (membership.user) {
		await notifyWorkspaceById({
			workspaceId: req.workspace.id,
			userId: membership.user,
			title: 'You were invited',
			body: `You were invited to join ${req.workspace.name || 'a workspace'} as ${membership.role}.`,
			priority: 'high',
			meta: { type: 'invitation', event: 'invitation', membershipId: membership.id },
			recordActivity: false,
		});
	}
}

/**
 * Auto-accept pending email invites when a user signs up / first authenticates.
 */
export async function claimPendingInvitesForUser(userId, email) {
	const normalized = String(email || '').trim().toLowerCase();
	if (!userId || !normalized) return { claimed: [] };

	const pending = await pocketbaseClient.collection('workspace_members').getFullList({
		filter: pocketbaseClient.filter('invite_email = {:email} && status = "invited"', { email: normalized }),
		requestKey: null,
	}).catch(() => []);

	const claimed = [];
	for (const membership of pending) {
		if (membership.invite_expires_at && new Date(membership.invite_expires_at).getTime() < Date.now()) {
			continue;
		}
		if (membership.user && String(membership.user) !== String(userId)) {
			continue;
		}
		const updated = await pocketbaseClient.collection('workspace_members').update(membership.id, {
			user: userId,
			status: 'active',
			joined_at: new Date().toISOString(),
			invite_token: '',
			last_active_at: new Date().toISOString(),
		}).catch(() => null);
		if (!updated) continue;
		claimed.push(updated.id);

		await writeWorkspaceAudit({
			workspaceId: membership.workspace,
			actorId: userId,
			action: 'invitation',
			title: 'Invitation auto-accepted',
			summary: `${normalized} joined after signup`,
			resourceType: 'workspace_members',
			resourceId: membership.id,
			meta: { email: normalized, auto: true },
		});

		await notifyWorkspaceById({
			workspaceId: membership.workspace,
			userId: undefined,
			title: 'Member joined',
			body: `${normalized} accepted their invitation and joined the workspace.`,
			priority: 'normal',
			meta: { type: 'member_joined', event: 'member_joined', membershipId: membership.id, auto: true },
			recordActivity: false,
		});
	}

	return { claimed };
}

export async function resendWorkspaceInvite(req, membershipId) {
	assertCapability(req, 'workspace.members.manage');
	const membership = await findMembershipById(req.workspace.id, membershipId);
	if (membership.status !== 'invited') {
		throw httpError(422, 'Only pending invitations can be resent', 'VALIDATION_ERROR');
	}
	const token = crypto.randomBytes(24).toString('hex');
	const updated = await pocketbaseClient.collection('workspace_members').update(membershipId, {
		invite_token: token,
		invite_expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
		invite_sent_at: new Date().toISOString(),
		invite_resent_count: (Number(membership.invite_resent_count) || 0) + 1,
	});
	const email = updated.invite_email || '';
	await afterInvite(req, updated, email, { pendingAccount: !updated.user });
	const { sendWorkspaceInviteEmail } = await import('./workspace-invite-mail.js');
	await sendWorkspaceInviteEmail({
		to: email,
		workspaceName: req.workspace.name,
		role: updated.role,
		token: updated.invite_token,
		inviterName: req.workspaceUser?.name || '',
	}).catch(() => null);
	await auditFromRequest(req, {
		action: 'invitation',
		title: 'Invitation resent',
		summary: email,
		resourceType: 'workspace_members',
		resourceId: membershipId,
		meta: { resent: true },
		mirrorActivity: false,
	});
	return mapMemberDto(updated, { email });
}

export async function revokeWorkspaceInvite(req, membershipId) {
	assertCapability(req, 'workspace.members.manage');
	const membership = await findMembershipById(req.workspace.id, membershipId);
	if (membership.status !== 'invited') {
		throw httpError(422, 'Only pending invitations can be revoked', 'VALIDATION_ERROR');
	}
	const updated = await pocketbaseClient.collection('workspace_members').update(membershipId, {
		status: 'removed',
		invite_token: '',
	});
	await auditFromRequest(req, {
		action: 'invitation',
		title: 'Invitation revoked',
		summary: membership.invite_email || membershipId,
		resourceType: 'workspace_members',
		resourceId: membershipId,
		meta: { revoked: true },
	});
	return mapMemberDto(updated, { email: membership.invite_email });
}

export async function acceptWorkspaceInvite(req, payload = {}) {
	const token = String(payload.token || '').trim();
	const membershipId = String(payload.membershipId || payload.membership_id || '').trim();
	if (!token) {
		throw httpError(422, 'Invitation token is required', 'VALIDATION_ERROR');
	}

	let membership = null;
	try {
		membership = await pocketbaseClient.collection('workspace_members').getFirstListItem(
			pocketbaseClient.filter('invite_token = {:token} && status = "invited"', { token }),
			{ requestKey: null },
		);
	} catch {
		membership = null;
	}

	// Optional membershipId must match the token-resolved invite (prevents id-only accept).
	if (membershipId && membership && String(membership.id) !== String(membershipId)) {
		throw httpError(403, 'Invitation token mismatch', 'FORBIDDEN');
	}

	if (!membership || membership.status !== 'invited') {
		throw httpError(404, 'Invitation not found', 'NOT_FOUND');
	}
	if (membership.invite_expires_at && new Date(membership.invite_expires_at).getTime() < Date.now()) {
		throw httpError(410, 'Invitation expired', 'INVITE_EXPIRED');
	}

	if (membership.user && String(membership.user) !== String(req.pocketbaseUserId)) {
		throw httpError(403, 'Invitation belongs to another user', 'FORBIDDEN');
	}

	const email = String(req.workspaceUser?.email || '').toLowerCase();
	if (membership.invite_email && email && membership.invite_email.toLowerCase() !== email) {
		throw httpError(403, 'Invitation email mismatch', 'FORBIDDEN');
	}
	if (!email) {
		throw httpError(403, 'Authenticated email required to accept invitation', 'FORBIDDEN');
	}

	const updated = await pocketbaseClient.collection('workspace_members').update(membership.id, {
		user: req.pocketbaseUserId,
		status: 'active',
		joined_at: new Date().toISOString(),
		invite_token: '',
		last_active_at: new Date().toISOString(),
	});

	await recordTypedWorkspaceActivity({
		...req,
		workspace: { id: membership.workspace },
	}, {
		type: 'members',
		title: 'Member joined',
		summary: `${email || req.pocketbaseUserId} joined the workspace`,
		tone: 'green',
		meta: { event: 'member_joined', membershipId: updated.id, userId: req.pocketbaseUserId },
	});

	await notifyWorkspaceById({
		workspaceId: membership.workspace,
		userId: undefined,
		title: 'Member joined',
		body: `${req.workspaceUser?.name || email || 'A member'} joined the workspace.`,
		priority: 'normal',
		meta: { type: 'member_joined', event: 'member_joined', membershipId: updated.id },
		recordActivity: false,
	});

	return mapMemberDto(updated, { user: req.workspaceUser, email });
}

export async function updateWorkspaceMember(req, membershipId, payload = {}) {
	assertCapability(req, 'workspace.members.manage');
	const membership = await findMembershipById(req.workspace.id, membershipId);
	if (membership.role === 'owner' || String(membership.user) === String(req.workspace.owner)) {
		throw httpError(403, 'Owner membership cannot be edited this way', 'FORBIDDEN');
	}

	const updates = {};
	if (payload.role != null) {
		const role = normalizeWorkspaceRole(payload.role);
		if (role === 'owner') throw httpError(422, 'Use ownership transfer', 'VALIDATION_ERROR');
		updates.role = role;
	}
	if (payload.permissions != null) {
		updates.permissions = parsePermissionOverrides(payload.permissions);
	}
	if (payload.customRoleName != null || payload.custom_role_name != null) {
		updates.custom_role_name = String(payload.customRoleName || payload.custom_role_name || '').trim().slice(0, 80);
	}

	const updated = await pocketbaseClient.collection('workspace_members').update(membershipId, updates);
	await recordTypedWorkspaceActivity(req, {
		type: 'roles',
		title: 'Role changed',
		summary: `Member role set to ${updated.role}`,
		tone: 'amber',
		meta: { event: 'role_change', membershipId, role: updated.role },
	});
	await auditFromRequest(req, {
		action: 'role_change',
		title: 'Role changed',
		summary: `Member ${membershipId} → ${updated.role}`,
		resourceType: 'workspace_members',
		resourceId: membershipId,
		meta: { role: updated.role },
		mirrorActivity: false,
	});
	return mapMemberDto(updated);
}

export async function suspendWorkspaceMember(req, membershipId, payload = {}) {
	assertCapability(req, 'workspace.members.manage');
	const membership = await findMembershipById(req.workspace.id, membershipId);
	if (membership.role === 'owner' || String(membership.user) === String(req.workspace.owner)) {
		throw httpError(403, 'Cannot suspend the workspace owner', 'FORBIDDEN');
	}
	const reason = String(payload.reason || 'Suspended by administrator').trim().slice(0, 500);
	const updated = await pocketbaseClient.collection('workspace_members').update(membershipId, {
		status: 'suspended',
		suspended_at: new Date().toISOString(),
		suspended_reason: reason,
	});
	await recordTypedWorkspaceActivity(req, {
		type: 'members',
		title: 'Member suspended',
		summary: reason,
		tone: 'red',
		meta: { event: 'member_suspended', membershipId },
	});
	if (updated.user) {
		await notifyWorkspaceById({
			workspaceId: req.workspace.id,
			userId: updated.user,
			title: 'Membership suspended',
			body: reason,
			priority: 'high',
			meta: { type: 'workspace_change', event: 'member_suspended' },
		});
	}
	return mapMemberDto(updated);
}

export async function reactivateWorkspaceMember(req, membershipId) {
	assertCapability(req, 'workspace.members.manage');
	const membership = await findMembershipById(req.workspace.id, membershipId);
	if (membership.status !== 'suspended' && membership.status !== 'removed') {
		return mapMemberDto(membership);
	}
	await assertSeatAvailable(req);
	const updated = await pocketbaseClient.collection('workspace_members').update(membershipId, {
		status: 'active',
		suspended_at: null,
		suspended_reason: '',
		joined_at: membership.joined_at || new Date().toISOString(),
	});
	await recordTypedWorkspaceActivity(req, {
		type: 'members',
		title: 'Member reactivated',
		summary: `Membership ${membershipId} reactivated`,
		tone: 'green',
		meta: { event: 'member_reactivated', membershipId },
	});
	return mapMemberDto(updated);
}

export async function removeWorkspaceMember(req, membershipId) {
	assertCapability(req, 'workspace.members.manage');
	const membership = await findMembershipById(req.workspace.id, membershipId);
	if (membership.role === 'owner' || String(membership.user) === String(req.workspace.owner)) {
		throw httpError(403, 'Cannot remove the workspace owner', 'FORBIDDEN');
	}
	const updated = await pocketbaseClient.collection('workspace_members').update(membershipId, {
		status: 'removed',
		invite_token: '',
	});
	await recordTypedWorkspaceActivity(req, {
		type: 'members',
		title: 'Member removed',
		summary: `Membership ${membershipId} removed`,
		tone: 'amber',
		meta: { event: 'member_removed', membershipId, userId: membership.user },
	});
	return mapMemberDto(updated);
}

export async function transferWorkspaceOwnership(req, payload = {}) {
	assertCapability(req, 'workspace.ownership.transfer');
	const newOwnerUserId = String(payload.newOwnerUserId || payload.userId || '').trim();
	if (!newOwnerUserId) throw httpError(422, 'newOwnerUserId is required', 'VALIDATION_ERROR');
	if (String(newOwnerUserId) === String(req.workspace.owner)) {
		return { ok: true, workspaceId: req.workspace.id, ownerId: newOwnerUserId };
	}

	await pocketbaseClient.collection('users').getOne(newOwnerUserId);

	const result = await applyOwnershipTransfer({
		workspaceId: req.workspace.id,
		fromOwnerId: req.workspace.owner,
		toOwnerId: newOwnerUserId,
		actorUserId: req.pocketbaseUserId,
	});

	await recordTypedWorkspaceActivity(req, {
		type: 'workspace',
		title: 'Ownership transferred',
		summary: `Ownership moved to ${newOwnerUserId}`,
		tone: 'amber',
		meta: { event: 'ownership_transfer', ...result },
	});

	await notifyWorkspaceById({
		workspaceId: req.workspace.id,
		userId: newOwnerUserId,
		title: 'You are the new workspace owner',
		body: `Ownership of ${req.workspace.name || 'the workspace'} was transferred to you.`,
		priority: 'high',
		meta: { type: 'workspace_change', event: 'ownership_transfer' },
	});

	return result;
}

/**
 * Shared ownership transfer used by workspace + admin surfaces.
 * Keeps workspaces.owner and workspace_members roles in sync.
 */
export async function applyOwnershipTransfer({
	workspaceId,
	fromOwnerId,
	toOwnerId,
	actorUserId = '',
}) {
	const workspace = await pocketbaseClient.collection('workspaces').getOne(workspaceId);
	const previousOwnerId = fromOwnerId || workspace.owner;

	await pocketbaseClient.collection('workspaces').update(workspaceId, { owner: toOwnerId });

	const members = await pocketbaseClient.collection('workspace_members').getFullList({
		filter: pocketbaseClient.filter('workspace = {:ws}', { ws: workspaceId }),
		requestKey: null,
	}).catch(() => []);

	const previousOwnerMembership = members.find((row) => String(row.user) === String(previousOwnerId));
	const nextOwnerMembership = members.find((row) => String(row.user) === String(toOwnerId));

	if (previousOwnerMembership) {
		await pocketbaseClient.collection('workspace_members').update(previousOwnerMembership.id, {
			role: 'administrator',
			status: previousOwnerMembership.status === 'removed' ? 'active' : previousOwnerMembership.status,
		});
	}

	if (nextOwnerMembership) {
		await pocketbaseClient.collection('workspace_members').update(nextOwnerMembership.id, {
			role: 'owner',
			status: 'active',
			joined_at: nextOwnerMembership.joined_at || new Date().toISOString(),
			suspended_at: null,
			suspended_reason: '',
			invite_token: '',
		});
	} else {
		await pocketbaseClient.collection('workspace_members').create({
			workspace: workspaceId,
			user: toOwnerId,
			role: 'owner',
			status: 'active',
			joined_at: new Date().toISOString(),
		});
	}

	return {
		ok: true,
		workspaceId,
		ownerId: toOwnerId,
		previousOwnerId,
		actorUserId,
	};
}

export async function listWorkspaceRoles(req) {
	assertCapability(req, 'workspace.read');
	const custom = await pocketbaseClient.collection('workspace_roles').getFullList({
		filter: pocketbaseClient.filter('workspace = {:ws} && active != false', { ws: req.workspace.id }),
		sort: 'name',
		requestKey: null,
	}).catch(() => []);

	return {
		system: listSystemRoles(),
		custom: custom.map((row) => ({
			id: row.id,
			name: row.name,
			slug: row.slug,
			description: row.description || '',
			permissions: Array.isArray(row.permissions) ? row.permissions : capabilitiesForMembership({ role: 'custom', permissions: row.permissions }),
			system: false,
		})),
		capabilities: Object.keys(WORKSPACE_CAPABILITIES),
	};
}

export async function createWorkspaceRole(req, payload = {}) {
	assertCapability(req, 'workspace.roles.manage');
	const name = String(payload.name || '').trim();
	if (!name) throw httpError(422, 'name is required', 'VALIDATION_ERROR');
	const slug = slugify(payload.slug || name) || `role-${Date.now()}`;
	const permissions = parsePermissionOverrides(payload.permissions);
	const created = await pocketbaseClient.collection('workspace_roles').create({
		workspace: req.workspace.id,
		name,
		slug,
		description: String(payload.description || '').trim().slice(0, 500),
		permissions,
		is_system: false,
		active: true,
		created_by: req.pocketbaseUserId,
	});
	await recordTypedWorkspaceActivity(req, {
		type: 'roles',
		title: 'Custom role created',
		summary: name,
		meta: { event: 'role_created', roleId: created.id },
	});
	return {
		id: created.id,
		name: created.name,
		slug: created.slug,
		description: created.description || '',
		permissions,
		system: false,
	};
}

export async function updateWorkspaceRole(req, roleId, payload = {}) {
	assertCapability(req, 'workspace.roles.manage');
	const role = await pocketbaseClient.collection('workspace_roles').getOne(roleId).catch(() => null);
	if (!role || String(role.workspace) !== String(req.workspace.id)) {
		throw httpError(404, 'Role not found', 'NOT_FOUND');
	}
	const updates = {};
	if (payload.name != null) updates.name = String(payload.name).trim().slice(0, 80);
	if (payload.description != null) updates.description = String(payload.description).trim().slice(0, 500);
	if (payload.permissions != null) updates.permissions = parsePermissionOverrides(payload.permissions);
	if (payload.active != null) updates.active = Boolean(payload.active);
	const updated = await pocketbaseClient.collection('workspace_roles').update(roleId, updates);
	await recordTypedWorkspaceActivity(req, {
		type: 'roles',
		title: 'Custom role updated',
		summary: updated.name,
		meta: { event: 'role_updated', roleId },
	});
	return {
		id: updated.id,
		name: updated.name,
		slug: updated.slug,
		description: updated.description || '',
		permissions: parsePermissionOverrides(updated.permissions),
		system: false,
		active: updated.active !== false,
	};
}

export async function deleteWorkspaceRole(req, roleId) {
	assertCapability(req, 'workspace.roles.manage');
	const role = await pocketbaseClient.collection('workspace_roles').getOne(roleId).catch(() => null);
	if (!role || String(role.workspace) !== String(req.workspace.id)) {
		throw httpError(404, 'Role not found', 'NOT_FOUND');
	}
	await pocketbaseClient.collection('workspace_roles').update(roleId, { active: false });
	await recordTypedWorkspaceActivity(req, {
		type: 'roles',
		title: 'Custom role archived',
		summary: role.name,
		meta: { event: 'role_archived', roleId },
	});
	return { ok: true, id: roleId };
}
