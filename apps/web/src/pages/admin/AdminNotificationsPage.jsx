import { AdminHero, StatusPill } from '@/components/admin/AdminUi';

const NOTES = [
	{ id: 'n1', title: 'Maintenance window Friday 02:00 UTC', channel: 'email', status: 'scheduled' },
	{ id: 'n2', title: 'Credit top-up receipt template', channel: 'email', status: 'draft' },
	{ id: 'n3', title: 'Pinterest quota warning', channel: 'in-app', status: 'active' },
];

export default function AdminNotificationsPage() {
	return (
		<div>
			<AdminHero
				title="Notifications"
				description="Platform announcement and alert templates. UI placeholders only."
				action={<button type="button" className="admin-btn admin-btn--primary" disabled title="Backend not available">Compose</button>}
			/>
			<section className="admin-card">
				<div className="admin-list">
					{NOTES.map((note) => (
						<div key={note.id} className="admin-list__item">
							<span>
								<strong className="block">{note.title}</strong>
								<span style={{ color: 'var(--admin-muted)', fontSize: '0.75rem' }}>{note.channel}</span>
							</span>
							<StatusPill status={note.status} />
						</div>
					))}
				</div>
				<p className="admin-note">No notification sends — display only.</p>
			</section>
		</div>
	);
}
