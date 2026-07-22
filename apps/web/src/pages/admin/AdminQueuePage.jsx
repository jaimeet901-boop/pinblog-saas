import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import { MOCK_QUEUE } from '@/pages/admin/mockData';

export default function AdminQueuePage() {
	return (
		<div>
			<AdminHero
				title="Queue Monitor"
				description="Running, waiting, completed, failed, and retry queues. Mock telemetry only."
			/>
			<div className="admin-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))' }}>
				{[
					{ label: 'Running', value: MOCK_QUEUE.running },
					{ label: 'Waiting', value: MOCK_QUEUE.waiting },
					{ label: 'Completed', value: MOCK_QUEUE.completed },
					{ label: 'Failed', value: MOCK_QUEUE.failed },
					{ label: 'Retry', value: MOCK_QUEUE.retry },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
					</div>
				))}
			</div>
			<section className="admin-card">
				<div className="mb-3 flex items-center justify-between gap-2">
					<h3 className="m-0">Live jobs</h3>
					<button type="button" className="admin-btn" disabled>Retry failed</button>
				</div>
				<div className="admin-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>Job</th>
								<th>Workspace</th>
								<th>Status</th>
								<th>Age</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{MOCK_QUEUE.jobs.map((job) => (
								<tr key={job.id}>
									<td className="font-medium">{job.name}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{job.workspace}</td>
									<td><StatusPill status={job.status} /></td>
									<td style={{ color: 'var(--admin-muted)' }}>{job.age}</td>
									<td><button type="button" className="admin-btn" disabled>Retry</button></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}
