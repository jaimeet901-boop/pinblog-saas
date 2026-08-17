export function canonicalAdminWorkspaceKey(workspace = {}) {
	return String(workspace.workspace_key || '').trim();
}

export function adminWorkspaceDtoKey(workspace = {}, subscription = null) {
	void subscription;
	return canonicalAdminWorkspaceKey(workspace);
}

export function adminWorkspaceMatchesQuery(dto = {}, query = '') {
	const q = String(query || '').trim().toLowerCase();
	if (!q) return true;
	const hay = [
		dto.name,
		dto.owner,
		dto.ownerEmail,
		dto.workspaceKey,
		dto.slug,
	].filter((part) => part != null && part !== '').join(' ').toLowerCase();
	return hay.includes(q);
}
