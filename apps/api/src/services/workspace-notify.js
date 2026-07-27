import pocketbaseClient from '../utils/pocketbaseClient.js';
import { ensureUserWorkspace } from './workspace-context.js';
import { writeAuditLog } from './audit/write.js';
import { normalizeActivityType, recordTypedWorkspaceActivity } from './workspace-activity.js';

/**
 * Notify a specific workspace (optionally a user). Broadcasts when userId is empty.
 */
export async function notifyWorkspaceById({
	workspaceId,
	userId = '',
	title,
	body = '',
	priority = 'normal',
	meta = {},
	recordActivity = true,
}) {
	if (!workspaceId || !title) return null;

	const created = await pocketbaseClient.collection('workspace_notifications').create({
		workspace: workspaceId,
		user: userId || undefined,
		title: String(title).slice(0, 300),
		body: String(body || '').slice(0, 2000),
		priority,
		channel: 'in_app',
		meta,
	}).catch(() => null);

	if (recordActivity) {
		await recordTypedWorkspaceActivity({
			workspaceId,
			userId: userId || '',
		}, {
			type: normalizeActivityType(meta.type || meta.event || 'workspace'),
			title,
			summary: body,
			tone: priority === 'high' ? 'red' : priority === 'low' ? 'amber' : 'default',
			meta,
		});
	}

	return created;
}

/**
 * Create an in-app workspace notification without an Express request.
 */
export async function notifyWorkspaceUser({
	ownerId,
	title,
	body = '',
	priority = 'normal',
	meta = {},
}) {
	if (!ownerId || !title) return null;
	let workspaceId = '';
	try {
		const ctx = await ensureUserWorkspace(ownerId);
		workspaceId = ctx.workspace?.id || '';
	} catch {
		return null;
	}
	if (!workspaceId) return null;

	return notifyWorkspaceById({
		workspaceId,
		userId: ownerId,
		title,
		body,
		priority,
		meta,
	});
}

export async function logWorkflowStep({
	ownerId,
	action,
	result = 'ok',
	resourceType = 'workflow',
	resourceId = '',
	metadata = {},
}) {
	return writeAuditLog({
		category: 'publishing',
		uiCategory: 'Publishing',
		action,
		actorUserId: ownerId,
		resourceType,
		resourceId,
		result,
		metadata,
	}).catch(() => null);
}
