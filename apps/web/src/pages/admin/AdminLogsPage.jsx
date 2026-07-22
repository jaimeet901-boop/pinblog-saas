import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	RefreshCw, Download, Eye, Copy, Filter, Bookmark, X, Loader2,
} from 'lucide-react';
import { AdminHero, StatusPill, AdminPagination } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 8;

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

const EMPTY = {
	summary: { totalToday: 0, warnings: 0, errors: 0, critical: 0, security: 0, adminActions: 0 },
	events: [],
	securityEvents: [],
	adminActivity: [],
	systemLogs: [],
	filters: { workspaces: [], users: [], services: [], providers: [] },
};

function SeverityPill({ severity }) {
	const value = String(severity || '').toLowerCase();
	let tone = '';
	if (value === 'success') tone = 'admin-pill--green';
	else if (value === 'warning') tone = 'admin-pill--amber';
	else if (value === 'error' || value === 'critical') tone = 'admin-pill--red';
	else tone = 'admin-pill--blue';
	return <span className={`admin-pill ${tone}`}>{severity}</span>;
}

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
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
	const [selected, setSelected] = useState(null);
	const [autoRefresh, setAutoRefresh] = useState(false);
	const [refreshedAt, setRefreshedAt] = useState(() => new Date().toLocaleTimeString());
	const [bookmarks, setBookmarks] = useState(() => new Set());
	const [data, setData] = useState(EMPTY);
	const [loading, setLoading] = useState(true);
	const [exporting, setExporting] = useState(false);
	const [error, setError] = useState('');

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const params = new URLSearchParams({
				page: String(page),
				perPage: String(PAGE_SIZE),
			});
			if (search.trim()) params.set('q', search.trim());
			if (dateRange) params.set('date', dateRange);
			if (logType) params.set('type', logType);
			if (severity) params.set('severity', severity);
			if (workspace) params.set('workspace', workspace);
			if (user) params.set('user', user);
			if (service) params.set('service', service);
			if (provider) params.set('provider', provider);

			const response = await apiServerClient.fetch(`/admin/v1/logs?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setData({
				...EMPTY,
				...payload,
				summary: { ...EMPTY.summary, ...(payload.summary || {}) },
				filters: { ...EMPTY.filters, ...(payload.filters || {}) },
			});
			setRefreshedAt(new Date().toLocaleTimeString());
		} catch (err) {
			setError(err.message);
			toast({ variant: 'destructive', title: 'Logs failed', description: err.message });
		} finally {
			setLoading(false);
		}
	}, [page, search, dateRange, logType, severity, workspace, user, service, provider, toast]);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(() => {
		if (!selectedId) {
			setSelected(null);
			return;
		}
		const local = data.events.find((event) => event.id === selectedId);
		if (local) {
			setSelected(local);
			return;
		}
		apiServerClient.fetch(`/admin/v1/logs/${selectedId}`)
			.then(async (response) => {
				if (!response.ok) throw new Error(await readApiError(response));
				setSelected(await response.json());
			})
			.catch((err) => {
				toast({ variant: 'destructive', title: 'Event load failed', description: err.message });
			});
	}, [selectedId, data.events, toast]);

	const totalPages = Math.max(1, Number(data.totalPages) || 1);
	const totalItems = Number(data.totalItems) || data.events.length;
	const rows = data.events;

	useEffect(() => {
		if (page > totalPages) setPage(totalPages);
	}, [page, totalPages]);

	useEffect(() => {
		if (!autoRefresh) return undefined;
		let cancelled = false;
		let abort;
		let retryTimer;

		const connect = async () => {
			abort = new AbortController();
			try {
				const response = await apiServerClient.fetch('/admin/v1/logs/stream', {
					signal: abort.signal,
					headers: { Accept: 'text/event-stream' },
				});
				if (!response.ok || !response.body) throw new Error('SSE unavailable');
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';
				while (!cancelled) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const chunks = buffer.split('\n\n');
					buffer = chunks.pop() || '';
					for (const chunk of chunks) {
						if (chunk.includes('event: logs')) {
							load();
							break;
						}
					}
				}
			} catch {
				if (!cancelled) {
					retryTimer = window.setTimeout(connect, 10000);
				}
			}
		};

		connect();
		return () => {
			cancelled = true;
			abort?.abort();
			if (retryTimer) window.clearTimeout(retryTimer);
		};
	}, [autoRefresh, load]);

	useEffect(() => {
		if (!selected) return undefined;
		const onKeyDown = (event) => {
			if (event.key === 'Escape') setSelectedId('');
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [selected]);

	const workspaceOptions = useMemo(
		() => data.filters.workspaces || [],
		[data.filters.workspaces],
	);
	const userOptions = useMemo(
		() => data.filters.users || [],
		[data.filters.users],
	);
	const serviceOptions = useMemo(
		() => data.filters.services || [],
		[data.filters.services],
	);
	const providerOptions = useMemo(
		() => data.filters.providers || [],
		[data.filters.providers],
	);

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

	const exportLogs = async () => {
		setExporting(true);
		try {
			const params = new URLSearchParams({ format: 'json' });
			if (search.trim()) params.set('q', search.trim());
			if (dateRange) params.set('date', dateRange);
			if (logType) params.set('type', logType);
			if (severity) params.set('severity', severity);
			if (workspace) params.set('workspace', workspace);
			if (user) params.set('user', user);
			if (service) params.set('service', service);
			if (provider) params.set('provider', provider);
			const response = await apiServerClient.fetch(`/admin/v1/logs/export?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = 'audit-logs.json';
			anchor.click();
			URL.revokeObjectURL(url);
			toast({ title: 'Exported', description: 'Audit logs downloaded.' });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Export failed', description: err.message });
		} finally {
			setExporting(false);
		}
	};

	return (
		<div>
			<AdminHero
				title="Logs & Audit Trail"
				description="Inspect platform events, user actions, security events and system logs from the live audit platform."
				action={(
					<div className="admin-analytics-controls">
						<label className="admin-check" style={{ color: 'var(--admin-muted)', marginBottom: '0.35rem' }}>
							<input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
							<span>Auto Refresh</span>
						</label>
						<button type="button" className="admin-btn" onClick={() => load()} disabled={loading}>
							{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
						</button>
						<button type="button" className="admin-btn admin-btn--primary" onClick={exportLogs} disabled={exporting || loading}>
							{exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export Logs
						</button>
					</div>
				)}
			/>

			<p className="admin-note mt-0 mb-3">
				Last refreshed {refreshedAt}
				{autoRefresh ? ' · auto every 10s' : ''}
			</p>
			{error ? <p className="admin-note" style={{ color: 'var(--admin-danger, #b91c1c)' }}>{error}</p> : null}

			<div className="admin-stats admin-stats--compact">
				{[
					{ label: 'Total Events Today', value: data.summary.totalToday },
					{ label: 'Warnings', value: data.summary.warnings },
					{ label: 'Errors', value: data.summary.errors },
					{ label: 'Critical Events', value: data.summary.critical },
					{ label: 'Security Events', value: data.summary.security },
					{ label: 'Admin Actions', value: data.summary.adminActions },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{Number(card.value || 0).toLocaleString()}</p>
						<p className="admin-stat__hint">{loading ? 'Loading' : 'Live'}</p>
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
							{rows.length === 0 ? (
								<tr>
									<td colSpan={12} style={{ textAlign: 'center', color: 'var(--admin-muted)' }}>
										{loading ? 'Loading audit events…' : 'No events match the current filters.'}
									</td>
								</tr>
							) : rows.map((event) => (
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
				<AdminPagination
					total={totalItems}
					page={page}
					totalPages={totalPages}
					noun="events"
					onPrev={() => setPage((prev) => prev - 1)}
					onNext={() => setPage((prev) => prev + 1)}
				/>
			</section>

			<div className="admin-grid admin-grid--2 mt-4">
				<section className="admin-card">
					<h3>Security Events</h3>
					<div className="admin-list">
						{(data.securityEvents || []).length === 0 ? (
							<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{loading ? 'Loading…' : 'No security events yet.'}</p>
						) : data.securityEvents.map((item) => (
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
						{(data.adminActivity || []).length === 0 ? (
							<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{loading ? 'Loading…' : 'No admin activity yet.'}</p>
						) : data.adminActivity.map((item) => (
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
					{(data.systemLogs || []).length === 0 ? (
						<code>{loading ? 'Loading system logs…' : 'No system log lines yet.'}</code>
					) : data.systemLogs.map((line) => (
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
							<button type="button" className="admin-btn" onClick={() => load()}>
								<Eye size={13} /> View Details
							</button>
							<button type="button" className="admin-btn" onClick={exportLogs} disabled={exporting}>
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
						<p className="admin-note">Bookmark is local UI state only. Secrets are redacted server-side.</p>
					</aside>
				</div>
			) : null}
		</div>
	);
}
