import pocketbaseClient from '../../utils/pocketbaseClient.js';
import { httpError } from '../../middleware/require-admin.js';
import { writeAuditLog } from '../audit/write.js';
import {
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

async function loadWorkspaceDetail(workspace, owner) {
	const ownerId = workspace.owner || owner?.id || '';
	const workspaceKey = workspace.workspace_key || '';

	const [websites, pinterestAccounts, wordpressSites, publishHistory, subscription, usage] = await Promise.all([
		safeFullList('websites', {
			filter: ownerId
				? pocketbaseClient.filter('owner = {:owner}', { owner: ownerId })
				: undefined,
		}),
		safeFullList('pinterest_accounts', {
			filter: ownerId
				? pocketbaseClient.filter('owner = {:owner}', { owner: ownerId })
				: undefined,
		}),
		safeFullList('wordpress_sites', {
			filter: ownerId
				? pocketbaseClient.filter('owner = {:owner}', { owner: ownerId })
				: undefined,
		}).catch(() => []),
		safeList('publish_history', 1, 8, {
			filter: ownerId
				? pocketbaseClient.filter('owner = {:owner}', { owner: ownerId })
				: undefined,
			sort: '-published_at,-created',
		}).then((r) => r.items || []),
		getOwnerSubscription(ownerId, workspaceKey),
		workspaceKey
			? pocketbaseClient.collection('workspace_usage').getList(1, 1, {
				filter: pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
				sort: '-period',
				requestKey: null,
			}).catch(() => ({ items: [] }))
			: Promise.resolve({ items: [] }),
	]);

	const boardsByAccount = await Promise.all(
		pinterestAccounts.map(async (account) => {
			const boards = await pocketbaseClient.collection('pinterest_boards').getList(1, 1, {
				filter: pocketbaseClient.filter('account = {:account} || owner = {:owner}', {
					account: account.id,
					owner: ownerId,
				}),
				requestKey: null,
			}).catch(() => ({ totalItems: 0 }));
			return {
				name: account.name || account.username || account.id,
				boards: Number(boards.totalItems) || Number(account.board_count) || 0,
				status: mapPinterestStatus(account.status),
			};
		}),
	);

	const plan = subscription?.expand?.plan?.slug
		|| workspace.plan_slug
		|| owner?.plan
		|| 'free';
	const usageRow = usage.items?.[0];
	const storageUsedGb = Number(workspace.metadata?.storageUsedGb)
		|| Number((Number(usageRow?.tokens) || 0) / 1_000_000)
		|| 0.1;
	const storageLimitGb = Number(workspace.metadata?.storageLimitGb)
		|| (plan === 'agency' ? 100 : plan === 'pro' ? 50 : plan === 'starter' ? 20 : 5);

	return {
		websites: websites.map((site) => ({
			domain: domainFromUrl(site.url || site.domain || site.name),
			status: mapWebsiteStatus(site.status),
		})),
		pinterestConnected: pinterestAccounts.length > 0,
		wordpressConnected: websites.length > 0 || wordpressSites.length > 0,
		pinterestAccounts: boardsByAccount,
		wordpressConnections: (wordpressSites.length ? wordpressSites : websites).map((site) => ({
			site: domainFromUrl(site.url || site.domain || site.site || site.name),
			status: mapWebsiteStatus(site.status || site.connection_status),
		})),
		publishing: (publishHistory || []).slice(0, 8).map((row) => ({
			text: row.title || row.message || `Published to ${row.wp_status || 'WordPress'}`,
			time: formatRelative(row.published_at || row.created),
		})),
		credits: Number(subscription?.credits_balance) || 0,
		creditsUsed: Number(usageRow?.credits_burned) || 0,
		plan,
		subscription: {
			plan,
			renews: subscription?.renews_at ? formatDate(subscription.renews_at) : '—',
			seats: Number(subscription?.seats) || 1,
		},
		storageUsedGb: Math.round(storageUsedGb * 10) / 10,
		storageLimitGb,
	};
}

export async function mapAdminWorkspace(workspace, { detail = false, ownerMap = new Map() } = {}) {
	const owner = ownerMap.get(workspace.owner)
		|| (workspace.expand?.owner)
		|| (workspace.owner
			? await pocketbaseClient.collection('users').getOne(workspace.owner).catch(() => null)
			: null);

	const base = {
		id: workspace.id,
		name: workspace.name || workspace.slug || 'Workspace',
		owner: owner?.name || owner?.email || workspace.owner || '—',
		ownerEmail: owner?.email || workspace.billing_email || '—',
		plan: workspace.plan_slug || owner?.plan || 'free',
		credits: 0,
		creditsUsed: 0,
		status: workspace.status || 'active',
		created: formatDate(workspace.created),
		lastActivity: formatDateTime(workspace.updated),
		websites: [],
		pinterestConnected: false,
		wordpressConnected: false,
	};

	if (!detail) {
		const [websiteCount, pinCount, subscription] = await Promise.all([
			owner?.id
				? pocketbaseClient.collection('websites').getList(1, 1, {
					filter: pocketbaseClient.filter('owner = {:owner}', { owner: owner.id }),
					requestKey: null,
				}).then((r) => r.totalItems || 0).catch(() => 0)
				: 0,
			owner?.id
				? pocketbaseClient.collection('pinterest_accounts').getList(1, 1, {
					filter: pocketbaseClient.filter('owner = {:owner}', { owner: owner.id }),
					requestKey: null,
				}).then((r) => r.totalItems || 0).catch(() => 0)
				: 0,
			getOwnerSubscription(owner?.id, workspace.workspace_key),
		]);
		base.credits = Number(subscription?.credits_balance) || 0;
		base.plan = subscription?.expand?.plan?.slug || workspace.plan_slug || owner?.plan || 'free';
		base.websites = Array.from({ length: websiteCount }, (_, i) => ({ domain: `site-${i + 1}`, status: 'connected' }));
		base.websiteCount = websiteCount;
		base.pinterestConnected = pinCount > 0;
		base.wordpressConnected = websiteCount > 0;
		return base;
	}

	const extras = await loadWorkspaceDetail(workspace, owner);
	return { ...base, ...extras };
}

export async function getWorkspacesSummary() {
	const workspaces = await safeFullList('workspaces', { fields: 'id,created,status' });
	const now = Date.now();
	return {
		total: workspaces.length,
		active: workspaces.filter((ws) => ws.status === 'active' || ws.status === 'trial').length,
		suspended: workspaces.filter((ws) => ws.status === 'suspended').length,
		newer: workspaces.filter((ws) => {
			const created = new Date(ws.created).getTime();
			return Number.isFinite(created) && now - created <= 30 * 86400000;
		}).length,
	};
}

export async function listAdminWorkspaces(query = {}) {
	const { page, perPage } = normalizePage(query, 6);
	const parts = [];
	if (query.plan) {
		parts.push(pocketbaseClient.filter('plan_slug = {:plan}', { plan: query.plan }));
	}
	if (query.status) {
		parts.push(pocketbaseClient.filter('status = {:status}', { status: query.status }));
	}
	if (query.createdWithin) {
		const days = Number(query.createdWithin) || 0;
		if (days > 0) {
			const start = new Date(Date.now() - days * 86400000).toISOString();
			parts.push(pocketbaseClient.filter('created >= {:start}', { start }));
		}
	}
	if (query.q) {
		const q = String(query.q).trim();
		if (q) {
			parts.push(pocketbaseClient.filter('(name ~ {:q} || billing_email ~ {:q} || slug ~ {:q} || workspace_key ~ {:q})', { q }));
		}
	}

	const result = await safeList('workspaces', page, perPage * 3, {
		filter: parts.length ? parts.join(' && ') : undefined,
		sort: '-updated,-created',
		expand: 'owner',
	});

	let items = await Promise.all((result.items || []).map((ws) => mapAdminWorkspace(ws, { detail: false })));

	if (query.creditsRange) {
		items = items.filter((ws) => {
			const value = Number(ws.credits || 0);
			if (query.creditsRange === '0') return value === 0;
			if (query.creditsRange === '1-1k') return value > 0 && value <= 1000;
			if (query.creditsRange === '1k-5k') return value > 1000 && value <= 5000;
			if (query.creditsRange === '5k+') return value > 5000;
			return true;
		});
	}

	if (query.q) {
		const q = String(query.q).trim().toLowerCase();
		items = items.filter((ws) => {
			const hay = `${ws.name} ${ws.owner} ${ws.ownerEmail}`.toLowerCase();
			return hay.includes(q);
		});
	}

	const totalItems = items.length;
	const start = (page - 1) * perPage;
	const pageItems = items.slice(start, start + perPage);
	const summary = await getWorkspacesSummary();

	return {
		items: pageItems,
		page,
		perPage,
		totalItems,
		totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
		summary,
	};
}

export async function getAdminWorkspace(id) {
	const workspace = await pocketbaseClient.collection('workspaces').getOne(id, { expand: 'owner' }).catch(() => null);
	if (!workspace) throw httpError(404, 'Workspace not found', 'NOT_FOUND');
	return mapAdminWorkspace(workspace, { detail: true });
}

export async function updateAdminWorkspace(id, payload = {}, actor = {}) {
	const updates = {};
	if (payload.name != null) updates.name = String(payload.name).trim();
	if (payload.plan != null) updates.plan_slug = String(payload.plan).trim().toLowerCase();
	if (payload.status != null) updates.status = String(payload.status).trim().toLowerCase();
	const updated = await pocketbaseClient.collection('workspaces').update(id, updates);
	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Workspaces',
		action: `Updated workspace ${updated.name || id}`,
		actorUserId: actor.id,
		actorLabel: actor.email || 'admin',
		resourceType: 'workspace',
		resourceId: id,
		result: 'ok',
		metadata: updates,
	});
	return mapAdminWorkspace(updated, { detail: true });
}

export async function suspendAdminWorkspace(id, actor = {}) {
	const updated = await pocketbaseClient.collection('workspaces').update(id, { status: 'suspended' });
	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Workspaces',
		severity: 'warn',
		action: `Suspended workspace ${updated.name || id}`,
		actorUserId: actor.id,
		actorLabel: actor.email || 'admin',
		resourceType: 'workspace',
		resourceId: id,
		result: 'ok',
	});
	return mapAdminWorkspace(updated, { detail: true });
}

export async function activateAdminWorkspace(id, actor = {}) {
	const updated = await pocketbaseClient.collection('workspaces').update(id, { status: 'active' });
	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Workspaces',
		action: `Activated workspace ${updated.name || id}`,
		actorUserId: actor.id,
		actorLabel: actor.email || 'admin',
		resourceType: 'workspace',
		resourceId: id,
		result: 'ok',
	});
	return mapAdminWorkspace(updated, { detail: true });
}

export async function transferAdminWorkspace(id, newOwnerUserId, actor = {}) {
	if (!newOwnerUserId) throw httpError(422, 'newOwnerUserId is required', 'VALIDATION_ERROR');
	await pocketbaseClient.collection('users').getOne(newOwnerUserId);
	const updated = await pocketbaseClient.collection('workspaces').update(id, { owner: newOwnerUserId });
	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Workspaces',
		severity: 'warn',
		action: `Transferred workspace ${updated.name || id}`,
		actorUserId: actor.id,
		actorLabel: actor.email || 'admin',
		resourceType: 'workspace',
		resourceId: id,
		result: 'ok',
		metadata: { newOwnerUserId },
	});
	return mapAdminWorkspace(updated, { detail: true });
}

export async function deleteAdminWorkspace(id, actor = {}) {
	const workspace = await pocketbaseClient.collection('workspaces').getOne(id);
	await pocketbaseClient.collection('workspaces').update(id, { status: 'closed' });
	await writeAuditLog({
		category: 'admin',
		uiCategory: 'Workspaces',
		severity: 'warn',
		action: `Closed workspace ${workspace.name || id}`,
		actorUserId: actor.id,
		actorLabel: actor.email || 'admin',
		resourceType: 'workspace',
		resourceId: id,
		result: 'ok',
	});
	return { ok: true, id };
}
