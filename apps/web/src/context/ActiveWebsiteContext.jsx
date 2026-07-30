import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { useWorkspaceWebsites } from '@/hooks/useWorkspaceWebsites';
import {
	ACTIVE_WEBSITE_CHANGED_EVENT,
	readStoredActiveWebsiteId,
	withWebsiteQuery,
	writeStoredActiveWebsiteId,
} from '@/lib/websites/activeWebsite';

const ActiveWebsiteContext = createContext(null);

/**
 * Persistent Active Website Context (Constitution P5 / Phase 0).
 * Reuses /websites inventory via useWorkspaceWebsites.
 */
export function ActiveWebsiteProvider({ children }) {
	const stored = readStoredActiveWebsiteId();
	const {
		websites,
		websiteId,
		setWebsiteId,
		loading,
		error,
		refresh,
		isSelectionValid,
	} = useWorkspaceWebsites({ preferredId: stored });

	const [ready, setReady] = useState(false);

	useEffect(() => {
		if (!loading) setReady(true);
	}, [loading]);

	// Persist when selection changes from this provider / hook consumers via event
	useEffect(() => {
		if (!websiteId) return;
		if (websiteId === readStoredActiveWebsiteId()) return;
		writeStoredActiveWebsiteId(websiteId, { emit: true });
	}, [websiteId]);

	useEffect(() => {
		const onExternal = (event) => {
			const next = String(event?.detail?.websiteId || '').trim();
			if (!next) return;
			if (next === websiteId) return;
			if (websites.some((site) => String(site.id) === next)) {
				setWebsiteId(next);
			}
		};
		window.addEventListener(ACTIVE_WEBSITE_CHANGED_EVENT, onExternal);
		return () => window.removeEventListener(ACTIVE_WEBSITE_CHANGED_EVENT, onExternal);
	}, [websiteId, websites, setWebsiteId]);

	const setActiveWebsiteId = useCallback((id) => {
		const next = String(id || '').trim();
		setWebsiteId(next);
		writeStoredActiveWebsiteId(next, { emit: true });
	}, [setWebsiteId]);

	const activeWebsite = useMemo(
		() => websites.find((site) => String(site.id) === String(websiteId)) || null,
		[websites, websiteId],
	);

	const value = useMemo(() => ({
		websites,
		activeWebsiteId: websiteId,
		activeWebsite,
		setActiveWebsiteId,
		loading: loading || !ready,
		error,
		refresh,
		isSelectionValid,
		withWebsiteQuery: (path) => withWebsiteQuery(path, websiteId),
	}), [
		websites,
		websiteId,
		activeWebsite,
		setActiveWebsiteId,
		loading,
		ready,
		error,
		refresh,
		isSelectionValid,
	]);

	return (
		<ActiveWebsiteContext.Provider value={value}>
			{children}
		</ActiveWebsiteContext.Provider>
	);
}

export function useActiveWebsite() {
	const ctx = useContext(ActiveWebsiteContext);
	if (!ctx) {
		throw new Error('useActiveWebsite must be used within ActiveWebsiteProvider');
	}
	return ctx;
}

/** Safe optional access when provider may be absent (tests). */
export function useActiveWebsiteOptional() {
	return useContext(ActiveWebsiteContext);
}
