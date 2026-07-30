import { useCallback, useEffect, useState } from 'react';
import apiServerClient from '@/lib/apiServerClient';

/**
 * Lightweight workspace Facebook connection signal for Setup progress.
 */
export function useFacebookConnected({ enabled = true } = {}) {
	const [connected, setConnected] = useState(false);
	const [loading, setLoading] = useState(Boolean(enabled));

	const refresh = useCallback(async () => {
		if (!enabled) {
			setConnected(false);
			setLoading(false);
			return false;
		}
		setLoading(true);
		try {
			const response = await apiServerClient.fetch('/facebook/accounts?filter=connected', { method: 'GET' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				setConnected(false);
				return false;
			}
			const items = Array.isArray(payload) ? payload : (payload.items || payload.accounts || []);
			const next = items.some((account) => String(account.status || '').toLowerCase() === 'connected')
				|| items.length > 0;
			setConnected(next);
			return next;
		} catch {
			setConnected(false);
			return false;
		} finally {
			setLoading(false);
		}
	}, [enabled]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return { facebookConnected: connected, loading, refresh };
}
