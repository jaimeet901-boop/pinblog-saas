import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, RefreshCw, ShieldAlert } from 'lucide-react';
import { AdminEmptyState, AdminErrorState, AdminHero, AdminSkeleton, StatusPill } from '@/components/admin/AdminUi';
import { apiServerClient } from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

async function readApiError(response) {
	const payload = await response.json().catch(() => ({}));
	return payload?.error || payload?.message || `Request failed (${response.status})`;
}

function formatWhen(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return date.toLocaleString();
}

function scoreTone(score) {
	if (score >= 90) return 'healthy';
	if (score >= 60) return 'warning';
	if (score >= 30) return 'critical';
	return 'offline';
}

export default function AdminBillingMonitoringPage() {
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [status, setStatus] = useState(null);
	const [health, setHealth] = useState(null);
	const [metrics, setMetrics] = useState(null);
	const [alerts, setAlerts] = useState([]);
	const [failoverTimeline, setFailoverTimeline] = useState([]);
	const [recoveryTimeline, setRecoveryTimeline] = useState([]);
	const [trends, setTrends] = useState([]);
	const [diagnostics, setDiagnostics] = useState(null);
	const [audit, setAudit] = useState([]);
	const [canManage, setCanManage] = useState(true);
	const [busy, setBusy] = useState('');
	const [tab, setTab] = useState('overview');

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const [statusRes, healthRes, metricsRes, alertsRes, foRes, recRes, trendsRes, diagRes, auditRes] = await Promise.all([
				apiServerClient.fetch('/admin/v1/billing/control-plane/monitoring/status'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/monitoring/health'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/monitoring/metrics'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/monitoring/alerts'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/monitoring/timeline/failover'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/monitoring/timeline/recovery'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/monitoring/trends'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/monitoring/diagnostics'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/monitoring/audit?perPage=15'),
			]);
			if (!statusRes.ok) throw new Error(await readApiError(statusRes));
			const statusPayload = await statusRes.json();
			setStatus(statusPayload);
			setCanManage(statusPayload.permissions?.['admin.billing.manage'] !== false);

			if (healthRes.ok) setHealth(await healthRes.json());
			if (metricsRes.ok) setMetrics(await metricsRes.json());
			if (alertsRes.ok) {
				const payload = await alertsRes.json();
				setAlerts(payload.items || []);
			}
			if (foRes.ok) {
				const payload = await foRes.json();
				setFailoverTimeline(payload.items || []);
			}
			if (recRes.ok) {
				const payload = await recRes.json();
				setRecoveryTimeline(payload.items || []);
			}
			if (trendsRes.ok) {
				const payload = await trendsRes.json();
				setTrends(payload.items || []);
			}
			if (diagRes.ok) setDiagnostics(await diagRes.json());
			if (auditRes.ok) {
				const payload = await auditRes.json();
				setAudit(payload.items || []);
			}
		} catch (err) {
			setError(err?.message || 'Unable to load monitoring');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
		const timer = setInterval(load, (status?.pollHintSeconds || 30) * 1000);
		return () => clearInterval(timer);
	}, [load, status?.pollHintSeconds]);

	const alertAction = async (id, action) => {
		if (!canManage) return;
		setBusy(`${action}-${id}`);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/billing/control-plane/monitoring/alerts/${encodeURIComponent(id)}/${action}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(action === 'mute' ? { minutes: 60 } : {}),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: action === 'ack' ? 'Alert acknowledged' : 'Alert muted' });
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Alert action failed', description: err?.message });
		} finally {
			setBusy('');
		}
	};

	if (loading && !status) {
		return (
			<div>
				<AdminHero title="Billing Monitoring" description="Control Plane observability." />
				<AdminSkeleton rows={8} />
			</div>
		);
	}

	if (error && !status) {
		return (
			<div>
				<AdminHero title="Billing Monitoring" description="Control Plane observability." />
				<AdminErrorState message={error} onRetry={load} />
			</div>
		);
	}

	const score = Number(status?.healthScore) || 0;

	return (
		<div>
			<AdminHero
				title="Billing Monitoring"
				description="Observation only. Does not change checkout, subscriptions, or provider runtime."
				action={(
					<div className="flex flex-wrap gap-2">
						<Link to="/admin/billing/events" className="admin-btn">Payment Events</Link>
						<Link to="/admin/billing/failover" className="admin-btn">Failover</Link>
						<Link to="/admin/billing/health" className="admin-btn">Provider Health</Link>
						<button type="button" className="admin-btn admin-btn--primary" onClick={load}>
							<RefreshCw size={16} /> Refresh
						</button>
					</div>
				)}
			/>

			<section className="admin-card mb-4">
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<div>
						<p className="admin-stat__label">System health score</p>
						<p className="admin-stat__value">{score}</p>
						<StatusPill status={scoreTone(score)} />
					</div>
					<div>
						<p className="admin-stat__label">Overall status</p>
						<StatusPill status={status?.overallStatus || 'unknown'} />
					</div>
					<div>
						<p className="admin-stat__label">Active provider</p>
						<p className="admin-stat__value">{status?.activeProvider || 'none'}</p>
					</div>
					<div>
						<p className="admin-stat__label">Open alerts</p>
						<p className="admin-stat__value">{status?.openAlerts ?? 0}</p>
						{status?.snapshotUsed ? <p className="admin-note mt-1">Snapshot optimization used</p> : null}
					</div>
				</div>
			</section>

			<div className="flex flex-wrap gap-2 mb-4">
				{['overview', 'timelines', 'alerts', 'metrics', 'audit', 'diagnostics'].map((key) => (
					<button
						key={key}
						type="button"
						className={`admin-btn ${tab === key ? 'admin-btn--primary' : ''}`}
						onClick={() => setTab(key)}
					>
						{key}
					</button>
				))}
			</div>

			{tab === 'overview' ? (
				<section className="admin-card mb-4">
					<h2 className="admin-section-title">Provider Health Rollup</h2>
					<div className="grid gap-3 sm:grid-cols-5 mb-4">
						{Object.entries(status?.healthRollup || {}).map(([key, value]) => (
							<div key={key}>
								<p className="admin-stat__label">{key}</p>
								<p className="admin-stat__value">{value}</p>
							</div>
						))}
					</div>
					<div className="overflow-x-auto">
						<table className="admin-table">
							<thead>
								<tr>
									<th>Provider</th>
									<th>Status</th>
									<th>Score</th>
									<th>Validation</th>
									<th>Last check</th>
								</tr>
							</thead>
							<tbody>
								{(health?.items || []).map((item) => (
									<tr key={item.code}>
										<td>{item.name || item.code}{item.active ? ' ★' : ''}</td>
										<td><StatusPill status={item.status || 'unknown'} /></td>
										<td>{item.healthScore ?? '—'}</td>
										<td>{item.validation?.result || '—'}</td>
										<td>{formatWhen(item.lastHealthCheck)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			) : null}

			{tab === 'timelines' ? (
				<>
					<section className="admin-card mb-4">
						<h2 className="admin-section-title">Failover Timeline</h2>
						{failoverTimeline.length === 0 ? <AdminEmptyState title="No failover events" /> : (
							<table className="admin-table">
								<thead><tr><th>When</th><th>Action</th><th>Reason</th><th>Provider</th></tr></thead>
								<tbody>
									{failoverTimeline.slice(0, 30).map((row) => (
										<tr key={row.id}>
											<td>{formatWhen(row.timestamp)}</td>
											<td>{row.action}</td>
											<td>{row.reasonCode || '—'}</td>
											<td>{row.provider || '—'}</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</section>
					<section className="admin-card mb-4">
						<h2 className="admin-section-title">Recovery Timeline</h2>
						{recoveryTimeline.length === 0 ? <AdminEmptyState title="No recovery events" /> : (
							<table className="admin-table">
								<thead><tr><th>When</th><th>Action</th><th>Reason</th><th>Provider</th></tr></thead>
								<tbody>
									{recoveryTimeline.slice(0, 30).map((row) => (
										<tr key={row.id}>
											<td>{formatWhen(row.timestamp)}</td>
											<td>{row.action}</td>
											<td>{row.reasonCode || '—'}</td>
											<td>{row.provider || '—'}</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</section>
				</>
			) : null}

			{tab === 'alerts' ? (
				<section className="admin-card mb-4">
					<h2 className="admin-section-title flex items-center gap-2"><ShieldAlert size={18} /> Alert Center</h2>
					<p className="admin-note">Severities: INFO · WARNING · CRITICAL only.</p>
					{alerts.length === 0 ? <AdminEmptyState title="No alerts" /> : (
						<table className="admin-table">
							<thead>
								<tr>
									<th>Severity</th>
									<th>Code</th>
									<th>Status</th>
									<th>Message</th>
									<th>Actions</th>
								</tr>
							</thead>
							<tbody>
								{alerts.map((alert) => (
									<tr key={alert.id}>
										<td><StatusPill status={String(alert.severity || '').toLowerCase()} /></td>
										<td>{alert.code}</td>
										<td>{alert.status}</td>
										<td>{alert.message}</td>
										<td>
											{canManage && (alert.status === 'open' || alert.status === 'acknowledged') ? (
												<div className="flex gap-2">
													<button type="button" className="admin-btn" disabled={busy.startsWith('ack')} onClick={() => alertAction(alert.id, 'ack')}>Ack</button>
													<button type="button" className="admin-btn" disabled={busy.startsWith('mute')} onClick={() => alertAction(alert.id, 'mute')}>Mute 1h</button>
												</div>
											) : '—'}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</section>
			) : null}

			{tab === 'metrics' ? (
				<>
					<section className="admin-card mb-4">
						<h2 className="admin-section-title">Metrics</h2>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{Object.entries(metrics?.metrics || {}).map(([key, value]) => (
								<div key={key}>
									<p className="admin-stat__label">{key}</p>
									<p className="admin-stat__value">{value}</p>
								</div>
							))}
						</div>
					</section>
					<section className="admin-card mb-4">
						<h2 className="admin-section-title">Trends</h2>
						{trends.length === 0 ? <AdminEmptyState title="No trend points" /> : (
							<table className="admin-table">
								<thead><tr><th>Day</th><th>Failover</th><th>Recovery</th><th>Health checks</th></tr></thead>
								<tbody>
									{trends.map((row) => (
										<tr key={row.day}>
											<td>{row.day}</td>
											<td>{row.failover}</td>
											<td>{row.recovery}</td>
											<td>{row.healthChecks}</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</section>
				</>
			) : null}

			{tab === 'audit' ? (
				<section className="admin-card mb-4">
					<h2 className="admin-section-title">Audit Explorer</h2>
					<p className="admin-note">
						Full explorer also available on <Link to="/admin/billing/logs">Billing Logs</Link>.
					</p>
					{audit.length === 0 ? <AdminEmptyState title="No audit rows" /> : (
						<table className="admin-table">
							<thead><tr><th>When</th><th>Action</th><th>Provider</th><th>Administrator</th></tr></thead>
							<tbody>
								{audit.map((row) => (
									<tr key={row.id}>
										<td>{formatWhen(row.timestamp)}</td>
										<td>{row.action}</td>
										<td>{row.provider}</td>
										<td>{row.administrator}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</section>
			) : null}

			{tab === 'diagnostics' ? (
				<section className="admin-card mb-4">
					<h2 className="admin-section-title flex items-center gap-2"><Activity size={18} /> Diagnostics</h2>
					{diagnostics ? (
						<ul className="m-0 pl-5 space-y-1">
							<li>Health score: {diagnostics.healthScore}</li>
							<li>Overall: {diagnostics.overallStatus}</li>
							<li>Providers connected: {diagnostics.providersConfigured}/{diagnostics.providersTotal}</li>
							<li>Idempotency records: {diagnostics.idempotencyRecords ?? 'n/a'}</li>
							<li>Last health check: {formatWhen(diagnostics.lastHealthCheckAt)}</li>
							{(diagnostics.notes || []).map((note) => <li key={note}>{note}</li>)}
						</ul>
					) : <AdminEmptyState title="No diagnostics" />}
				</section>
			) : null}
		</div>
	);
}
