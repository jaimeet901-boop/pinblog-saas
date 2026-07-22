import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import { MOCK_HEALTH } from '@/pages/admin/mockData';

export default function AdminSystemPage() {
	return (
		<div>
			<AdminHero
				title="System Health"
				description="API, database, queue, storage, workers, email, and AI provider status widgets — all placeholders."
			/>
			<div className="admin-health">
				{MOCK_HEALTH.map((item) => (
					<article key={item.name} className="admin-health__card">
						<div className="flex items-start justify-between gap-2">
							<strong>{item.name}</strong>
							<StatusPill status={item.status} />
						</div>
						<p>{item.detail}</p>
					</article>
				))}
			</div>
			<section className="admin-card mt-4">
				<h3>Incident timeline</h3>
				<div className="admin-list">
					{[
						{ text: 'Queue depth spiked to 40 jobs', time: '2h ago' },
						{ text: 'Fal.ai latency recovered', time: '5h ago' },
						{ text: 'Nightly backup completed', time: '8h ago' },
					].map((row) => (
						<div key={row.text} className="admin-list__item">
							<span>{row.text}</span>
							<span>{row.time}</span>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
