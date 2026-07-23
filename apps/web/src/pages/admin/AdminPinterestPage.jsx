import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminHero, StatusPill, AdminEmptyState } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

export default function AdminPinterestPage() {
	const { toast } = useToast();
	const [search, setSearch] = useState('');
	const [status, setStatus] = useState('');
	const [accounts, setAccounts] = useState([]);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (search.trim()) params.set('q', search.trim());
			if (status) params.set('status', status);
			const response = await apiServerClient.fetch(`/admin/v1/inventory/pinterest-accounts?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setAccounts(Array.isArray(payload.items) ? payload.items : []);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Pinterest accounts failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [search, status, toast]);

	useEffect(() => {
		load();
	}, [load]);

	return (
		<div>
			<AdminHero
				title="Pinterest Accounts"
				description="Platform-wide Pinterest account overview from live PocketBase records."
			/>
			<div className="admin-toolbar mb-3">
				<label className="min-w-[12rem] flex-1">
					<span>Search</span>
					<input
						placeholder="Account or workspace"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</label>
				<label>
					<span>Status</span>
					<select value={status} onChange={(e) => setStatus(e.target.value)}>
						<option value="">All</option>
						<option value="connected">Connected</option>
						<option value="degraded">Degraded</option>
					</select>
				</label>
			</div>
			{loading ? (
				<section className="admin-card">
					<p className="admin-note flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading accounts…</p>
				</section>
			) : accounts.length === 0 ? (
				<section className="admin-card">
					<AdminEmptyState title="No accounts match" description="Adjust search or status filters and try again." />
				</section>
			) : (
				<div className="admin-workspace-grid">
					{accounts.map((account) => (
						<article key={account.id} className="admin-workspace">
							<div className="flex items-start justify-between gap-2">
								<h4>{account.name}</h4>
								<StatusPill status={account.status} />
							</div>
							<p>Workspace · {account.workspace}</p>
							<p>Boards · {account.boards}</p>
							<button type="button" className="admin-btn mt-3" disabled title="Display only">Inspect</button>
						</article>
					))}
				</div>
			)}
			<p className="admin-note">No Pinterest mutations — display only.</p>
		</div>
	);
}
