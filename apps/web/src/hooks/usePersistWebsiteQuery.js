import { useEffect } from 'react';
import { useActiveWebsiteOptional } from '@/context/ActiveWebsiteContext';
import { writeStoredActiveWebsiteId } from '@/lib/websites/activeWebsite';

/**
 * Persist Active Website when a page opens with ?websiteId= (Phase 3).
 * Safe when provider is absent (tests).
 */
export function usePersistWebsiteQuery(websiteId) {
	const ctx = useActiveWebsiteOptional();
	const next = String(websiteId || '').trim();

	useEffect(() => {
		if (!next) return;
		if (ctx?.setActiveWebsiteId) {
			if (next !== ctx.activeWebsiteId) {
				ctx.setActiveWebsiteId(next);
			}
			return;
		}
		writeStoredActiveWebsiteId(next, { emit: true });
	}, [next, ctx]);
}
