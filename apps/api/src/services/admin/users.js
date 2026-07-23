import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { httpError } from '../../middleware/require-admin.js';
import { writeAuditLog } from '../audit/write.js';
import {
	countFilter,
	domainFromUrl,
	formatDate,
	formatDateTime,
	formatRelative,
	getOwnerSubscription,
	mapPinterestStatus,
	mapWebsiteStatus,
	normalizePage,
	safeFullList,
	safeList,
} from './helpers.js';

function resolveUserStatus(user) {
	const raw = String(user.status || '').toLowerCase();
	if (raw === 'suspended' || raw === 'invited' || raw === 'active') return raw;
	if (user.verified === false) return 'invited';
	return 'active';
}

function resolveUserRole(user) {
	const role = String(user.role || 'user').toLowerCase();
	return role === 'admin' || role === 'super_admin' ? 'admin' : 'user';
}

async function loadUserExtras(user) {
	const ownerId = user.id;
	const [workspaces, websites, pinterestAccounts, activityRows, subscription] = await Promise.all([
		safeFullList('workspaces', {
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		}),
		safeFullList('websites', {
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		}),
		safeFullList('pinterest_accounts', {
			filter: pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
		}),
		safeList('workspace_activity', 1, 8, {
			filter: pocketbaseClient.filter('user = {:owner}', { owner: ownerId }),
			sort: '-created',
		}).then((r) => r.items || []).catch(() => []),
		getOwnerSubscription(ownerId),
	]);

	const pinStatus = pinterestAccounts.length
		? mapPinterestStatus(pinterestAccounts.some((a) => /expir|fail|error|degrad/i.test(a.status || '')) ? 'degraded' : 'connected')
		: 'disconnected';
	const wpStatus = websites.length
		? mapWebsiteStatus(websites.some((w) => /fail|error|degrad/i.test(w.status || '')) ? 'degraded' : 'connected')
		: 'disconnected';

	const plan = subscription?.expand?.plan?.slug
		|| subscription?.plan_slug
		|| user.plan
		|| workspaces[0]?.plan_slug
		|| 'free';

	return {
		workspaces: workspaces.map((ws) => ws.name),
		websites: websites.map((site) => ({
			domain: domainFromUrl(site.url || site.domain || site.name),
			status: mapWebsiteStatus(site.status),
		})),
		pinterest: pinStatus,
		wordpress: wpStatus,
		credits: Number(subscription?.credits_balance ?? user.credits ?? 0) || 0,
		plan,
		subscription: {
			plan,
			renews: subscription?.renews_at ? formatDate(subscription.renews_at) : '—',
			seats: Number(subscription?.seats) || 1,
		},
		activity: (activityRows || []).slice(0, 8).map((row) => ({
			text: row.title || row.summary || row.type || 'Activity',
			time: formatRelative(row.created),
		})),
	};
}

export async function mapAdminUser(user, { detail = false } = {}) {
	const base = {
		id: user.id,
		name: user.name || user.email || 'User',
		email: user.email || '',
		role: resolveUserRole(user),
		status: resolveUserStatus(user),
		plan: user.plan || 'free',
		credits: Number(user.credits) || 0,
		workspaces: [],
		created: formatDate(user.created),
		lastLogin: formatDateTime(user.lastLogin || user.last_login || ''),
	};

	if (!detail) {
		const [workspaceCount, subscription] = await Promise.all([
			countFilter('workspaces', pocketbaseClient.filter('owner = {:owner}', { owner: user.id })),
			getOwnerSubscription(user.id),
		]);
		base.credits = Number(subscription?.credits_balance ?? user.credits ?? 0) || 0;
		base.plan = subscription?.expand?.plan?.slug || user.plan || 'free';
		base.workspaces = Array.from({ length: workspaceCount }, (_, i) => `ws-${i + 1}`);
		base.workspaceCount = workspaceCount;
		return base;
	}

	const extras = await loadUserExtras(user);
	return { ...base, ...extras };
}

export async function getUsersSummary() {
	const users = await safeFullList('users', { fields: 'id,created,status,role,verified' });
	const now = Date.now();
	return {
		total: users.length,
		active: users.filter((u) => resolveUserStatus(u) === 'active').length,
		admins: users.filter((u) => resolveUserRole(u) === 'admin').length,
		newUsers: users.filter((u) => {
			const created = new Date(u.created).getTime();
			return Number.isFinite(created) && now - created <= 30 * 86400000;
		}).length,
	};
}

export async function listAdminUsers(query = {}) {
	const { page, perPage } = normalizePage(query, 6);
	const parts = [];
		if (query.role) {
		const role = String(query.role).toLowerCase() === 'admin' ? 'admin' : 'user';
		if (role === 'admin') {
			parts.push('(role = "admin" || role = "super_admin")');
		} else {
			parts.push('(role = "user" || role = "")');
		}
	}
	if (query.status) {
		parts.push(pocketbaseClient.filter('status = {:status}', { status: query.status }));
	}
	if (query.plan) {
		parts.push(pocketbaseClient.filter('plan = {:plan}', { plan: query.plan }));
	}
	if (query.registeredWithin) {
		const days = Number(query.registeredWithin) || 0;
		if (days > 0) {
			const start = new Date(Date.now() - days * 86400000).toISOString();
			parts.push(pocketbaseClient.filter('created >= {:start}', { start }));
		}
	}
	if (query.q) {
		const q = String(query.q).trim();
		if (q) {
			parts.push(pocketbaseClient.filter('(name ~ {:q} || email ~ {:q})', { q }));
		}
	}

	const result = await safeList('users', page, perPage, {
		filter: parts.length ? parts.join(' && ') : undefined,
		sort: '-created',
	});

	const items = await Promise.all((result.items || []).map((user) => mapAdminUser(user, { detail: false })));
	const summary = await getUsersSummary();

	return {
		items,
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 0,
		summary,
	};
}

export async function getAdminUser(id) {
	const user = await pocketbaseClient.collection('users').getOne(id).catch(() => null);
	if (!user) throw httpError(404, 'User not found', 'USER_NOT_FOUND');
	return mapAdminUser(user, { detail: true });
}

export async function updateAdminUser(id, payload = {}, actor = {}) {
	const existing = await pocketbaseClient.collection('users').getOne(id);
	const updates = {};
	if (payload.name != null) updates.name = String(payload.name).trim();
	if (payload.plan != null) updates.plan = String(payload.plan).trim().toLowerCase();
	if (payload.role != null) {
		const role = String(payload.role).toLowerCase();
		updates.role = role === 'admin' ? 'admin' : 'user';
	}
	if (payload.status != null) updates.status = String(payload.status).toLowerCase();
	const updated = await pocketbaseClient.collection('users').update(id, updates);
	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Users',
		action: `Updated user ${existing.email || id}`,
		actorUserId: actor.id,
		actorLabel: actor.email || actor.name || 'admin',
		resourceType: 'user',
		resourceId: id,
		result: 'ok',
		metadata: updates,
	});
	return mapAdminUser(updated, { detail: true });
}

export async function suspendAdminUser(id, reason = '', actor = {}) {
	const updated = await pocketbaseClient.collection('users').update(id, { status: 'suspended' });
	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Users',
		severity: 'warn',
		action: `Suspended user ${updated.email || id}`,
		actorUserId: actor.id,
		actorLabel: actor.email || 'admin',
		resourceType: 'user',
		resourceId: id,
		result: 'ok',
		metadata: { reason },
	});
	return mapAdminUser(updated, { detail: true });
}

export async function activateAdminUser(id, actor = {}) {
	const updated = await pocketbaseClient.collection('users').update(id, { status: 'active' });
	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Users',
		action: `Activated user ${updated.email || id}`,
		actorUserId: actor.id,
		actorLabel: actor.email || 'admin',
		resourceType: 'user',
		resourceId: id,
		result: 'ok',
	});
	return mapAdminUser(updated, { detail: true });
}

export async function resetAdminUserPassword(id, actor = {}) {
	const user = await pocketbaseClient.collection('users').getOne(id);
	if (!user.email) throw httpError(422, 'User has no email', 'VALIDATION_ERROR');
	await pocketbaseClient.collection('users').requestPasswordReset(user.email);
	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Users',
		action: `Password reset requested for ${user.email}`,
		actorUserId: actor.id,
		actorLabel: actor.email || 'admin',
		resourceType: 'user',
		resourceId: id,
		result: 'ok',
	});
	return { ok: true, email: user.email };
}

export async function deleteAdminUser(id, actor = {}) {
	const user = await pocketbaseClient.collection('users').getOne(id);
	await pocketbaseClient.collection('users').update(id, { status: 'suspended' }).catch(() => null);
	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Users',
		severity: 'warn',
		action: `Soft-deleted user ${user.email || id}`,
		actorUserId: actor.id,
		actorLabel: actor.email || 'admin',
		resourceType: 'user',
		resourceId: id,
		result: 'ok',
	});
	return { ok: true, id };
}
