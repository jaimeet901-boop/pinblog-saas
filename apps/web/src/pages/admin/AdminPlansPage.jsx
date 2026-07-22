import { AdminHero, StatusPill } from '@/components/admin/AdminUi';

const PLANS = [
	{ name: 'Free', price: '$0', subscribers: 420, status: 'active' },
	{ name: 'Starter', price: '$19', subscribers: 268, status: 'active' },
	{ name: 'Pro', price: '$49', subscribers: 184, status: 'active' },
	{ name: 'Agency', price: '$129', subscribers: 40, status: 'active' },
];

export default function AdminPlansPage() {
	return (
		<div>
			<AdminHero
				title="Subscriptions"
				description="Plan catalog and subscriber counts. UI structure only — billing APIs unchanged."
			/>
			<div className="admin-workspace-grid">
				{PLANS.map((plan) => (
					<article key={plan.name} className="admin-workspace">
						<div className="flex items-start justify-between gap-2">
							<h4>{plan.name}</h4>
							<StatusPill status={plan.status} />
						</div>
						<p className="mt-2 text-2xl font-semibold" style={{ fontFamily: 'var(--font-display, Georgia, serif)' }}>{plan.price}<span className="text-sm font-normal" style={{ color: 'var(--admin-muted)' }}>/mo</span></p>
						<p>{plan.subscribers.toLocaleString()} subscribers (mock)</p>
						<button type="button" className="admin-btn mt-3" disabled>Edit plan</button>
					</article>
				))}
			</div>
		</div>
	);
}
