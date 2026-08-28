/**
 * Workspace-scoped plan display for sidebar UI.
 * Source of truth: the active workspace from WorkspaceContext
 * (GET /workspace/v1/workspaces). Never use users.plan / authStore.
 */

function titleCaseWord(value) {
	const text = String(value || '').trim();
	if (!text) return '';
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function planCore(activeWorkspace) {
	const name = String(activeWorkspace?.planName || '').trim();
	if (name) {
		return name.replace(/\s+plan$/i, '').trim();
	}
	const slug = String(activeWorkspace?.planSlug || '').trim();
	if (slug) {
		return slug.replace(/\s+plan$/i, '').trim();
	}
	return '';
}

/**
 * Resolve the active workspace plan slug for comparisons.
 * Missing workspace data falls back to "free" without throwing.
 */
export function resolveActiveWorkspacePlanSlug(activeWorkspace) {
	const core = planCore(activeWorkspace);
	if (core) return core.toLowerCase();
	return 'free';
}

/**
 * Sidebar label, e.g. "Starter Plan" / "Free Plan".
 * Ignores any auth user record passed accidentally.
 */
export function formatActiveWorkspacePlanLabel(activeWorkspace) {
	const core = planCore(activeWorkspace) || 'free';
	return `${titleCaseWord(core)} Plan`;
}

/**
 * Upgrade banner: show only when the active workspace is known to be free.
 * Missing workspace (loading / none) hides the banner instead of using users.plan.
 */
export function isActiveWorkspaceOnFreePlan(activeWorkspace) {
	if (activeWorkspace == null) return false;
	return resolveActiveWorkspacePlanSlug(activeWorkspace) === 'free';
}
