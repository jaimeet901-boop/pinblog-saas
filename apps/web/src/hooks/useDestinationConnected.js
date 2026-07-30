import { useCallback, useEffect, useState } from 'react';
import apiServerClient from '@/lib/apiServerClient';

/**
 * Generic destination connection signal (Pinterest / Facebook).
 */
export function useDestinationConnected(destinationAdapter, { enabled = true } = {}) {
	const [connected, setConnected] = useState(false);
	const [loading, setLoading] = useState(Boolean(enabled));
	const connectedPath = destinationAdapter?.connectedPath || '';

	const refresh = useCallback(async () => {
		if (!enabled || !connectedPath) {
			setConnected(false);
			setLoading(false);
			return false;
		}
		setLoading(true);
		try {
			const response = await apiServerClient.fetch(connectedPath, { method: 'GET' });
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
	}, [enabled, connectedPath]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return { connected, loading, refresh };
}
