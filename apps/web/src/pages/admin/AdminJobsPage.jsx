import { useEffect, useMemo, useState } from 'react';
import { AdminHero, StatusPill, AdminPagination } from '@/components/admin/AdminUi';
import { MOCK_QUEUE } from '@/pages/admin/mockData';

const PAGE_SIZE = 8;

export default function AdminJobsPage() {
	const [search, setSearch] = useState('');
	const [status, setStatus] = useState('');
	const [page, setPage] = useState(1);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return MOCK_QUEUE.jobs.filter((job) => {
			if (status && job.status !== status) return false;
			if (!q) return true;
			return `${job.id} ${job.name} ${job.workspace}`.toLowerCase().includes(q);
		});
	}, [search, status]);

	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

	useEffect(() => {
		if (page > totalPages) setPage(totalPages);
	}, [page, totalPages]);

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
						<input
							placeholder="Job name or workspace"
							value={search}
							onChange={(e) => { setSearch(e.target.value); setPage(1); }}
						/>
					</label>
					<label>
						<span>Status</span>
						<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
							<option value="">All</option>
							<option value="running">Running</option>
							<option value="failed">Failed</option>
							<option value="completed">Completed</option>
							<option value="queued">Queued</option>
						</select>
					</label>
					<button type="button" className="admin-btn" disabled title="Backend not available">Refresh</button>
				</div>
				{filtered.length > 0 ? (
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
								{rows.map((job) => (
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
				) : null}
				<AdminPagination
					total={filtered.length}
					page={page}
					totalPages={totalPages}
					noun="jobs"
					onPrev={() => setPage((prev) => prev - 1)}
					onNext={() => setPage((prev) => prev + 1)}
				/>
			</section>
		</div>
	);
}
