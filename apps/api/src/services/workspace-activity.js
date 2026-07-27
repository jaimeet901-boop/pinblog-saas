import pocketbaseClient from '../utils/pocketbaseClient.js';
import { assertCapability } from './workspace-rbac.js';

export const WORKSPACE_ACTIVITY_TYPES = [
	'login',
	'ai',
	'publishing',
	'credits',
	'billing',
	'roles',
	'members',
	'workspace',
];

const TYPE_ALIASES = {
	logins: 'login',
	ai_usage: 'ai',
	publish: 'publishing',
	role_changes: 'roles',
	role_change: 'roles',
	workspace_changes: 'workspace',
	member: 'members',
};

export function normalizeActivityType(type) {
	const raw = String(type || 'workspace').trim().toLowerCase();
	return TYPE_ALIASES[raw] || (WORKSPACE_ACTIVITY_TYPES.includes(raw) ? raw : 'workspace');
}

/**
 * Record activity against a workspace. Accepts Express req or a lightweight context.
 */
export async function recordTypedWorkspaceActivity(reqOrCtx, {
	type,
	title,
	summary = '',
	tone = 'default',
	meta = {},
	userId = '',
} = {}) {
	const workspaceId = reqOrCtx?.workspace?.id || reqOrCtx?.workspaceId || '';
	if (!workspaceId || !title) return null;
	const actorId = userId
		|| reqOrCtx?.pocketbaseUserId
		|| reqOrCtx?.userId
		|| '';
	const normalizedType = normalizeActivityType(type || meta.type || meta.event);

	return pocketbaseClient.collection('workspace_activity').create({
		workspace: workspaceId,
		user: actorId || undefined,
		type: normalizedType,
		title: String(title).slice(0, 300),
		summary: String(summary || '').slice(0, 500),
		tone,
		meta: {
			...meta,
			event: meta.event || normalizedType,
		},
	}).catch(() => null);
}

export async function listWorkspaceActivityTimeline(req, query = {}) {
	assertCapability(req, 'workspace.read');
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 30));
	const type = query.type ? normalizeActivityType(query.type) : '';
	const userId = String(query.userId || '').trim();

	const parts = [pocketbaseClient.filter('workspace = {:ws}', { ws: req.workspace.id })];
	if (type) parts.push(pocketbaseClient.filter('type = {:type}', { type }));
	if (userId) parts.push(pocketbaseClient.filter('user = {:user}', { user: userId }));

	const result = await pocketbaseClient.collection('workspace_activity').getList(page, perPage, {
		filter: parts.join(' && '),
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [], totalItems: 0, totalPages: 1, page: 1, perPage }));

	return {
		items: (result.items || []).map((row) => ({
			id: row.id,
			type: row.type,
			title: row.title,
			summary: row.summary || '',
			tone: row.tone || 'default',
			userId: row.user || '',
			meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
			created: row.created,
		})),
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 1,
		types: WORKSPACE_ACTIVITY_TYPES,
	};
}

export async function listWorkspaceActivityForAdmin(workspaceId, query = {}) {
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 40));
	const type = query.type ? normalizeActivityType(query.type) : '';
	const userId = String(query.userId || '').trim();
	const parts = [pocketbaseClient.filter('workspace = {:ws}', { ws: workspaceId })];
	if (type) parts.push(pocketbaseClient.filter('type = {:type}', { type }));
	if (userId) parts.push(pocketbaseClient.filter('user = {:user}', { user: userId }));

	const result = await pocketbaseClient.collection('workspace_activity').getList(page, perPage, {
		filter: parts.join(' && '),
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [], totalItems: 0, totalPages: 1 }));

	return {
		items: (result.items || []).map((row) => ({
			id: row.id,
			type: row.type,
			title: row.title,
			summary: row.summary || '',
			tone: row.tone || 'default',
			userId: row.user || '',
			meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
			created: row.created,
		})),
		page,
		perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 1,
	};
}
