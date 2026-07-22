import { AdminHero } from '@/components/admin/AdminUi';

export default function AdminCreditsPage() {
	return (
		<div>
			<AdminHero
				title="Credits"
				description="Platform credit pools, grants, and burn rate. Placeholder widgets only."
			/>
			<div className="admin-stats admin-stats--compact">
				{[
					{ label: 'Credits issued', value: '120,400' },
					{ label: 'Credits burned', value: '48,290' },
					{ label: 'Avg / workspace', value: '53' },
					{ label: 'Top-ups (30d)', value: '312' },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
						<p className="admin-stat__hint">Mock</p>
					</div>
				))}
			</div>
			<section className="admin-card">
				<h3>Ledger preview</h3>
				<div className="admin-list">
					{[
						{ text: 'Agency North · +5,000 grant', time: 'Today' },
						{ text: 'Sunday Kitchen · −120 AI Pins', time: 'Today' },
						{ text: 'Pin Atelier · −40 Writer', time: 'Yesterday' },
					].map((row) => (
						<div key={row.text} className="admin-list__item">
							<span>{row.text}</span>
							<span>{row.time}</span>
						</div>
					))}
				</div>
				<p className="admin-note">No credit mutations — display only.</p>
			</section>
		</div>
	);
}
