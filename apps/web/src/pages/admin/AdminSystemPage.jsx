import { useCallback, useEffect, useState } from 'react';
import {
	RefreshCw, Download, RotateCcw, Activity, ScrollText, LineChart, Eraser, Loader2,
} from 'lucide-react';
import { AdminHero, StatusPill, AdminChartCard } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

const EMPTY = {
	overall: {
		status: 'healthy',
		uptime: '—',
		lastIncident: '—',
		lastCheck: '—',
	},
	summary: {
		systemUptime: '—',
		servicesOnline: 0,
		servicesOffline: 0,
		avgResponseTime: '—',
		cpuUsage: '—',
		memoryUsage: '—',
		diskUsage: '—',
		networkLatency: '—',
	},
	coreServices: [],
	aiProviders: [],
	external: [],
	resources: {
		cpu: [],
		memory: [],
		disk: [],
		bandwidth: [],
		storageGrowth: [],
	},
	certificates: [],
	incidents: [],
	alerts: [],
	logs: [],
};

function overallTone(status) {
	if (status === 'critical') return 'critical';
	if (status === 'warning') return 'warning';
	return 'healthy';
}

function ServiceCard({ item, extraRows }) {
	return (
		<article className="admin-health__card admin-system-service">
			<div className="flex items-start justify-between gap-2">
				<strong>{item.name}</strong>
				<span className={`admin-system-dot admin-system-dot--${overallTone(item.status)}`} aria-hidden="true" />
			</div>
			<div className="mt-2"><StatusPill status={item.status === 'warning' ? 'warn' : item.status === 'critical' ? 'failed' : item.status} /></div>
			{extraRows}
		</article>
	);
}

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

export default function AdminSystemPage() {
	const { toast } = useToast();
	const navigate = useNavigate();
	const [autoRefresh, setAutoRefresh] = useState(false);
	const [refreshedAt, setRefreshedAt] = useState(() => new Date().toLocaleTimeString());
	const [data, setData] = useState(EMPTY);
	const [loading, setLoading] = useState(true);
	const [runningCheck, setRunningCheck] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [error, setError] = useState('');

	const load = useCallback(async ({ refresh = false } = {}) => {
		setLoading(true);
		setError('');
		try {
			const params = refresh ? '?refresh=1' : '';
			const response = await apiServerClient.fetch(`/admin/v1/system/health${params}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setData({
				...EMPTY,
				...payload,
				summary: { ...EMPTY.summary, ...(payload.summary || {}) },
				overall: { ...EMPTY.overall, ...(payload.overall || {}) },
				resources: { ...EMPTY.resources, ...(payload.resources || {}) },
			});
			setRefreshedAt(new Date().toLocaleTimeString());
		} catch (err) {
			setError(err.message);
			toast({ variant: 'destructive', title: 'System health failed', description: err.message });
		} finally {
			setLoading(false);
		}
	}, [toast]);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(() => {
		if (!autoRefresh) return undefined;
		let cancelled = false;
		let abort;
		let retryTimer;

		const connect = async () => {
			abort = new AbortController();
			try {
				const response = await apiServerClient.fetch('/admin/v1/system/stream', {
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
						if (chunk.includes('event: health')) {
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

	const refresh = () => {
		load({ refresh: true });
	};

	const runHealthCheck = async () => {
		setRunningCheck(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/system/checks/run', { method: 'POST' });
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Health check complete', description: 'Probes finished and snapshot stored.' });
			await load({ refresh: true });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Health check failed', description: err.message });
		} finally {
			setRunningCheck(false);
		}
	};

	const exportReport = async () => {
		setExporting(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/system/export?format=json');
			if (!response.ok) throw new Error(await readApiError(response));
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = 'system-health.json';
			anchor.click();
			URL.revokeObjectURL(url);
			toast({ title: 'Report exported' });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Export failed', description: err.message });
		} finally {
			setExporting(false);
		}
	};

	const clearCache = async () => {
		try {
			const response = await apiServerClient.fetch('/admin/v1/system/actions/clear-cache', { method: 'POST' });
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Cache cleared', description: 'Analytics caches marked for refresh.' });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Clear cache failed', description: err.message });
		}
	};

	const overall = overallTone(data.overall.status);

	return (
		<div>
			<AdminHero
				title="System Health"
				description="Monitor platform infrastructure, connected services, uptime and resource usage."
				action={(
					<div className="admin-analytics-controls">
						<label className="admin-check" style={{ color: 'var(--admin-muted)', marginBottom: '0.35rem' }}>
							<input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
							<span>Auto Refresh</span>
						</label>
						<button type="button" className="admin-btn" onClick={refresh} disabled={loading}>
							{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
						</button>
						<button type="button" className="admin-btn admin-btn--primary" onClick={exportReport} disabled={exporting}>
							{exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export Report
						</button>
					</div>
				)}
			/>

			{error ? (
				<p className="admin-note mt-2" style={{ color: 'var(--admin-danger, #b91c1c)' }}>{error}</p>
			) : null}

			<section className={`admin-system-banner admin-system-banner--${overall}`}>
				<div>
					<p className="admin-system-banner__label">Overall System Status</p>
					<p className="admin-system-banner__status">
						{data.overall.status === 'healthy' ? 'Healthy' : data.overall.status === 'warning' ? 'Warning' : 'Critical'}
					</p>
					<p className="admin-system-banner__meta">
						Uptime {data.overall.uptime} · Last incident {data.overall.lastIncident}
					</p>
					<p className="admin-system-banner__meta">Last health check {data.overall.lastCheck} · UI refreshed {refreshedAt}</p>
				</div>
				<span className={`admin-system-pulse admin-system-pulse--${overall}`} aria-hidden="true" />
			</section>

			<div className="admin-stats admin-stats--compact mt-4">
				{[
					{ label: 'System Uptime', value: data.summary.systemUptime },
					{ label: 'Services Online', value: data.summary.servicesOnline },
					{ label: 'Services Offline', value: data.summary.servicesOffline },
					{ label: 'Average Response Time', value: data.summary.avgResponseTime },
					{ label: 'CPU Usage', value: data.summary.cpuUsage },
					{ label: 'Memory Usage', value: data.summary.memoryUsage },
					{ label: 'Disk Usage', value: data.summary.diskUsage },
					{ label: 'Network Latency', value: data.summary.networkLatency },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
						<p className="admin-stat__hint">Live</p>
					</div>
				))}
			</div>

			<section className="mt-4">
				<h3 className="admin-system-section-title">Core Services</h3>
				<div className="admin-health">
					{(data.coreServices.length ? data.coreServices : []).map((item) => (
						<ServiceCard
							key={item.name}
							item={item}
							extraRows={(
								<div className="admin-system-service__meta">
									<div>Response · {item.responseTime}</div>
									<div>Checked · {item.lastChecked}</div>
									<div>Uptime · {item.uptime}</div>
									<div>Version · {item.version}</div>
								</div>
							)}
						/>
					))}
					{!data.coreServices.length && !loading ? (
						<p className="admin-note">No core service probes yet. Run a health check.</p>
					) : null}
				</div>
			</section>

			<section className="mt-4">
				<h3 className="admin-system-section-title">AI Providers Health</h3>
				<div className="admin-health">
					{data.aiProviders.map((item) => (
						<ServiceCard
							key={item.name}
							item={item}
							extraRows={(
								<div className="admin-system-service__meta">
									<div>Avg response · {item.avgResponse}</div>
									<div>Last success · {item.lastSuccess}</div>
									<div>Error rate · {item.errorRate}</div>
									<div>Quota · {item.quota}</div>
								</div>
							)}
						/>
					))}
					{!data.aiProviders.length && !loading ? (
						<p className="admin-note">No AI providers registered.</p>
					) : null}
				</div>
			</section>

			<section className="mt-4">
				<h3 className="admin-system-section-title">External Services</h3>
				<div className="admin-health">
					{data.external.map((item) => (
						<article key={item.name} className="admin-health__card">
							<div className="flex items-start justify-between gap-2">
								<strong>{item.name}</strong>
								<span className={`admin-system-dot admin-system-dot--${overallTone(item.status)}`} aria-hidden="true" />
							</div>
							<div className="mt-2"><StatusPill status={item.status} /></div>
							<p>{item.detail}</p>
						</article>
					))}
				</div>
			</section>

			<section className="mt-4">
				<h3 className="admin-system-section-title">Resource Usage</h3>
				<div className="admin-analytics-charts">
					<AdminChartCard title="CPU" series={data.resources.cpu} note="Live resource series" />
					<AdminChartCard title="Memory" series={data.resources.memory} note="Live resource series" />
					<AdminChartCard title="Disk" series={data.resources.disk} note="Live resource series" />
					<AdminChartCard title="Bandwidth" series={data.resources.bandwidth} note="Live resource series" />
					<AdminChartCard title="Storage Growth" series={data.resources.storageGrowth} note="Live resource series" />
				</div>
			</section>

			<section className="admin-card mt-4">
				<h3>SSL Certificates</h3>
				<div className="admin-table-wrap">
					<table className="admin-table" style={{ minWidth: '42rem' }}>
						<thead>
							<tr>
								<th>Service</th>
								<th>Domain</th>
								<th>Status</th>
								<th>Expiration Date</th>
								<th>Days Remaining</th>
							</tr>
						</thead>
						<tbody>
							{data.certificates.map((row) => (
								<tr key={row.domain}>
									<td className="font-medium">{row.service}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{row.domain}</td>
									<td>{row.status === 'expiring' ? <span className="admin-pill admin-pill--amber">Expiring</span> : <span className="admin-pill admin-pill--green">Valid</span>}</td>
									<td>{row.expires}</td>
									<td>{row.days}</td>
								</tr>
							))}
							{!data.certificates.length ? (
								<tr>
									<td colSpan={5} style={{ color: 'var(--admin-muted)' }}>No certificate domains configured.</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
			</section>

			<div className="admin-grid admin-grid--2 mt-4">
				<section className="admin-card">
					<h3>Incident History</h3>
					<div className="admin-analytics-timeline">
						{data.incidents.map((item) => (
							<div key={item.id} className="admin-analytics-timeline__item">
								<span className="admin-analytics-timeline__dot" aria-hidden="true" />
								<div>
									<p className="font-medium text-sm">{item.text}</p>
									<p className="text-xs" style={{ color: 'var(--admin-muted)' }}>{item.type} · {item.time}</p>
								</div>
							</div>
						))}
						{!data.incidents.length ? (
							<p className="admin-note">No incidents recorded.</p>
						) : null}
					</div>
				</section>

				<section className="admin-card">
					<h3>Active Alerts</h3>
					<div className="admin-table-wrap">
						<table className="admin-table" style={{ minWidth: '28rem' }}>
							<thead>
								<tr>
									<th>Severity</th>
									<th>Service</th>
									<th>Message</th>
									<th>Started</th>
									<th>Status</th>
								</tr>
							</thead>
							<tbody>
								{data.alerts.map((alert) => (
									<tr key={alert.id}>
										<td><StatusPill status={alert.severity === 'critical' ? 'failed' : alert.severity === 'warning' ? 'warn' : 'info'} /></td>
										<td>{alert.service}</td>
										<td>{alert.message}</td>
										<td style={{ color: 'var(--admin-muted)' }}>{alert.started}</td>
										<td><StatusPill status={alert.status === 'open' ? 'warn' : 'ready'} /></td>
									</tr>
								))}
								{!data.alerts.length ? (
									<tr>
										<td colSpan={5} style={{ color: 'var(--admin-muted)' }}>No active alerts.</td>
									</tr>
								) : null}
							</tbody>
						</table>
					</div>
				</section>
			</div>

			<div className="admin-grid admin-grid--2 mt-4">
				<section className="admin-card">
					<h3>System Logs Preview</h3>
					<div className="admin-queue-logs">
						{data.logs.map((line) => (
							<code key={line}>{line}</code>
						))}
						{!data.logs.length ? (
							<code>No recent system logs.</code>
						) : null}
					</div>
				</section>

				<section className="admin-card">
					<h3>Prepared Actions</h3>
					<div className="admin-analytics-actions">
						<button
							type="button"
							className="admin-btn"
							disabled
							title="Host-level restarts are not available from the Admin API"
						>
							<RotateCcw size={13} /> Restart Service
						</button>
						<button type="button" className="admin-btn" onClick={runHealthCheck} disabled={runningCheck}>
							{runningCheck ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />} Run Health Check
						</button>
						<button type="button" className="admin-btn" onClick={() => navigate('/admin/logs')}>
							<ScrollText size={13} /> View Logs
						</button>
						<button type="button" className="admin-btn" onClick={() => navigate('/admin/queue')}>
							<LineChart size={13} /> Open Metrics
						</button>
						<button type="button" className="admin-btn" onClick={clearCache}>
							<Eraser size={13} /> Clear Cache
						</button>
					</div>
					<p className="admin-note">Health probes, exports, logs and cache refresh are live. Process restarts stay host-managed.</p>
				</section>
			</div>
		</div>
	);
}
