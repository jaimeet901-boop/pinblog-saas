import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { ensurePlansSeeded, mapPlanDto } from './plans.js';
import { capabilitiesForMembership, normalizeWorkspaceRole } from './workspace-rbac.js';
import { seatsForPlanAssignment } from './billing/plan-seats.js';

function slugify(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 100);
}

export function workspaceKeyForUser(userId) {
	return String(userId || '').trim();
}

async function findWorkspaceByOwner(ownerId) {
	try {
		return await pocketbaseClient.collection('workspaces').getFirstListItem(
			pocketbaseClient.filter('owner = {:owner}', { owner: ownerId }),
			{ requestKey: null },
		);
	} catch {
		return null;
	}
}

async function findMembership(workspaceId, userId) {
	try {
		return await pocketbaseClient.collection('workspace_members').getFirstListItem(
			pocketbaseClient.filter('workspace = {:ws} && user = {:user} && status = "active"', {
				ws: workspaceId,
				user: userId,
			}),
			{ requestKey: null },
		);
	} catch {
		return null;
	}
}

async function ensureSubscription(workspace, user) {
	await ensurePlansSeeded();
	const workspaceKey = workspace.workspace_key;
	let subscription = null;
	try {
		subscription = await pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key}', { key: workspaceKey }),
			{ expand: 'plan', requestKey: null },
		);
	} catch {
		subscription = null;
	}

	if (subscription) return subscription;

	const planSlug = workspace.plan_slug || user.plan || 'free';
	let plan = null;
	try {
		plan = await pocketbaseClient.collection('plans').getFirstListItem(
			pocketbaseClient.filter('slug = {:slug}', { slug: planSlug }),
			{ requestKey: null },
		);
	} catch {
		plan = await pocketbaseClient.collection('plans').getFirstListItem(
			pocketbaseClient.filter('slug = "free"'),
			{ requestKey: null },
		).catch(() => null);
	}

	if (!plan) {
		throw httpError(500, 'No plans available', 'NO_PLANS');
	}

	const now = new Date();
	const end = new Date(now);
	end.setMonth(end.getMonth() + 1);

	return pocketbaseClient.collection('workspace_subscriptions').create({
		workspace_key: workspaceKey,
		workspace_name: workspace.name,
		owner_email: user.email || '',
		plan: plan.id,
		status: 'active',
		seats: seatsForPlanAssignment(plan),
		current_period_start: now.toISOString(),
		current_period_end: end.toISOString(),
		credits_balance: Number(plan.credits) || 0,
	});
}

async function ensureSettings(workspaceId) {
	try {
		return await pocketbaseClient.collection('workspace_settings').getFirstListItem(
			pocketbaseClient.filter('workspace = {:ws}', { ws: workspaceId }),
			{ requestKey: null },
		);
	} catch {
		return pocketbaseClient.collection('workspace_settings').create({
			workspace: workspaceId,
			prefs: {},
			notification_prefs: {},
			defaults: {},
		});
	}
}

/**
 * Ensure personal workspace + owner membership exist for the authenticated user.
 * Isolation key: workspace_key === user.id (1:1 personal tenant).
 */
export async function ensureUserWorkspace(userId) {
	if (!userId) {
		throw httpError(401, 'Please sign in to continue.', 'UNAUTHENTICATED');
	}

	const user = await pocketbaseClient.collection('users').getOne(userId);
	const workspaceKey = workspaceKeyForUser(userId);
	let workspace = await findWorkspaceByOwner(userId);

	if (!workspace) {
		const baseSlug = slugify(user.name || user.email || `workspace-${userId}`) || `ws-${userId.slice(0, 8)}`;
		let slug = baseSlug;
		let attempt = 1;
		while (true) {
			try {
				await pocketbaseClient.collection('workspaces').getFirstListItem(
					pocketbaseClient.filter('slug = {:slug}', { slug }),
					{ requestKey: null },
				);
				slug = `${baseSlug}-${attempt++}`;
			} catch {
				break;
			}
		}

		workspace = await pocketbaseClient.collection('workspaces').create({
			name: user.name ? `${user.name}'s Workspace` : 'My Workspace',
			slug,
			workspace_key: workspaceKey,
			owner: userId,
			status: 'active',
			plan_slug: user.plan || 'free',
			billing_email: user.email || '',
			metadata: {},
		});
	}

	let membership = await findMembership(workspace.id, userId);
	if (!membership) {
		membership = await pocketbaseClient.collection('workspace_members').create({
			workspace: workspace.id,
			user: userId,
			role: 'owner',
			status: 'active',
			joined_at: new Date().toISOString(),
		});
	}

	const subscription = await ensureSubscription(workspace, user);
	const settings = await ensureSettings(workspace.id);
	const role = normalizeWorkspaceRole(membership.role || 'owner');

	// Claim email invitations created before this account existed.
	try {
		const { claimPendingInvitesForUser } = await import('./workspace-members.js');
		await claimPendingInvitesForUser(userId, user.email);
	} catch {
		/* non-blocking */
	}

	return {
		user,
		workspace,
		membership,
		subscription,
		settings,
		workspaceKey,
		role,
		capabilities: capabilitiesForMembership(membership),
	};
}

/**
 * Load a workspace the user is an active member of (team access).
 */
export async function loadWorkspaceContextById(workspaceId, userId) {
	if (!workspaceId || !userId) {
		throw httpError(400, 'workspaceId is required', 'VALIDATION_ERROR');
	}

	const user = await pocketbaseClient.collection('users').getOne(userId);
	const workspace = await pocketbaseClient.collection('workspaces').getOne(workspaceId).catch(() => null);
	if (!workspace) throw httpError(404, 'Workspace not found', 'NOT_FOUND');

	let membership = await findMembership(workspace.id, userId);
	if (!membership && String(workspace.owner) === String(userId)) {
		membership = await pocketbaseClient.collection('workspace_members').create({
			workspace: workspace.id,
			user: userId,
			role: 'owner',
			status: 'active',
			joined_at: new Date().toISOString(),
		});
	}
	if (!membership) {
		const any = await pocketbaseClient.collection('workspace_members').getFullList({
			filter: pocketbaseClient.filter('workspace = {:ws} && user = {:user}', {
				ws: workspace.id,
				user: userId,
			}),
			requestKey: null,
		}).catch(() => []);
		const suspended = any.find((row) => row.status === 'suspended');
		if (suspended) {
			throw httpError(403, 'Your membership is suspended', 'MEMBER_SUSPENDED');
		}
		throw httpError(403, 'Not a member of this workspace', 'FORBIDDEN');
	}

	const owner = String(workspace.owner) === String(userId)
		? user
		: await pocketbaseClient.collection('users').getOne(workspace.owner).catch(() => user);

	const subscription = await ensureSubscription(workspace, owner);
	const settings = await ensureSettings(workspace.id);

	return {
		user,
		workspace,
		membership,
		subscription,
		settings,
		workspaceKey: workspace.workspace_key,
		role: normalizeWorkspaceRole(membership.role || 'viewer'),
		capabilities: capabilitiesForMembership(membership),
	};
}

export async function listUserWorkspaces(userId) {
	const owned = await pocketbaseClient.collection('workspaces').getFullList({
		filter: pocketbaseClient.filter('owner = {:owner}', { owner: userId }),
		requestKey: null,
	}).catch(() => []);

	const memberships = await pocketbaseClient.collection('workspace_members').getFullList({
		filter: pocketbaseClient.filter('user = {:user} && status = "active"', { user: userId }),
		requestKey: null,
	}).catch(() => []);

	const byId = new Map();
	for (const ws of owned) {
		byId.set(ws.id, { workspace: ws, role: 'owner' });
	}
	for (const membership of memberships) {
		if (byId.has(membership.workspace)) {
			byId.set(membership.workspace, {
				workspace: byId.get(membership.workspace).workspace,
				role: normalizeWorkspaceRole(membership.role),
				membership,
			});
			continue;
		}
		const workspace = await pocketbaseClient.collection('workspaces').getOne(membership.workspace).catch(() => null);
		if (workspace) {
			byId.set(workspace.id, {
				workspace,
				role: normalizeWorkspaceRole(membership.role),
				membership,
			});
		}
	}

	const items = [];
	for (const { workspace, role, membership } of byId.values()) {
		const owner = await pocketbaseClient.collection('users').getOne(workspace.owner).catch(() => null);
		const subscription = await pocketbaseClient.collection('workspace_subscriptions').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key}', { key: workspace.workspace_key }),
			{ expand: 'plan', requestKey: null },
		).catch(() => null);
		const settings = await pocketbaseClient.collection('workspace_settings').getFirstListItem(
			pocketbaseClient.filter('workspace = {:ws}', { ws: workspace.id }),
			{ requestKey: null },
		).catch(() => null);
		const logo = settings?.prefs?.workspaceLogo || workspace.metadata?.logo || '';
		items.push({
			...mapWorkspaceDto(workspace, {
				role,
				planSlug: subscription?.expand?.plan?.slug || workspace.plan_slug || 'free',
				capabilities: membership ? capabilitiesForMembership(membership) : capabilitiesForMembership({ role }),
			}),
			membershipId: membership?.id || null,
			planName: subscription?.expand?.plan?.name || workspace.plan_slug || 'Free',
			creditsRemaining: Number(subscription?.credits_balance) || 0,
			logo,
			owner: {
				id: workspace.owner,
				name: owner?.name || '',
				email: owner?.email || workspace.billing_email || '',
			},
			healthScore: Number(workspace.health_score) || null,
			healthLabel: workspace.health_label || '',
		});
	}

	return items;
}

export function mapWorkspaceDto(workspace, extras = {}) {
	return {
		id: workspace.id,
		name: workspace.name,
		slug: workspace.slug,
		workspaceKey: workspace.workspace_key,
		ownerId: typeof workspace.owner === 'string' ? workspace.owner : workspace.owner,
		status: workspace.status || 'active',
		planSlug: workspace.plan_slug || extras.planSlug || 'free',
		billingEmail: workspace.billing_email || '',
		metadata: workspace.metadata && typeof workspace.metadata === 'object' ? workspace.metadata : {},
		role: extras.role || 'owner',
		capabilities: extras.capabilities || [],
		created: workspace.created,
		updated: workspace.updated,
	};
}

export async function getSubscriptionPlan(subscription) {
	if (!subscription) return null;
	const planId = typeof subscription.plan === 'string' ? subscription.plan : subscription.plan;
	if (subscription.expand?.plan) {
		return mapPlanDto(subscription.expand.plan);
	}
	const plan = await pocketbaseClient.collection('plans').getOne(planId).catch(() => null);
	return plan ? mapPlanDto(plan) : null;
}

export function assertSameWorkspace(recordWorkspaceId, workspaceId) {
	if (String(recordWorkspaceId) !== String(workspaceId)) {
		throw httpError(403, 'Workspace isolation violation', 'FORBIDDEN');
	}
}
