export const ASSIGN_WORKSPACE_PER_PAGE = 25;
export const ASSIGN_WORKSPACE_SEARCH_DEBOUNCE_MS = 300;

export function assignWorkspaceSelectValue(workspace = {}) {
	return String(workspace?.workspaceKey || '').trim();
}

export function buildAssignWorkspaceListPath(query = '', page = 1) {
	const params = new URLSearchParams({
		page: String(Math.max(1, Number(page) || 1)),
		perPage: String(ASSIGN_WORKSPACE_PER_PAGE),
	});
	const q = String(query || '').trim();
	if (q) params.set('q', q);
	return `/admin/v1/workspaces?${params.toString()}`;
}

export function mergeSelectedAssignWorkspace(items = [], selected = null) {
	const selectedKey = assignWorkspaceSelectValue(selected);
	const filtered = items.filter((ws) => assignWorkspaceSelectValue(ws));
	if (!selectedKey) return filtered;
	if (filtered.some((ws) => assignWorkspaceSelectValue(ws) === selectedKey)) return filtered;
	return [selected, ...filtered];
}
