import { AdminHero } from '@/components/admin/AdminUi';

const SERIES = [
	{ label: 'Articles', value: 78 },
	{ label: 'Images', value: 64 },
	{ label: 'Pins', value: 81 },
	{ label: 'Publishes', value: 52 },
	{ label: 'Credits', value: 69 },
];

export default function AdminAnalyticsPage() {
	return (
		<div>
			<AdminHero
				title="Platform Analytics"
				description="Cross-workspace performance placeholders for the admin command center."
			/>
			<div className="admin-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
				{[
					{ label: 'DAU', value: '418' },
					{ label: 'WAU', value: '1,102' },
					{ label: 'Publish success', value: '96%' },
					{ label: 'Avg gen time', value: '18s' },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
						<p className="admin-stat__hint">Mock</p>
					</div>
				))}
			</div>
			<section className="admin-card">
				<h3>Feature adoption</h3>
				<div className="admin-bars">
					{SERIES.map((row) => (
						<div key={row.label} className="admin-bar-row">
							<span>{row.label}</span>
							<div className="admin-bar-track">
								<div className="admin-bar-fill" style={{ width: `${row.value}%` }} />
							</div>
							<span>{row.value}%</span>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
