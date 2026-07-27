import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';
import apiServerClient, { setActiveWorkspaceId, getActiveWorkspaceId } from '@/lib/apiServerClient';
import { useAuth } from '@/context/AuthContext';

const STORAGE_KEY = 'chefia-active-workspace-id';
const WorkspaceContext = createContext(null);

function readStoredId() {
	try {
		return localStorage.getItem(STORAGE_KEY) || getActiveWorkspaceId() || '';
	} catch {
		return getActiveWorkspaceId() || '';
	}
}

export function WorkspaceProvider({ children }) {
	const { user, isAuthed } = useAuth();
	const [workspaces, setWorkspaces] = useState([]);
	const [activeWorkspaceId, setActiveWorkspaceIdState] = useState(() => readStoredId());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	const persist = useCallback((id, { emit = true } = {}) => {
		const next = String(id || '');
		const prev = getActiveWorkspaceId();
		setActiveWorkspaceIdState(next);
		setActiveWorkspaceId(next);
		try {
			if (next) localStorage.setItem(STORAGE_KEY, next);
			else localStorage.removeItem(STORAGE_KEY);
		} catch {
			/* ignore */
		}
		if (emit && next && next !== prev) {
			window.dispatchEvent(new CustomEvent('chefia:workspace-changed', { detail: { workspaceId: next } }));
		}
	}, []);

	const refresh = useCallback(async () => {
		if (!isAuthed) {
			setWorkspaces([]);
			setLoading(false);
			return [];
		}
		setLoading(true);
		try {
			const response = await apiServerClient.fetch('/workspace/v1/workspaces', { method: 'GET' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(payload.message || 'Failed to load workspaces');
			const items = Array.isArray(payload.items) ? payload.items : [];
			setWorkspaces(items);
			setError(null);

			const stored = readStoredId();
			const stillValid = items.some((item) => item.id === stored);
			if (stillValid) {
				persist(stored, { emit: false });
			} else if (items[0]?.id) {
				persist(items[0].id, { emit: true });
			} else {
				persist('', { emit: false });
			}
			return items;
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load workspaces');
			return [];
		} finally {
			setLoading(false);
		}
	}, [isAuthed, persist]);

	useEffect(() => {
		refresh();
	}, [refresh, user?.id]);

	const switchWorkspace = useCallback((workspaceId) => {
		persist(workspaceId, { emit: true });
	}, [persist]);

	const activeWorkspace = useMemo(
		() => workspaces.find((item) => item.id === activeWorkspaceId) || workspaces[0] || null,
		[workspaces, activeWorkspaceId],
	);

	const value = useMemo(() => ({
		workspaces,
		activeWorkspace,
		activeWorkspaceId: activeWorkspace?.id || activeWorkspaceId || '',
		loading,
		error,
		refresh,
		switchWorkspace,
	}), [workspaces, activeWorkspace, activeWorkspaceId, loading, error, refresh, switchWorkspace]);

	return (
		<WorkspaceContext.Provider value={value}>
			{children}
		</WorkspaceContext.Provider>
	);
}

export function useWorkspace() {
	const ctx = useContext(WorkspaceContext);
	if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
	return ctx;
}

export default WorkspaceContext;
