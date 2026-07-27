import pocketbaseClient from '../utils/pocketbaseClient.js';
import { assertCapability } from './workspace-rbac.js';
import { recordTypedWorkspaceActivity } from './workspace-activity.js';

export const WORKSPACE_AUDIT_ACTIONS = [
	'created',
	'updated',
	'deleted',
	'published',
	'credits_used',
	'billing',
	'role_change',
	'invitation',
	'ownership_transfer',
	'login',
	'other',
];

function normalizeAction(action) {
	const raw = String(action || 'other').trim().toLowerCase();
	if (WORKSPACE_AUDIT_ACTIONS.includes(raw)) return raw;
	const aliases = {
		create: 'created',
		update: 'updated',
		delete: 'deleted',
		publish: 'published',
		credits: 'credits_used',
		invite: 'invitation',
		transfer: 'ownership_transfer',
		role: 'role_change',
	};
	return aliases[raw] || 'other';
}

/**
 * Write a structured workspace audit event (+ optional activity timeline mirror).
 */
export async function writeWorkspaceAudit({
	workspaceId,
	actorId = '',
	action,
	title,
	summary = '',
	resourceType = '',
	resourceId = '',
	meta = {},
	mirrorActivity = true,
} = {}) {
	if (!workspaceId || !title) return null;
	const normalized = normalizeAction(action);

	const row = await pocketbaseClient.collection('workspace_audit').create({
		workspace: workspaceId,
		actor: actorId || undefined,
		action: normalized,
		resource_type: String(resourceType || '').slice(0, 80),
		resource_id: String(resourceId || '').slice(0, 64),
		title: String(title).slice(0, 300),
		summary: String(summary || '').slice(0, 1000),
		meta,
	}).catch(() => null);

	if (mirrorActivity) {
		await recordTypedWorkspaceActivity({
			workspaceId,
			userId: actorId,
		}, {
			type: normalized === 'credits_used' ? 'credits'
				: normalized === 'invitation' || normalized === 'role_change' ? 'members'
					: normalized === 'billing' ? 'billing'
						: normalized === 'published' ? 'publishing'
							: 'workspace',
			title,
			summary,
			meta: { ...meta, action: normalized, resourceType, resourceId, auditId: row?.id },
		});
	}

	return row;
}

export async function auditFromRequest(req, payload = {}) {
	return writeWorkspaceAudit({
		workspaceId: req.workspace?.id,
		actorId: req.pocketbaseUserId,
		...payload,
	});
}

export async function listWorkspaceAudit(req, query = {}) {
	assertCapability(req, 'workspace.read');
	const page = Math.max(1, Number(query.page) || 1);
	const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 40));
	const action = query.action ? normalizeAction(query.action) : '';
	const parts = [pocketbaseClient.filter('workspace = {:ws}', { ws: req.workspace.id })];
	if (action) parts.push(pocketbaseClient.filter('action = {:action}', { action }));

	const result = await pocketbaseClient.collection('workspace_audit').getList(page, perPage, {
		filter: parts.join(' && '),
		sort: '-created',
		requestKey: null,
	}).catch(() => ({ items: [], totalItems: 0, totalPages: 1 }));

	return {
		items: (result.items || []).map((row) => ({
			id: row.id,
			action: row.action,
			title: row.title,
			summary: row.summary || '',
			resourceType: row.resource_type || '',
			resourceId: row.resource_id || '',
			actorId: row.actor || '',
			meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
			created: row.created,
		})),
		page,
		perPage,
		totalItems: result.totalItems || 0,
		totalPages: result.totalPages || 1,
		actions: WORKSPACE_AUDIT_ACTIONS,
	};
}
