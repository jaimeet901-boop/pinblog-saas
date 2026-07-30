/**
 * Active Website persistence + broadcast (Phase 0).
 * Reuses websiteId strings already used across deep links.
 */

export const ACTIVE_WEBSITE_STORAGE_KEY = 'chefia-active-website-id';
export const ACTIVE_WEBSITE_CHANGED_EVENT = 'chefia:active-website-changed';

export function readStoredActiveWebsiteId() {
	try {
		return String(localStorage.getItem(ACTIVE_WEBSITE_STORAGE_KEY) || '').trim();
	} catch {
		return '';
	}
}

export function writeStoredActiveWebsiteId(websiteId, { emit = true } = {}) {
	const next = String(websiteId || '').trim();
	try {
		if (next) localStorage.setItem(ACTIVE_WEBSITE_STORAGE_KEY, next);
		else localStorage.removeItem(ACTIVE_WEBSITE_STORAGE_KEY);
	} catch {
		/* ignore */
	}
	if (emit && typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(ACTIVE_WEBSITE_CHANGED_EVENT, {
			detail: { websiteId: next },
		}));
	}
	return next;
}

/** Append websiteId to a path or keep path when empty. */
export function withWebsiteQuery(path, websiteId) {
	const base = String(path || '');
	const id = String(websiteId || '').trim();
	if (!id) return base;
	const join = base.includes('?') ? '&' : '?';
	if (new URLSearchParams(base.split('?')[1] || '').get('websiteId')) return base;
	return `${base}${join}websiteId=${encodeURIComponent(id)}`;
}
