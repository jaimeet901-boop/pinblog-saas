import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import {
	MOCK_ACTIVITY, MOCK_ALERTS, MOCK_STATS,
} from '@/pages/admin/mockData';

const STAT_CARDS = [
	{ label: 'Active users', value: MOCK_STATS.activeUsers.toLocaleString(), hint: 'Placeholder' },
	{ label: 'Workspaces', value: MOCK_STATS.workspaces.toLocaleString(), hint: 'Placeholder' },
	{ label: 'Credits used', value: MOCK_STATS.creditsUsed.toLocaleString(), hint: 'Placeholder' },
	{ label: 'AI requests', value: MOCK_STATS.aiRequests.toLocaleString(), hint: 'Placeholder' },
	{ label: 'Revenue', value: `$${MOCK_STATS.revenue.toLocaleString()}`, hint: 'Placeholder MRR' },
	{ label: 'Server health', value: MOCK_STATS.serverHealth, hint: 'All systems' },
];

const CHART = [
	{ label: 'Mon', value: 42 },
	{ label: 'Tue', value: 58 },
	{ label: 'Wed', value: 51 },
	{ label: 'Thu', value: 73 },
	{ label: 'Fri', value: 66 },
	{ label: 'Sat', value: 39 },
	{ label: 'Sun', value: 47 },
];

export default function AdminDashboardPage() {
	return (
		<div>
			<AdminHero
				title="Platform Command Center"
				description="Premium overview of Chef IA platform health. All widgets use placeholder data until APIs are connected."
			/>

			<div className="admin-stats">
				{STAT_CARDS.map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
						<p className="admin-stat__hint">{card.hint}</p>
					</div>
				))}
			</div>

			<div className="admin-grid admin-grid--2">
				<section className="admin-card">
					<h3>AI request volume</h3>
					<div className="admin-bars">
						{CHART.map((row) => (
							<div key={row.label} className="admin-bar-row">
								<span>{row.label}</span>
								<div className="admin-bar-track">
									<div className="admin-bar-fill" style={{ width: `${row.value}%` }} />
								</div>
								<span>{row.value}%</span>
							</div>
						))}
					</div>
					<p className="admin-note">Static chart preview — no live telemetry yet.</p>
				</section>

				<section className="admin-card">
					<h3>System alerts</h3>
					<div className="admin-list">
						{MOCK_ALERTS.map((alert) => (
							<div key={alert.id} className="admin-list__item">
								<span>{alert.text}</span>
								<StatusPill status={alert.tone === 'green' ? 'healthy' : alert.tone === 'red' ? 'failed' : 'warn'} />
							</div>
						))}
					</div>
				</section>
			</div>

			<div className="admin-grid admin-grid--2 mt-4">
				<section className="admin-card">
					<h3>Recent registrations</h3>
					<div className="admin-list">
						{[
							{ name: 'Jules Park', plan: 'starter' },
							{ name: 'Maya Chen', plan: 'pro' },
							{ name: 'Noah Silva', plan: 'free' },
						].map((row) => (
							<div key={row.name} className="admin-list__item">
								<span>{row.name}</span>
								<StatusPill status={row.plan} />
							</div>
						))}
					</div>
				</section>

				<section className="admin-card">
					<h3>Recent activity</h3>
					<div className="admin-list">
						{MOCK_ACTIVITY.map((item) => (
							<div key={item.id} className="admin-list__item">
								<span>{item.text}</span>
								<span>{item.time}</span>
							</div>
						))}
					</div>
				</section>
			</div>
		</div>
	);
}
