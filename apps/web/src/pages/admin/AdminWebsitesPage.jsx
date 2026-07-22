import { useMemo, useState } from 'react';
import { AdminHero, StatusPill, AdminEmptyState } from '@/components/admin/AdminUi';

const SITES = [
	{ id: 's1', domain: 'sundaykitchen.com', workspace: 'Sunday Kitchen', cms: 'WordPress', status: 'connected' },
	{ id: 's2', domain: 'pinatelier.blog', workspace: 'Pin Atelier', cms: 'WordPress', status: 'connected' },
	{ id: 's3', domain: 'recipelab.io', workspace: 'Recipe Lab', cms: 'WordPress', status: 'degraded' },
];

export default function AdminWebsitesPage() {
	const [search, setSearch] = useState('');
	const [status, setStatus] = useState('');

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return SITES.filter((site) => {
			if (status && site.status !== status) return false;
			if (!q) return true;
			return `${site.domain} ${site.workspace} ${site.cms}`.toLowerCase().includes(q);
		});
	}, [search, status]);

	return (
		<div>
			<AdminHero
				title="Websites"
				description="Connected customer sites across workspaces. Placeholder inventory."
			/>
			<section className="admin-card">
				<div className="admin-toolbar">
					<label className="min-w-[12rem] flex-1">
						<span>Search</span>
						<input
							placeholder="Domain or workspace"
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
					<AdminEmptyState title="No websites match" description="Adjust search or status filters and try again." />
				) : (
					<div className="admin-table-wrap">
						<table className="admin-table">
							<thead>
								<tr>
									<th>Domain</th>
									<th>Workspace</th>
									<th>CMS</th>
									<th>Status</th>
									<th>Actions</th>
								</tr>
							</thead>
							<tbody>
								{filtered.map((site) => (
									<tr key={site.id}>
										<td className="font-medium">{site.domain}</td>
										<td style={{ color: 'var(--admin-muted)' }}>{site.workspace}</td>
										<td>{site.cms}</td>
										<td><StatusPill status={site.status} /></td>
										<td><button type="button" className="admin-btn" disabled title="Backend not available">Open</button></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<p className="admin-note">No website mutations — display only.</p>
			</section>
		</div>
	);
}
