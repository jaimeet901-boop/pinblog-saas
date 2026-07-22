import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import { MOCK_QUEUE } from '@/pages/admin/mockData';

export default function AdminJobsPage() {
	return (
		<div>
			<AdminHero
				title="Jobs"
				description="Historical and in-flight platform jobs. Same mock source as Queue Monitor."
			/>
			<section className="admin-card">
				<div className="admin-toolbar">
					<label className="min-w-[12rem] flex-1">
						<span>Search</span>
						<input placeholder="Job name or workspace" disabled />
					</label>
					<label>
						<span>Status</span>
						<select disabled defaultValue="">
							<option value="">All</option>
							<option value="running">Running</option>
							<option value="failed">Failed</option>
						</select>
					</label>
					<button type="button" className="admin-btn" disabled>Refresh</button>
				</div>
				<div className="admin-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>ID</th>
								<th>Name</th>
								<th>Workspace</th>
								<th>Status</th>
								<th>Age</th>
							</tr>
						</thead>
						<tbody>
							{MOCK_QUEUE.jobs.map((job) => (
								<tr key={job.id}>
									<td style={{ color: 'var(--admin-muted)' }}>{job.id}</td>
									<td className="font-medium">{job.name}</td>
									<td>{job.workspace}</td>
									<td><StatusPill status={job.status} /></td>
									<td>{job.age}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}
