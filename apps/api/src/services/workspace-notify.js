import pocketbaseClient from '../utils/pocketbaseClient.js';
import { ensureUserWorkspace } from './workspace-context.js';
import { writeAuditLog } from './audit/write.js';

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

	const created = await pocketbaseClient.collection('workspace_notifications').create({
		workspace: workspaceId,
		user: ownerId,
		title: String(title).slice(0, 300),
		body: String(body || '').slice(0, 2000),
		priority,
		channel: 'in_app',
		meta,
	}).catch(() => null);

	await pocketbaseClient.collection('workspace_activity').create({
		workspace: workspaceId,
		user: ownerId,
		type: meta.type || 'publishing',
		title: String(title).slice(0, 300),
		summary: String(body || '').slice(0, 500),
		tone: priority === 'high' ? 'red' : priority === 'normal' ? 'default' : 'amber',
		meta,
	}).catch(() => null);

	return created;
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
