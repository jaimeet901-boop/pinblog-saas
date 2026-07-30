import { Link } from 'react-router-dom';
import { AdminHero } from '@/components/admin/AdminUi';

const PHASE_HINTS = {
	dashboard: 'Revenue Sources and KPIs arrive in a later Billing Control Plane phase.',
	health: 'Provider Health is live under Billing → Provider Health.',
	'price-mapping': 'Price Mapping is a later Control Plane phase.',
	events: 'Payment Events surface existing billing_events in a later phase.',
	webhooks: 'Webhook Monitor surfaces billing_idempotency in a later phase.',
	monitoring: 'Enterprise monitoring widgets arrive in a later phase.',
	backup: 'Backup & Restore is a later Control Plane phase.',
};

export default function AdminBillingPlaceholderPage({
	title,
	description,
	phaseKey = 'dashboard',
}) {
	return (
		<div>
			<AdminHero
				title={title}
				description={description}
				action={(
					<Link to="/admin/billing/providers" className="admin-btn admin-btn--primary">
						Open Billing Providers
					</Link>
				)}
			/>
			<section className="admin-card">
				<p className="admin-note mt-0">
					Placeholder page for BP-1 navigation. {PHASE_HINTS[phaseKey] || 'Coming in a later phase.'}
				</p>
				<p style={{ color: 'var(--admin-muted)', fontSize: 13 }}>
					Functional now: <Link to="/admin/billing/providers">Billing Providers</Link>
					{' · '}
					<Link to="/admin/billing/logs">Billing Logs</Link>
				</p>
			</section>
		</div>
	);
}
