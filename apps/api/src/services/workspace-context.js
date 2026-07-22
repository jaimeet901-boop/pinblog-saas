import pocketbaseClient from '../utils/pocketbaseClient.js';
import { httpError } from '../middleware/require-admin.js';
import { ensurePlansSeeded, mapPlanDto } from './plans.js';

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
		seats: 1,
		current_period_start: now.toISOString(),
		current_period_end: end.toISOString(),
		credits_balance: Number(plan.credits) || 0,
	});
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

	let settings = null;
	try {
		settings = await pocketbaseClient.collection('workspace_settings').getFirstListItem(
			pocketbaseClient.filter('workspace = {:ws}', { ws: workspace.id }),
			{ requestKey: null },
		);
	} catch {
		settings = await pocketbaseClient.collection('workspace_settings').create({
			workspace: workspace.id,
			prefs: {},
			notification_prefs: {},
			defaults: {},
		});
	}

	return {
		user,
		workspace,
		membership,
		subscription,
		settings,
		workspaceKey,
		role: membership.role || 'owner',
	};
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
