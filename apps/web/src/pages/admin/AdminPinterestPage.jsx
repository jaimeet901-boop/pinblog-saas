import { useMemo, useState } from 'react';
import { AdminHero, StatusPill, AdminEmptyState } from '@/components/admin/AdminUi';

const ACCOUNTS = [
	{ id: 'p1', name: 'Sunday Kitchen Pins', workspace: 'Sunday Kitchen', boards: 12, status: 'connected' },
	{ id: 'p2', name: 'Atelier Growth', workspace: 'Pin Atelier', boards: 5, status: 'connected' },
	{ id: 'p3', name: 'Agency Multi', workspace: 'Agency North', boards: 28, status: 'degraded' },
];

export default function AdminPinterestPage() {
	const [search, setSearch] = useState('');
	const [status, setStatus] = useState('');

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return ACCOUNTS.filter((account) => {
			if (status && account.status !== status) return false;
			if (!q) return true;
			return `${account.name} ${account.workspace}`.toLowerCase().includes(q);
		});
	}, [search, status]);

	return (
		<div>
			<AdminHero
				title="Pinterest Accounts"
				description="Platform-wide Pinterest account overview. No OAuth changes — UI only."
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
			{filtered.length === 0 ? (
				<section className="admin-card">
					<AdminEmptyState title="No accounts match" description="Adjust search or status filters and try again." />
				</section>
			) : (
				<div className="admin-workspace-grid">
					{filtered.map((account) => (
						<article key={account.id} className="admin-workspace">
							<div className="flex items-start justify-between gap-2">
								<h4>{account.name}</h4>
								<StatusPill status={account.status} />
							</div>
							<p>Workspace · {account.workspace}</p>
							<p>Boards · {account.boards}</p>
							<button type="button" className="admin-btn mt-3" disabled title="Backend not available">Inspect</button>
						</article>
					))}
				</div>
			)}
			<p className="admin-note">No Pinterest mutations — display only.</p>
		</div>
	);
}
