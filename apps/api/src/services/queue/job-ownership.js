/**
 * Phase 4.2 — trusted ownership for queue jobs / worker side-effects.
 * Never stamp ownership from untrusted client fields.
 */

import pocketbaseClient from '../../utils/pocketbaseClient.js';

function httpError(status, message, errorCode = 'FORBIDDEN') {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

export function recordFieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

/**
 * Assert pin belongs to the same owner/workspace as the executing job.
 * Legacy: empty pin.workspace allowed when owners match (pre-workspace rows).
 */
export function assertJobPinOwnership(job, pin) {
	if (!pin) {
		throw httpError(404, 'Associated AI pin was not found', 'PIN_NOT_FOUND');
	}
	const jobOwner = recordFieldId(job?.owner);
	const pinOwner = recordFieldId(pin.owner);
	if (!jobOwner || pinOwner !== jobOwner) {
		throw httpError(403, 'Pin ownership does not match job workspace', 'PIN_OWNERSHIP_MISMATCH');
	}

	const jobWs = recordFieldId(job?.workspace);
	const pinWs = recordFieldId(pin.workspace);

	if (jobWs && pinWs && jobWs !== pinWs) {
		throw httpError(403, 'Pin workspace does not match job workspace', 'PIN_WORKSPACE_MISMATCH');
	}

	// Job is workspace-stamped but pin is legacy empty — owner match is required (already checked).
	if (jobWs && !pinWs) {
		return pin;
	}

	// Pin stamped but job missing workspace — refuse cross-workspace write.
	if (!jobWs && pinWs) {
		throw httpError(403, 'Job is missing workspace stamp for pin', 'JOB_WORKSPACE_MISSING');
	}

	return pin;
}

/**
 * Resolve enqueue ownership from PocketBase workspace records (admin-safe).
 * workspaceId / workspaceKey are lookup keys only — stamps come from DB.
 */
export async function resolveTrustedEnqueueOwnership({
	adminUserId = '',
	workspaceId = '',
	workspaceKey = '',
} = {}) {
	const id = String(workspaceId || '').trim();
	const key = String(workspaceKey || '').trim();

	if (id) {
		const ws = await pocketbaseClient.collection('workspaces').getOne(id).catch(() => null);
		if (!ws) {
			throw httpError(404, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
		}
		const dbKey = String(ws.workspace_key || '').trim();
		if (key && dbKey && key !== dbKey) {
			throw httpError(422, 'workspaceKey does not match workspaceId', 'FORGED_OWNERSHIP');
		}
		const owner = recordFieldId(ws.owner);
		if (!owner) {
			throw httpError(422, 'Workspace has no owner', 'WORKSPACE_OWNER_MISSING');
		}
		return {
			owner,
			workspaceId: ws.id,
			workspaceKey: dbKey || key,
		};
	}

	if (key) {
		const ws = await pocketbaseClient.collection('workspaces').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key}', { key }),
			{ requestKey: null },
		).catch(() => null);
		if (!ws) {
			throw httpError(404, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
		}
		const owner = recordFieldId(ws.owner);
		if (!owner) {
			throw httpError(422, 'Workspace has no owner', 'WORKSPACE_OWNER_MISSING');
		}
		return {
			owner,
			workspaceId: ws.id,
			workspaceKey: String(ws.workspace_key || key).trim(),
		};
	}

	const adminId = String(adminUserId || '').trim();
	if (!adminId) {
		throw httpError(401, 'Authentication required', 'UNAUTHORIZED');
	}
	// Platform-scoped job: bind to authenticated admin only (never body.owner).
	return {
		owner: adminId,
		workspaceId: '',
		workspaceKey: '',
	};
}

/**
 * Server-side stamps for worker-created jobs.
 * Prefers workspace id / key from middleware or related site; resolves via DB.
 */
export async function resolveJobCreateStamps({
	ownerId = '',
	workspaceId = '',
	workspaceKey = '',
	site = null,
} = {}) {
	const siteWs = recordFieldId(site?.workspace);
	const siteKey = String(site?.workspace_key || '').trim();
	const explicitId = String(workspaceId || siteWs || '').trim();
	const explicitKey = String(workspaceKey || siteKey || '').trim();

	if (explicitId) {
		const ws = await pocketbaseClient.collection('workspaces').getOne(explicitId).catch(() => null);
		if (ws) {
			return {
				owner: recordFieldId(ws.owner) || String(ownerId || '').trim(),
				workspace: ws.id,
				workspace_key: String(ws.workspace_key || explicitKey || '').trim(),
			};
		}
	}

	if (explicitKey) {
		const ws = await pocketbaseClient.collection('workspaces').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key}', { key: explicitKey }),
			{ requestKey: null },
		).catch(() => null);
		if (ws) {
			return {
				owner: recordFieldId(ws.owner) || String(ownerId || '').trim(),
				workspace: ws.id,
				workspace_key: String(ws.workspace_key || explicitKey).trim(),
			};
		}
	}

	const owner = String(ownerId || '').trim();
	if (owner) {
		const byOwner = await pocketbaseClient.collection('workspaces').getFirstListItem(
			pocketbaseClient.filter('owner = {:owner}', { owner }),
			{ requestKey: null },
		).catch(() => null);
		if (byOwner) {
			return {
				owner,
				workspace: byOwner.id,
				workspace_key: String(byOwner.workspace_key || '').trim(),
			};
		}
	}

	// Legacy: no workspace row yet — stamp owner only (no forged workspace_key=owner).
	return {
		owner,
		workspace: undefined,
		workspace_key: '',
	};
}

const PLATFORM_NATIVE_TYPES = new Set(['health_check']);

/**
 * Re-bind native engine ownership from trusted job record + workspace DB.
 * Never trust payload.owner / payload.workspaceKey alone.
 */
export async function resolveTrustedNativeJobOwnership(job) {
	const owner = recordFieldId(job?.owner);
	if (!owner) {
		throw httpError(422, 'Native job missing trusted owner', 'NATIVE_OWNER_MISSING');
	}

	const payload = (job?.payload && typeof job.payload === 'object' ? job.payload : null)
		|| (job?.inputs && typeof job.inputs === 'object' ? job.inputs : null)
		|| {};

	if (payload.owner != null && String(payload.owner).trim() !== '' && String(payload.owner).trim() !== owner) {
		throw httpError(403, 'Native job payload owner does not match job.owner', 'FORGED_PAYLOAD_OWNER');
	}

	const jobKey = String(job?.workspace_key || job?.workspaceKey || '').trim();
	if (
		payload.workspaceKey != null
		&& String(payload.workspaceKey).trim() !== ''
		&& jobKey
		&& String(payload.workspaceKey).trim() !== jobKey
	) {
		throw httpError(403, 'Native job payload workspaceKey does not match job.workspace_key', 'FORGED_PAYLOAD_WORKSPACE');
	}

	const workspaceId = recordFieldId(job?.workspace);
	if (workspaceId) {
		const ws = await pocketbaseClient.collection('workspaces').getOne(workspaceId).catch(() => null);
		if (!ws) {
			throw httpError(404, 'Native job workspace not found', 'WORKSPACE_NOT_FOUND');
		}
		if (recordFieldId(ws.owner) !== owner) {
			throw httpError(403, 'Native job owner does not match workspace owner', 'NATIVE_WORKSPACE_MISMATCH');
		}
		return {
			owner,
			workspaceId: ws.id,
			workspaceKey: String(ws.workspace_key || jobKey || '').trim(),
		};
	}

	if (jobKey) {
		const ws = await pocketbaseClient.collection('workspaces').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key}', { key: jobKey }),
			{ requestKey: null },
		).catch(() => null);
		if (ws && recordFieldId(ws.owner) !== owner) {
			throw httpError(403, 'workspace_key does not belong to job owner', 'NATIVE_WORKSPACE_MISMATCH');
		}
		return {
			owner,
			workspaceId: ws?.id || '',
			workspaceKey: String(ws?.workspace_key || jobKey).trim(),
		};
	}

	if (PLATFORM_NATIVE_TYPES.has(String(job?.type || ''))) {
		return { owner, workspaceId: '', workspaceKey: '' };
	}

	// Legacy tenant jobs without workspace stamp: resolve by owner only (no payload forge).
	const byOwner = await pocketbaseClient.collection('workspaces').getFirstListItem(
		pocketbaseClient.filter('owner = {:owner}', { owner }),
		{ requestKey: null },
	).catch(() => null);

	return {
		owner,
		workspaceId: byOwner?.id || '',
		workspaceKey: String(byOwner?.workspace_key || '').trim(),
	};
}
