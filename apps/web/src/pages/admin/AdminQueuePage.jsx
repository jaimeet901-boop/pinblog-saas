import { useEffect, useMemo, useState } from 'react';
import {
	RefreshCw, Download, Eye, RotateCcw, Ban, Pause, Play, ScrollText, Trash2, ListRestart, X,
} from 'lucide-react';
import { AdminHero, StatusPill, AdminPagination, AdminProgressBar } from '@/components/admin/AdminUi';
import { MOCK_QUEUE_MONITOR as DATA } from '@/pages/admin/queueMonitorMock';

const PAGE_SIZE = 8;
const BACKEND_READY = false;

const JOB_TYPES = [
	'AI Article Generation',
	'Recipe Generation',
	'Image Generation',
	'Pinterest Publishing',
	'WordPress Publishing',
	'Bulk Publishing',
	'SEO Optimization',
	'Template Rendering',
	'Import',
	'Export',
	'Webhook Delivery',
	'Email Notification',
];

const STATUSES = ['queued', 'waiting', 'running', 'completed', 'failed', 'retrying', 'paused', 'cancelled'];

export default function AdminQueuePage() {
	const [search, setSearch] = useState('');
	const [jobType, setJobType] = useState('');
	const [status, setStatus] = useState('');
	const [priority, setPriority] = useState('');
	const [provider, setProvider] = useState('');
	const [workspace, setWorkspace] = useState('');
	const [dateRange, setDateRange] = useState('');
	const [page, setPage] = useState(1);
	const [selectedId, setSelectedId] = useState('');
	const [autoRefresh, setAutoRefresh] = useState(false);
	const [refreshedAt, setRefreshedAt] = useState(() => new Date().toLocaleTimeString());
	const [tick, setTick] = useState(0);

	const providerOptions = useMemo(
		() => [...new Set(DATA.jobs.map((job) => job.provider).filter((value) => value && value !== '—'))].sort(),
		[],
	);
	const workspaceOptions = useMemo(
		() => [...new Set(DATA.jobs.map((job) => job.workspace))].sort(),
		[],
	);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return DATA.jobs.filter((job) => {
			if (jobType && job.type !== jobType) return false;
			if (status && job.status !== status) return false;
			if (priority && job.priority !== priority) return false;
			if (provider && job.provider !== provider) return false;
			if (workspace && job.workspace !== workspace) return false;
			if (dateRange === 'today' && !String(job.created).startsWith('2026-07-22')) return false;
			if (!q) return true;
			const haystack = [job.id, job.type, job.workspace, job.owner, job.provider, job.worker].join(' ').toLowerCase();
			return haystack.includes(q);
		});
	}, [search, jobType, status, priority, provider, workspace, dateRange, tick]);

	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
	const selected = DATA.jobs.find((job) => job.id === selectedId) || null;

	useEffect(() => {
		if (page > totalPages) setPage(totalPages);
	}, [page, totalPages]);

	useEffect(() => {
		if (!autoRefresh) return undefined;
		const id = window.setInterval(() => {
			setTick((value) => value + 1);
			setRefreshedAt(new Date().toLocaleTimeString());
		}, 8000);
		return () => window.clearInterval(id);
	}, [autoRefresh]);

	useEffect(() => {
		if (!selected) return undefined;
		const onKeyDown = (event) => {
			if (event.key === 'Escape') setSelectedId('');
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [selected]);

	const refresh = () => {
		setTick((value) => value + 1);
		setRefreshedAt(new Date().toLocaleTimeString());
	};

	return (
		<div>
			<AdminHero
				title="Queue & Jobs Monitor"
				description="Monitor all background jobs running across the Chef IA platform. Mock telemetry only."
				action={(
					<div className="admin-analytics-controls">
						<label className="admin-check" style={{ color: 'var(--admin-muted)', marginBottom: '0.35rem' }}>
							<input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
							<span>Auto Refresh</span>
						</label>
						<button type="button" className="admin-btn" onClick={refresh}>
							<RefreshCw size={13} /> Refresh
						</button>
						<button type="button" className="admin-btn admin-btn--primary" disabled title="UI only">
							<Download size={13} /> Export
						</button>
					</div>
				)}
			/>

			<p className="admin-note mt-0 mb-3">
				Last refreshed {refreshedAt}
				{autoRefresh ? ' · auto every 8s (UI pulse only)' : ''}
			</p>

			<div className="admin-stats admin-stats--compact">
				{[
					{ label: 'Running Jobs', value: DATA.summary.running },
					{ label: 'Queued Jobs', value: DATA.summary.queued },
					{ label: 'Completed Today', value: DATA.summary.completedToday },
					{ label: 'Failed Jobs', value: DATA.summary.failed },
					{ label: 'Retry Queue', value: DATA.summary.retry },
					{ label: 'Average Processing Time', value: DATA.summary.avgProcessingTime },
					{ label: 'Workers Online', value: DATA.summary.workersOnline },
					{ label: 'Jobs Per Minute', value: DATA.summary.jobsPerMinute },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{typeof card.value === 'number' ? card.value.toLocaleString() : card.value}</p>
						<p className="admin-stat__hint">Mock</p>
					</div>
				))}
			</div>

			<div className="admin-toolbar">
				<label className="min-w-[14rem] flex-1">
					<span>Search</span>
					<input
						value={search}
						onChange={(e) => { setSearch(e.target.value); setPage(1); }}
						placeholder="Job ID, type, workspace, owner…"
					/>
				</label>
				<label>
					<span>Job Type</span>
					<select value={jobType} onChange={(e) => { setJobType(e.target.value); setPage(1); }}>
						<option value="">All types</option>
						{JOB_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
					</select>
				</label>
				<label>
					<span>Status</span>
					<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
						<option value="">All statuses</option>
						{STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
					</select>
				</label>
				<label>
					<span>Priority</span>
					<select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }}>
						<option value="">All</option>
						<option value="high">High</option>
						<option value="normal">Normal</option>
						<option value="low">Low</option>
					</select>
				</label>
				<label>
					<span>Provider</span>
					<select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }}>
						<option value="">All providers</option>
						{providerOptions.map((item) => <option key={item} value={item}>{item}</option>)}
					</select>
				</label>
				<label>
					<span>Workspace</span>
					<select value={workspace} onChange={(e) => { setWorkspace(e.target.value); setPage(1); }}>
						<option value="">All workspaces</option>
						{workspaceOptions.map((item) => <option key={item} value={item}>{item}</option>)}
					</select>
				</label>
				<label>
					<span>Date Range</span>
					<select value={dateRange} onChange={(e) => { setDateRange(e.target.value); setPage(1); }}>
						<option value="">Any time</option>
						<option value="today">Today</option>
					</select>
				</label>
			</div>

			<section className="admin-card">
				<div className="admin-table-wrap">
					<table className="admin-table" style={{ minWidth: '78rem' }}>
						<thead>
							<tr>
								<th>Job ID</th>
								<th>Job Type</th>
								<th>Workspace</th>
								<th>Owner</th>
								<th>Provider</th>
								<th>Priority</th>
								<th>Status</th>
								<th>Progress</th>
								<th>Worker</th>
								<th>Created</th>
								<th>Started</th>
								<th>Duration</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((job) => (
								<tr
									key={job.id}
									className={selectedId === job.id ? 'is-selected' : ''}
									onClick={() => setSelectedId(job.id)}
								>
									<td className="font-medium" style={{ whiteSpace: 'nowrap' }}>{job.id}</td>
									<td>{job.type}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{job.workspace}</td>
									<td>{job.owner}</td>
									<td>{job.provider}</td>
									<td><StatusPill status={job.priority} /></td>
									<td><StatusPill status={job.status} /></td>
									<td><AdminProgressBar value={job.progress} /></td>
									<td style={{ color: 'var(--admin-muted)' }}>{job.worker}</td>
									<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{job.created}</td>
									<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{job.started}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{job.duration}</td>
									<td onClick={(event) => event.stopPropagation()}>
										<div className="flex flex-wrap gap-1">
											<button type="button" className="admin-btn" onClick={() => setSelectedId(job.id)}>
												<Eye size={12} /> View
											</button>
											<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
												<RotateCcw size={12} /> Retry
											</button>
											<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
												<Ban size={12} /> Cancel
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<AdminPagination
					total={filtered.length}
					page={page}
					totalPages={totalPages}
					noun="jobs"
					onPrev={() => setPage((prev) => prev - 1)}
					onNext={() => setPage((prev) => prev + 1)}
				/>
			</section>

			<div className="admin-grid admin-grid--2 mt-4">
				<section className="admin-card">
					<h3>Live Activity</h3>
					<div className="admin-analytics-timeline">
						{DATA.activity.map((item) => (
							<div key={item.id} className="admin-analytics-timeline__item">
								<span className="admin-analytics-timeline__dot" aria-hidden="true" />
								<div>
									<p className="font-medium text-sm">{item.text}</p>
									<p className="text-xs" style={{ color: 'var(--admin-muted)' }}>{item.kind} · {item.time}</p>
								</div>
							</div>
						))}
					</div>
				</section>

				<section className="admin-card">
					<h3>Queue Health</h3>
					<div className="admin-analytics-mini">
						{[
							{ label: 'Average Queue Time', value: DATA.health.avgQueueTime },
							{ label: 'Longest Waiting Job', value: DATA.health.longestWaiting },
							{ label: 'Oldest Running Job', value: DATA.health.oldestRunning },
							{ label: 'Queue Capacity', value: DATA.health.queueCapacity },
							{ label: 'Worker Utilization', value: DATA.health.workerUtilization },
						].map((card) => (
							<div key={card.label} className="admin-stat">
								<p className="admin-stat__label">{card.label}</p>
								<p className="admin-stat__value" style={{ fontSize: '1.05rem' }}>{card.value}</p>
							</div>
						))}
					</div>
				</section>
			</div>

			<section className="admin-card mt-4">
				<h3>Workers</h3>
				<div className="admin-table-wrap">
					<table className="admin-table" style={{ minWidth: '48rem' }}>
						<thead>
							<tr>
								<th>Worker</th>
								<th>Status</th>
								<th>Current Job</th>
								<th>CPU</th>
								<th>Memory</th>
								<th>Jobs Today</th>
								<th>Average Time</th>
							</tr>
						</thead>
						<tbody>
							{DATA.workers.map((worker) => (
								<tr key={worker.id}>
									<td className="font-medium">{worker.id}</td>
									<td><StatusPill status={worker.status} /></td>
									<td style={{ color: 'var(--admin-muted)' }}>{worker.currentJob}</td>
									<td>{worker.cpu}</td>
									<td>{worker.memory}</td>
									<td>{worker.jobsToday}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{worker.avgTime}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			{selected ? (
				<div className="admin-drawer-overlay" role="dialog" aria-modal="true" aria-label="Job details" onClick={() => setSelectedId('')}>
					<aside className="admin-user-drawer admin-user-drawer--wide" onClick={(event) => event.stopPropagation()}>
						<div className="admin-user-drawer__head">
							<div>
								<p className="font-display text-xl font-semibold leading-tight">{selected.id}</p>
								<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.type}</p>
								<div className="mt-2 flex flex-wrap gap-2">
									<StatusPill status={selected.status} />
									<StatusPill status={selected.priority} />
								</div>
							</div>
							<button type="button" className="admin-icon-btn" onClick={() => setSelectedId('')} aria-label="Close">
								<X size={16} />
							</button>
						</div>

						<section className="admin-user-drawer__section">
							<h3>Job Information</h3>
							<div className="admin-meta-row"><span>Workspace</span><span>{selected.workspace}</span></div>
							<div className="admin-meta-row"><span>Owner</span><span>{selected.owner}</span></div>
							<div className="admin-meta-row"><span>Created</span><span>{selected.created}</span></div>
							<div className="admin-meta-row"><span>Started</span><span>{selected.started}</span></div>
							<div className="admin-meta-row"><span>Duration</span><span>{selected.duration}</span></div>
							<div className="mt-2"><AdminProgressBar value={selected.progress} /></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Timeline</h3>
							<div className="admin-list">
								{(selected.timeline || []).map((item) => (
									<div key={`${item.text}-${item.time}`} className="admin-list__item">
										<span>{item.text}</span>
										<span>{item.time}</span>
									</div>
								))}
							</div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Execution Logs</h3>
							<div className="admin-queue-logs">
								{(selected.logs || []).map((line) => (
									<code key={line}>{line}</code>
								))}
							</div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Inputs</h3>
							<pre className="admin-queue-json">{JSON.stringify(selected.inputs || {}, null, 2)}</pre>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Outputs</h3>
							<pre className="admin-queue-json">{JSON.stringify(selected.outputs || {}, null, 2)}</pre>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Runtime</h3>
							<div className="admin-meta-row"><span>Provider Used</span><span>{selected.provider}</span></div>
							<div className="admin-meta-row"><span>Model Used</span><span>{selected.model}</span></div>
							<div className="admin-meta-row"><span>Credits Consumed</span><span>{selected.credits}</span></div>
							<div className="admin-meta-row"><span>Execution Time</span><span>{selected.duration}</span></div>
							<div className="admin-meta-row"><span>Worker</span><span>{selected.worker}</span></div>
							<div className="admin-meta-row"><span>Retry Count</span><span>{selected.retries}</span></div>
							<div className="admin-meta-row"><span>Failure Reason</span><span>{selected.failureReason}</span></div>
						</section>

						<div className="admin-user-drawer__actions">
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available"><RotateCcw size={13} /> Retry</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available"><Ban size={13} /> Cancel</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available"><Pause size={13} /> Pause</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available"><Play size={13} /> Resume</button>
							<button type="button" className="admin-btn" onClick={() => {}}><ScrollText size={13} /> View Logs</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available"><ListRestart size={13} /> Requeue</button>
							<button type="button" className="admin-btn admin-btn--danger" disabled={!BACKEND_READY} title="Backend not available"><Trash2 size={13} /> Delete Job</button>
						</div>
						<p className="admin-note">Mutation actions stay disabled until Admin Console APIs are implemented.</p>
					</aside>
				</div>
			) : null}
		</div>
	);
}
