import { useEffect, useMemo, useState } from 'react';
import {
	RefreshCw, Download, Eye, Copy, Filter, Bookmark, X,
} from 'lucide-react';
import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import { MOCK_AUDIT_LOGS as DATA } from '@/pages/admin/auditLogsMock';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 8;
const BACKEND_READY = false;

const CATEGORIES = [
	'Authentication',
	'Users',
	'Workspaces',
	'AI Requests',
	'Image Generation',
	'WordPress',
	'Pinterest',
	'Publishing',
	'Subscriptions',
	'Payments',
	'Queue Jobs',
	'Providers',
	'API',
	'Security',
	'System',
];

const SEVERITIES = ['Info', 'Success', 'Warning', 'Error', 'Critical'];

function SeverityPill({ severity }) {
	const value = String(severity || '').toLowerCase();
	let tone = '';
	if (value === 'success') tone = 'admin-pill--green';
	else if (value === 'warning') tone = 'admin-pill--amber';
	else if (value === 'error' || value === 'critical') tone = 'admin-pill--red';
	else tone = 'admin-pill--blue';
	return <span className={`admin-pill ${tone}`}>{severity}</span>;
}

export default function AdminLogsPage() {
	const { toast } = useToast();
	const [search, setSearch] = useState('');
	const [dateRange, setDateRange] = useState('');
	const [logType, setLogType] = useState('');
	const [severity, setSeverity] = useState('');
	const [workspace, setWorkspace] = useState('');
	const [user, setUser] = useState('');
	const [service, setService] = useState('');
	const [provider, setProvider] = useState('');
	const [page, setPage] = useState(1);
	const [selectedId, setSelectedId] = useState('');
	const [autoRefresh, setAutoRefresh] = useState(false);
	const [refreshedAt, setRefreshedAt] = useState(() => new Date().toLocaleTimeString());
	const [tick, setTick] = useState(0);
	const [bookmarks, setBookmarks] = useState(() => new Set());

	const workspaceOptions = useMemo(
		() => [...new Set(DATA.events.map((event) => event.workspace).filter((value) => value && value !== '—'))].sort(),
		[],
	);
	const userOptions = useMemo(
		() => [...new Set(DATA.events.map((event) => event.user).filter((value) => value && value !== 'unknown' && value !== 'system'))].sort(),
		[],
	);
	const serviceOptions = useMemo(
		() => [...new Set(DATA.events.map((event) => event.service))].sort(),
		[],
	);
	const providerOptions = useMemo(
		() => [...new Set(DATA.events.map((event) => event.provider).filter((value) => value && value !== '—'))].sort(),
		[],
	);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return DATA.events.filter((event) => {
			if (logType && event.category !== logType) return false;
			if (severity && event.severity !== severity) return false;
			if (workspace && event.workspace !== workspace) return false;
			if (user && event.user !== user) return false;
			if (service && event.service !== service) return false;
			if (provider && event.provider !== provider) return false;
			if (dateRange === 'today' && !String(event.timestamp).startsWith('2026-07-22')) return false;
			if (!q) return true;
			const haystack = [
				event.id,
				event.category,
				event.user,
				event.workspace,
				event.service,
				event.action,
				event.provider,
				event.ip,
				event.correlationId,
			].join(' ').toLowerCase();
			return haystack.includes(q);
		});
	}, [search, dateRange, logType, severity, workspace, user, service, provider, tick]);

	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
	const selected = DATA.events.find((event) => event.id === selectedId) || null;

	useEffect(() => {
		if (page > totalPages) setPage(totalPages);
	}, [page, totalPages]);

	useEffect(() => {
		if (!autoRefresh) return undefined;
		const id = window.setInterval(() => {
			setTick((value) => value + 1);
			setRefreshedAt(new Date().toLocaleTimeString());
		}, 10000);
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

	const copyEvent = async (event) => {
		try {
			await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
			toast({ title: 'Event copied', description: event.id });
		} catch {
			toast({ variant: 'destructive', title: 'Copy failed', description: 'Clipboard access was blocked.' });
		}
	};

	const filterSimilar = (event) => {
		setLogType(event.category);
		setSeverity(event.severity);
		setService(event.service);
		setPage(1);
		toast({ title: 'Similar filter applied', description: `${event.category} · ${event.severity}` });
	};

	const toggleBookmark = (id) => {
		setBookmarks((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<div>
			<AdminHero
				title="Logs & Audit Trail"
				description="Inspect platform events, user actions, security events and system logs. Mock audit stream only."
				action={(
					<div className="admin-analytics-controls">
						<label className="admin-check" style={{ color: 'var(--admin-muted)', marginBottom: '0.35rem' }}>
							<input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
							<span>Auto Refresh</span>
						</label>
						<button type="button" className="admin-btn" onClick={refresh}>
							<RefreshCw size={13} /> Refresh
						</button>
						<button type="button" className="admin-btn admin-btn--primary" disabled={!BACKEND_READY} title="Backend not available">
							<Download size={13} /> Export Logs
						</button>
					</div>
				)}
			/>

			<p className="admin-note mt-0 mb-3">Last refreshed {refreshedAt}{autoRefresh ? ' · auto every 10s (UI pulse)' : ''}</p>

			<div className="admin-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
				{[
					{ label: 'Total Events Today', value: DATA.summary.totalToday },
					{ label: 'Warnings', value: DATA.summary.warnings },
					{ label: 'Errors', value: DATA.summary.errors },
					{ label: 'Critical Events', value: DATA.summary.critical },
					{ label: 'Security Events', value: DATA.summary.security },
					{ label: 'Admin Actions', value: DATA.summary.adminActions },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value.toLocaleString()}</p>
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
						placeholder="Event ID, user, workspace, action…"
					/>
				</label>
				<label>
					<span>Date Range</span>
					<select value={dateRange} onChange={(e) => { setDateRange(e.target.value); setPage(1); }}>
						<option value="">Any time</option>
						<option value="today">Today</option>
					</select>
				</label>
				<label>
					<span>Log Type</span>
					<select value={logType} onChange={(e) => { setLogType(e.target.value); setPage(1); }}>
						<option value="">All categories</option>
						{CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
					</select>
				</label>
				<label>
					<span>Severity</span>
					<select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}>
						<option value="">All severities</option>
						{SEVERITIES.map((item) => <option key={item} value={item}>{item}</option>)}
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
					<span>User</span>
					<select value={user} onChange={(e) => { setUser(e.target.value); setPage(1); }}>
						<option value="">All users</option>
						{userOptions.map((item) => <option key={item} value={item}>{item}</option>)}
					</select>
				</label>
				<label>
					<span>Service</span>
					<select value={service} onChange={(e) => { setService(e.target.value); setPage(1); }}>
						<option value="">All services</option>
						{serviceOptions.map((item) => <option key={item} value={item}>{item}</option>)}
					</select>
				</label>
				<label>
					<span>Provider</span>
					<select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }}>
						<option value="">All providers</option>
						{providerOptions.map((item) => <option key={item} value={item}>{item}</option>)}
					</select>
				</label>
			</div>

			<section className="admin-card">
				<div className="admin-table-wrap">
					<table className="admin-table" style={{ minWidth: '72rem' }}>
						<thead>
							<tr>
								<th>Timestamp</th>
								<th>Event ID</th>
								<th>Category</th>
								<th>Severity</th>
								<th>User</th>
								<th>Workspace</th>
								<th>Service</th>
								<th>Action</th>
								<th>Result</th>
								<th>IP Address</th>
								<th>Duration</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((event) => (
								<tr
									key={event.id}
									className={selectedId === event.id ? 'is-selected' : ''}
									onClick={() => setSelectedId(event.id)}
								>
									<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{event.timestamp}</td>
									<td className="font-medium" style={{ whiteSpace: 'nowrap' }}>{event.id}</td>
									<td>{event.category}</td>
									<td><SeverityPill severity={event.severity} /></td>
									<td>{event.user}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{event.workspace}</td>
									<td>{event.service}</td>
									<td>{event.action}</td>
									<td><StatusPill status={event.result} /></td>
									<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{event.ip}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{event.duration}</td>
									<td onClick={(e) => e.stopPropagation()}>
										<div className="flex flex-wrap gap-1">
											<button type="button" className="admin-btn" onClick={() => setSelectedId(event.id)}>
												<Eye size={12} /> View
											</button>
											<button type="button" className="admin-btn" onClick={() => copyEvent(event)}>
												<Copy size={12} /> Copy
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{filtered.length === 0 ? (
					<p className="admin-note">No events match the current filters.</p>
				) : (
					<div className="mt-3 flex items-center justify-between gap-2">
						<p className="admin-note m-0">{filtered.length} events · page {page} of {totalPages}</p>
						<div className="flex gap-2">
							<button type="button" className="admin-btn" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>Previous</button>
							<button type="button" className="admin-btn" disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>Next</button>
						</div>
					</div>
				)}
			</section>

			<div className="admin-grid admin-grid--2 mt-4">
				<section className="admin-card">
					<h3>Security Events</h3>
					<div className="admin-list">
						{DATA.securityEvents.map((item) => (
							<div key={item.id} className="admin-list__item">
								<span>
									<strong className="block text-sm">{item.title}</strong>
									<span className="text-xs" style={{ color: 'var(--admin-muted)' }}>{item.detail}</span>
								</span>
								<span>{item.time}</span>
							</div>
						))}
					</div>
				</section>

				<section className="admin-card">
					<h3>Admin Activity</h3>
					<div className="admin-analytics-timeline">
						{DATA.adminActivity.map((item) => (
							<div key={item.id} className="admin-analytics-timeline__item">
								<span className="admin-analytics-timeline__dot" aria-hidden="true" />
								<div>
									<p className="font-medium text-sm">{item.text}</p>
									<p className="text-xs" style={{ color: 'var(--admin-muted)' }}>{item.time}</p>
								</div>
							</div>
						))}
					</div>
				</section>
			</div>

			<section className="admin-card mt-4">
				<h3>System Logs</h3>
				<div className="admin-queue-logs">
					{DATA.systemLogs.map((line) => (
						<code key={line}>{line}</code>
					))}
				</div>
			</section>

			{selected ? (
				<div className="admin-drawer-overlay" role="dialog" aria-modal="true" aria-label="Event details" onClick={() => setSelectedId('')}>
					<aside className="admin-user-drawer admin-user-drawer--wide" onClick={(event) => event.stopPropagation()}>
						<div className="admin-user-drawer__head">
							<div>
								<p className="font-display text-xl font-semibold leading-tight">{selected.id}</p>
								<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.action}</p>
								<div className="mt-2 flex flex-wrap gap-2">
									<SeverityPill severity={selected.severity} />
									<span className="admin-pill">{selected.category}</span>
								</div>
							</div>
							<button type="button" className="admin-icon-btn" onClick={() => setSelectedId('')} aria-label="Close">
								<X size={16} />
							</button>
						</div>

						<section className="admin-user-drawer__section">
							<h3>Full Event</h3>
							<div className="admin-meta-row"><span>Timestamp</span><span>{selected.timestamp}</span></div>
							<div className="admin-meta-row"><span>User</span><span>{selected.user}</span></div>
							<div className="admin-meta-row"><span>Workspace</span><span>{selected.workspace}</span></div>
							<div className="admin-meta-row"><span>Service</span><span>{selected.service}</span></div>
							<div className="admin-meta-row"><span>Result</span><StatusPill status={selected.result} /></div>
							<div className="admin-meta-row"><span>IP Address</span><span>{selected.ip}</span></div>
							<div className="admin-meta-row"><span>Correlation ID</span><span>{selected.correlationId}</span></div>
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
							<h3>Request</h3>
							<pre className="admin-queue-json">{JSON.stringify(selected.request || {}, null, 2)}</pre>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Response</h3>
							<pre className="admin-queue-json">{JSON.stringify(selected.response || {}, null, 2)}</pre>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Metadata</h3>
							<pre className="admin-queue-json">{JSON.stringify(selected.metadata || {}, null, 2)}</pre>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Headers</h3>
							<pre className="admin-queue-json">{JSON.stringify(selected.headers || {}, null, 2)}</pre>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Runtime</h3>
							<div className="admin-meta-row"><span>Provider</span><span>{selected.provider}</span></div>
							<div className="admin-meta-row"><span>Model</span><span>{selected.model}</span></div>
							<div className="admin-meta-row"><span>Credits</span><span>{selected.credits}</span></div>
							<div className="admin-meta-row"><span>Execution Time</span><span>{selected.duration}</span></div>
						</section>

						<div className="admin-user-drawer__actions">
							<button type="button" className="admin-btn" onClick={() => {}}>
								<Eye size={13} /> View Details
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<Download size={13} /> Export
							</button>
							<button type="button" className="admin-btn" onClick={() => copyEvent(selected)}>
								<Copy size={13} /> Copy Event
							</button>
							<button type="button" className="admin-btn" onClick={() => filterSimilar(selected)}>
								<Filter size={13} /> Filter Similar
							</button>
							<button type="button" className="admin-btn" onClick={() => toggleBookmark(selected.id)}>
								<Bookmark size={13} /> {bookmarks.has(selected.id) ? 'Bookmarked' : 'Bookmark'}
							</button>
						</div>
						<p className="admin-note">Export stays disabled until admin log APIs exist. Bookmark is local UI state only.</p>
					</aside>
				</div>
			) : null}
		</div>
	);
}
