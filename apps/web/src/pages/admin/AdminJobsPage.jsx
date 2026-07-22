import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { AdminHero, StatusPill, AdminPagination } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 8;

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

export default function AdminJobsPage() {
	const { toast } = useToast();
	const [search, setSearch] = useState('');
	const [status, setStatus] = useState('');
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);
	const [jobs, setJobs] = useState([]);
	const [totalItems, setTotalItems] = useState(0);
	const [totalPages, setTotalPages] = useState(1);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams({
				page: String(page),
				perPage: String(PAGE_SIZE),
			});
			if (search.trim()) params.set('q', search.trim());
			if (status) params.set('status', status);
			const response = await apiServerClient.fetch(`/admin/v1/queue/jobs?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setJobs(Array.isArray(payload.items) ? payload.items : []);
			setTotalItems(Number(payload.totalItems) || 0);
			setTotalPages(Math.max(1, Number(payload.totalPages) || 1));
		} catch (error) {
			toast({ variant: 'destructive', title: 'Jobs load failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [page, search, status, toast]);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(() => {
		if (page > totalPages) setPage(totalPages);
	}, [page, totalPages]);

	return (
		<div>
			<AdminHero
				title="Jobs"
				description="Historical and in-flight platform jobs from the unified queue engine."
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
					<button type="button" className="admin-btn" onClick={() => load()} disabled={loading}>
						{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
					</button>
				</div>
				{jobs.length > 0 ? (
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
								{jobs.map((job) => (
									<tr key={job.id}>
										<td style={{ color: 'var(--admin-muted)' }}>{job.id}</td>
										<td className="font-medium">{job.name || job.type}</td>
										<td>{job.workspace}</td>
										<td><StatusPill status={job.status} /></td>
										<td>{job.age}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>
						{loading ? 'Loading jobs…' : 'No jobs found.'}
					</p>
				)}
				<AdminPagination
					total={totalItems}
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
