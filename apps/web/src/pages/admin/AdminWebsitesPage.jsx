import { AdminHero, StatusPill } from '@/components/admin/AdminUi';

const SITES = [
	{ id: 's1', domain: 'sundaykitchen.com', workspace: 'Sunday Kitchen', cms: 'WordPress', status: 'connected' },
	{ id: 's2', domain: 'pinatelier.blog', workspace: 'Pin Atelier', cms: 'WordPress', status: 'connected' },
	{ id: 's3', domain: 'recipelab.io', workspace: 'Recipe Lab', cms: 'WordPress', status: 'degraded' },
];

export default function AdminWebsitesPage() {
	return (
		<div>
			<AdminHero
				title="Websites"
				description="Connected customer sites across workspaces. Placeholder inventory."
			/>
			<section className="admin-card">
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
							{SITES.map((site) => (
								<tr key={site.id}>
									<td className="font-medium">{site.domain}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{site.workspace}</td>
									<td>{site.cms}</td>
									<td><StatusPill status={site.status} /></td>
									<td><button type="button" className="admin-btn" disabled>Open</button></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}
