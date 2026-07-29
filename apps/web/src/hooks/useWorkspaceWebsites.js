import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiServerClient from '@/lib/apiServerClient';
import { normalizeWebsiteList } from '@/lib/websites/normalizeWebsiteList';
import { resolveWebsiteId } from '@/lib/websites/resolveWebsiteId';
import { WEBSITES_CHANGED_EVENT } from '@/lib/websites/websitesChanged';

/**
 * Synchronize the active websites inventory from the backend.
 *
 * Architecture:
 * - Backend `/websites` is the source of truth for current active sites.
 * - Local selectedWebsiteId is always validated against the refreshed list.
 * - Stale IDs (deleted / permanently re-created) are replaced automatically.
 * - Listens for website + workspace change events so other pages stay in sync.
 *
 * Memory safety:
 * - All window/document listeners are removed on unmount.
 * - In-flight refresh responses are ignored after unmount (or after a newer refresh starts).
 */
export function useWorkspaceWebsites({ preferredId = '', enabled = true } = {}) {
	const [websites, setWebsites] = useState([]);
	const [websiteId, setWebsiteId] = useState('');
	const [loading, setLoading] = useState(Boolean(enabled));
	const [error, setError] = useState(null);
	const preferredRef = useRef(String(preferredId || '').trim());
	const mountedRef = useRef(true);
	const refreshSeqRef = useRef(0);
	const refreshRef = useRef(null);

	useEffect(() => {
		preferredRef.current = String(preferredId || '').trim();
	}, [preferredId]);

	const refresh = useCallback(async () => {
		if (!enabled) {
			if (!mountedRef.current) return [];
			setWebsites([]);
			setWebsiteId('');
			setLoading(false);
			return [];
		}

		const seq = ++refreshSeqRef.current;
		if (mountedRef.current) setLoading(true);

		try {
			const response = await apiServerClient.fetch('/websites', { method: 'GET' });
			const payload = await response.json().catch(() => []);

			// Ignore stale responses from older refresh calls or after unmount.
			if (!mountedRef.current || seq !== refreshSeqRef.current) {
				return [];
			}

			if (!response.ok) {
				throw new Error(payload?.message || `Failed to load websites (${response.status})`);
			}

			const next = normalizeWebsiteList(payload);
			setWebsites(next);
			setError(null);

			setWebsiteId((prev) => {
				const preferred = preferredRef.current;
				if (preferred && next.some((site) => String(site?.id) === preferred)) {
					preferredRef.current = '';
					return preferred;
				}
				return resolveWebsiteId(prev, next);
			});

			return next;
		} catch (err) {
			if (!mountedRef.current || seq !== refreshSeqRef.current) {
				return [];
			}
			const message = err instanceof Error ? err.message : 'Failed to load websites';
			setError(message);
			setWebsites([]);
			setWebsiteId('');
			return [];
		} finally {
			if (mountedRef.current && seq === refreshSeqRef.current) {
				setLoading(false);
			}
		}
	}, [enabled]);

	refreshRef.current = refresh;

	// Mount/unmount + event listeners. Listener callbacks always call the latest refresh via ref,
	// so this effect does not re-subscribe when refresh identity changes.
	useEffect(() => {
		mountedRef.current = true;

		if (!enabled) {
			return () => {
				mountedRef.current = false;
				refreshSeqRef.current += 1;
			};
		}

		refreshRef.current?.();

		const onInventoryChanged = () => {
			refreshRef.current?.();
		};
		const onVisible = () => {
			if (document.visibilityState === 'visible') {
				refreshRef.current?.();
			}
		};

		window.addEventListener(WEBSITES_CHANGED_EVENT, onInventoryChanged);
		window.addEventListener('chefia:workspace-changed', onInventoryChanged);
		document.addEventListener('visibilitychange', onVisible);

		return () => {
			mountedRef.current = false;
			refreshSeqRef.current += 1;
			window.removeEventListener(WEBSITES_CHANGED_EVENT, onInventoryChanged);
			window.removeEventListener('chefia:workspace-changed', onInventoryChanged);
			document.removeEventListener('visibilitychange', onVisible);
		};
	}, [enabled]);

	const isSelectionValid = useMemo(
		() => Boolean(websiteId) && websites.some((site) => String(site?.id) === String(websiteId)),
		[websites, websiteId],
	);

	return {
		websites,
		websiteId,
		setWebsiteId,
		loading,
		error,
		refresh,
		isSelectionValid,
	};
}
