export const WEBSITES_CHANGED_EVENT = 'workspace:websites-changed';

/**
 * Broadcast that the workspace websites inventory changed.
 *
 * Contract (callers must honor):
 * - Emit ONLY after a successful backend mutation (create / update / reconnect / delete).
 * - Do NOT emit on failed, cancelled, or in-flight requests.
 * - Do NOT emit for scan/article operations (inventory membership did not change).
 *
 * Consumers re-fetch `/websites` and re-validate any selected websiteId.
 */
export function notifyWebsitesChanged(detail = {}) {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent(WEBSITES_CHANGED_EVENT, { detail }));
}
