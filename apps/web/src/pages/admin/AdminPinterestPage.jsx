import { AdminHero, StatusPill } from '@/components/admin/AdminUi';

const ACCOUNTS = [
	{ id: 'p1', name: 'Sunday Kitchen Pins', workspace: 'Sunday Kitchen', boards: 12, status: 'connected' },
	{ id: 'p2', name: 'Atelier Growth', workspace: 'Pin Atelier', boards: 5, status: 'connected' },
	{ id: 'p3', name: 'Agency Multi', workspace: 'Agency North', boards: 28, status: 'degraded' },
];

export default function AdminPinterestPage() {
	return (
		<div>
			<AdminHero
				title="Pinterest Accounts"
				description="Platform-wide Pinterest account overview. No OAuth changes — UI only."
			/>
			<div className="admin-workspace-grid">
				{ACCOUNTS.map((account) => (
					<article key={account.id} className="admin-workspace">
						<div className="flex items-start justify-between gap-2">
							<h4>{account.name}</h4>
							<StatusPill status={account.status} />
						</div>
						<p>Workspace · {account.workspace}</p>
						<p>Boards · {account.boards}</p>
						<button type="button" className="admin-btn mt-3" disabled>Inspect</button>
					</article>
				))}
			</div>
		</div>
	);
}
