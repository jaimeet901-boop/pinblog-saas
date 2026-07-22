import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import { MOCK_WORKSPACES } from '@/pages/admin/mockData';

export default function AdminWorkspacesPage() {
	return (
		<div>
			<AdminHero
				title="Workspaces"
				description="Customer workspace cards with owner, plan, credits, and status. Placeholder data."
			/>
			<div className="admin-workspace-grid">
				{MOCK_WORKSPACES.map((ws) => (
					<article key={ws.id} className="admin-workspace">
						<div className="flex items-start justify-between gap-2">
							<h4>{ws.name}</h4>
							<StatusPill status={ws.status} />
						</div>
						<p>Owner · {ws.owner}</p>
						<p>Plan · {ws.plan}</p>
						<p>Credits · {ws.credits.toLocaleString()}</p>
						<p>Created · {ws.created}</p>
						<button type="button" className="admin-btn mt-3" disabled>Inspect</button>
					</article>
				))}
			</div>
		</div>
	);
}
