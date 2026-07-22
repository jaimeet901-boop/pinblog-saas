import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { canAccessAdminConsole } from '@/lib/adminRbac';
import { Spinner } from '@/components/kit';
import './AdminLayout.css';

/**
 * Frontend-only admin gate.
 * Does not change PocketBase auth or backend permissions.
 */
export default function AdminRoute({ children }) {
	const { isAuthed, user } = useAuth();

	if (!isAuthed) {
		return <Navigate to="/login" replace />;
	}

	if (!canAccessAdminConsole(user)) {
		return (
			<div className="admin-denied">
				<div>
					<p className="mb-2 text-xs font-bold uppercase tracking-[0.16em]" style={{ color: '#e8a87c' }}>Chef IA Admin Console</p>
					<h1 className="font-display text-2xl font-semibold">Access restricted</h1>
					<p className="mx-auto mt-2 max-w-md text-sm" style={{ color: '#9aa3b5' }}>
						This area is reserved for platform administrators. Your workspace remains available at /app.
					</p>
					<a href="/app" className="mt-5 inline-flex rounded-xl px-4 py-2 text-sm font-semibold" style={{ background: 'rgba(232,168,124,0.18)', color: '#e8a87c' }}>
						Return to Workspace
					</a>
				</div>
			</div>
		);
	}

	if (!user) {
		return (
			<div className="flex min-h-[100dvh] items-center justify-center bg-[#0c0e12] text-[#e8a87c]">
				<Spinner />
			</div>
		);
	}

	return children;
}
