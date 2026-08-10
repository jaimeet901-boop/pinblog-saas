function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function recordFieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

function getWorkspaceActor(req) {
	const workspaceId = req.workspace?.id || '';
	const workspaceKey = req.workspaceKey || req.workspace?.workspace_key || '';
	const creatorId = req.pocketbaseUserId || '';
	const workspaceOwnerId = req.workspaceOwnerId || req.workspace?.owner || creatorId;
	return {
		workspaceId: String(workspaceId || '').trim(),
		workspaceKey: String(workspaceKey || '').trim(),
		creatorId: String(creatorId || '').trim(),
		workspaceOwnerId: String(workspaceOwnerId || '').trim(),
	};
}

function recordBelongsToWorkspace(record, req) {
	if (!record) return false;
	const actor = getWorkspaceActor(req);
	const recordWs = recordFieldId(record.workspace);
	const recordOwner = recordFieldId(record.owner);

	if (actor.workspaceId && recordWs && recordWs === String(actor.workspaceId)) {
		return true;
	}
	if (actor.workspaceId && !recordWs && actor.workspaceOwnerId && recordOwner === actor.workspaceOwnerId) {
		return true;
	}
	if (!actor.workspaceId) {
		const fallbackOwner = actor.workspaceOwnerId || actor.creatorId;
		return Boolean(fallbackOwner && recordOwner === fallbackOwner);
	}
	return false;
}

export function resolveStoredHealthFromLookup({
	ownerId,
	wordpressSite,
	website,
	linkedWordpressSite,
	req,
}) {
	const resolvedOwner = req ? (getWorkspaceActor(req).workspaceOwnerId || ownerId) : ownerId;

	if (wordpressSite) {
		const owned = req ? recordBelongsToWorkspace(wordpressSite, req) : wordpressSite.owner === resolvedOwner;
		if (owned) {
			return wordpressSite.health ?? null;
		}
	}

	if (!website) {
		throw httpError(404, 'WordPress site not found', 'NOT_FOUND');
	}

	const websiteOwned = req ? recordBelongsToWorkspace(website, req) : website.owner === resolvedOwner;
	if (!websiteOwned) {
		throw httpError(404, 'WordPress site not found', 'NOT_FOUND');
	}

	return linkedWordpressSite?.health ?? null;
}
