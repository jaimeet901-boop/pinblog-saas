import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from 'react';
import apiServerClient from '@/lib/apiServerClient';
import {
	isFeatureEnabledInConfig,
	mergeWorkspaceConfig,
	WORKSPACE_CONFIG_DEFAULTS,
} from '@/lib/workspaceConfigDefaults';

const WorkspaceConfigContext = createContext(null);

const POLL_MS = 60_000;
const SSE_RETRY_MS = 10_000;

/**
 * Optional platform config provider.
 * Non-blocking: keeps last valid config while refreshing; never clears on background failure.
 */
export function WorkspaceConfigProvider({ children }) {
	const [config, setConfig] = useState(() => mergeWorkspaceConfig(WORKSPACE_CONFIG_DEFAULTS));
	const [configVersion, setConfigVersion] = useState('0');
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [error, setError] = useState(null);
	const [hasValidConfig, setHasValidConfig] = useState(false);
	const [lastConfigUpdate, setLastConfigUpdate] = useState(null);
	const [lastRefreshDurationMs, setLastRefreshDurationMs] = useState(0);
	const [cacheStatus, setCacheStatus] = useState('default');

	const lastValidRef = useRef(null);
	const inFlightRef = useRef(null);
	const mountedRef = useRef(true);

	const applyConfig = useCallback((payload, { fromCache = false } = {}) => {
		const merged = mergeWorkspaceConfig(payload);
		lastValidRef.current = merged;
		setConfig(merged);
		setConfigVersion(String(merged.configVersion || '0'));
		setLastConfigUpdate(merged.updated_at || new Date().toISOString());
		setHasValidConfig(true);
		setCacheStatus(fromCache ? 'cached' : 'fresh');
		setError(null);
	}, []);

	const refresh = useCallback(async ({ silent = false } = {}) => {
		if (inFlightRef.current) {
			return inFlightRef.current;
		}

		if (!silent && !lastValidRef.current) {
			setIsLoading(true);
		} else {
			setIsRefreshing(true);
		}

		const started = typeof performance !== 'undefined' ? performance.now() : Date.now();

		const run = (async () => {
			try {
				const headers = {};
				const since = lastValidRef.current?.configVersion;
				if (since && since !== '0') {
					headers['If-None-Match'] = `"${since}"`;
				}

				const response = await apiServerClient.fetch('/workspace/v1/config', {
					method: 'GET',
					headers,
				});

				const durationMs = Math.round(
					(typeof performance !== 'undefined' ? performance.now() : Date.now()) - started,
				);
				if (mountedRef.current) {
					setLastRefreshDurationMs(durationMs);
				}

				if (response.status === 304) {
					setError(null);
					setCacheStatus('cached');
					return lastValidRef.current;
				}

				if (!response.ok) {
					throw new Error(`Workspace config HTTP ${response.status}`);
				}

				const payload = await response.json();
				if (!mountedRef.current) return payload;
				applyConfig(payload, { fromCache: false });
				return payload;
			} catch (err) {
				if (!mountedRef.current) return null;
				setError(err instanceof Error ? err.message : 'Failed to load workspace config');
				if (lastValidRef.current) {
					setConfig(lastValidRef.current);
					setCacheStatus('stale');
				} else {
					setCacheStatus('default');
				}
				return lastValidRef.current;
			} finally {
				if (mountedRef.current) {
					setIsLoading(false);
					setIsRefreshing(false);
				}
				inFlightRef.current = null;
			}
		})();

		inFlightRef.current = run;
		return run;
	}, [applyConfig]);

	useEffect(() => {
		mountedRef.current = true;
		refresh({ silent: false });
		return () => {
			mountedRef.current = false;
		};
	}, [refresh]);

	useEffect(() => {
		let cancelled = false;
		let abort;
		let retryTimer;
		let pollTimer;

		const schedulePoll = () => {
			if (pollTimer) window.clearInterval(pollTimer);
			pollTimer = window.setInterval(() => {
				refresh({ silent: true });
			}, POLL_MS);
		};

		const connect = async () => {
			abort = new AbortController();
			try {
				const response = await apiServerClient.fetch('/workspace/v1/config/stream', {
					signal: abort.signal,
					headers: { Accept: 'text/event-stream' },
				});
				if (!response.ok || !response.body) throw new Error('SSE unavailable');

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				while (!cancelled) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const chunks = buffer.split('\n\n');
					buffer = chunks.pop() || '';
					for (const chunk of chunks) {
						if (chunk.includes('event: config')) {
							refresh({ silent: true });
							break;
						}
					}
				}
				if (!cancelled) throw new Error('SSE closed');
			} catch {
				if (!cancelled) {
					schedulePoll();
					retryTimer = window.setTimeout(connect, SSE_RETRY_MS);
				}
			}
		};

		connect();
		schedulePoll();

		return () => {
			cancelled = true;
			abort?.abort();
			if (retryTimer) window.clearTimeout(retryTimer);
			if (pollTimer) window.clearInterval(pollTimer);
		};
	}, [refresh]);

	const isFeatureEnabled = useCallback((flagId, fallback = false) => (
		isFeatureEnabledInConfig(config, flagId, fallback)
	), [config]);

	const value = {
		config,
		configVersion,
		isLoading: isLoading && !hasValidConfig,
		isRefreshing,
		error,
		hasValidConfig,
		lastConfigUpdate,
		lastRefreshDurationMs,
		cacheStatus,
		refresh: () => refresh({ silent: Boolean(lastValidRef.current) }),
		isFeatureEnabled,
	};

	return (
		<WorkspaceConfigContext.Provider value={value}>
			{children}
		</WorkspaceConfigContext.Provider>
	);
}

/**
 * Opt-in hook. Existing modules that do not call this continue unchanged.
 * Outside provider: returns safe defaults (rollout-safe).
 */
export function useWorkspaceConfig() {
	const ctx = useContext(WorkspaceConfigContext);
	if (!ctx) {
		const config = mergeWorkspaceConfig(WORKSPACE_CONFIG_DEFAULTS);
		return {
			config,
			configVersion: '0',
			isLoading: false,
			isRefreshing: false,
			error: null,
			hasValidConfig: false,
			lastConfigUpdate: null,
			lastRefreshDurationMs: 0,
			cacheStatus: 'default',
			refresh: async () => config,
			isFeatureEnabled: (flagId, fallback = false) => isFeatureEnabledInConfig(config, flagId, fallback),
		};
	}
	return ctx;
}

export default WorkspaceConfigContext;
