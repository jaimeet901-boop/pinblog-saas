import { useEffect, useState } from 'react';
import {
	RefreshCw, Download, RotateCcw, Activity, ScrollText, LineChart, Eraser,
} from 'lucide-react';
import { AdminHero, StatusPill, AdminChartCard } from '@/components/admin/AdminUi';
import { MOCK_SYSTEM_HEALTH as DATA } from '@/pages/admin/systemHealthMock';

const BACKEND_READY = false;

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

export default function AdminSystemPage() {
	const [autoRefresh, setAutoRefresh] = useState(false);
	const [refreshedAt, setRefreshedAt] = useState(() => new Date().toLocaleTimeString());
	const [tick, setTick] = useState(0);

	useEffect(() => {
		if (!autoRefresh) return undefined;
		const id = window.setInterval(() => {
			setTick((value) => value + 1);
			setRefreshedAt(new Date().toLocaleTimeString());
		}, 10000);
		return () => window.clearInterval(id);
	}, [autoRefresh]);

	const refresh = () => {
		setTick((value) => value + 1);
		setRefreshedAt(new Date().toLocaleTimeString());
	};

	const overall = overallTone(DATA.overall.status);

	return (
		<div key={tick}>
			<AdminHero
				title="System Health"
				description="Monitor platform infrastructure, connected services, uptime and resource usage."
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
							<Download size={13} /> Export Report
						</button>
					</div>
				)}
			/>

			<section className={`admin-system-banner admin-system-banner--${overall}`}>
				<div>
					<p className="admin-system-banner__label">Overall System Status</p>
					<p className="admin-system-banner__status">
						{DATA.overall.status === 'healthy' ? 'Healthy' : DATA.overall.status === 'warning' ? 'Warning' : 'Critical'}
					</p>
					<p className="admin-system-banner__meta">
						Uptime {DATA.overall.uptime} · Last incident {DATA.overall.lastIncident}
					</p>
					<p className="admin-system-banner__meta">Last health check {DATA.overall.lastCheck} · UI refreshed {refreshedAt}</p>
				</div>
				<span className={`admin-system-pulse admin-system-pulse--${overall}`} aria-hidden="true" />
			</section>

			<div className="admin-stats admin-stats--compact mt-4">
				{[
					{ label: 'System Uptime', value: DATA.summary.systemUptime },
					{ label: 'Services Online', value: DATA.summary.servicesOnline },
					{ label: 'Services Offline', value: DATA.summary.servicesOffline },
					{ label: 'Average Response Time', value: DATA.summary.avgResponseTime },
					{ label: 'CPU Usage', value: DATA.summary.cpuUsage },
					{ label: 'Memory Usage', value: DATA.summary.memoryUsage },
					{ label: 'Disk Usage', value: DATA.summary.diskUsage },
					{ label: 'Network Latency', value: DATA.summary.networkLatency },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
						<p className="admin-stat__hint">Mock</p>
					</div>
				))}
			</div>

			<section className="mt-4">
				<h3 className="admin-system-section-title">Core Services</h3>
				<div className="admin-health">
					{DATA.coreServices.map((item) => (
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
				</div>
			</section>

			<section className="mt-4">
				<h3 className="admin-system-section-title">AI Providers Health</h3>
				<div className="admin-health">
					{DATA.aiProviders.map((item) => (
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
				</div>
			</section>

			<section className="mt-4">
				<h3 className="admin-system-section-title">External Services</h3>
				<div className="admin-health">
					{DATA.external.map((item) => (
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
					<AdminChartCard title="CPU" series={DATA.resources.cpu} note="Mock resource series" />
					<AdminChartCard title="Memory" series={DATA.resources.memory} note="Mock resource series" />
					<AdminChartCard title="Disk" series={DATA.resources.disk} note="Mock resource series" />
					<AdminChartCard title="Bandwidth" series={DATA.resources.bandwidth} note="Mock resource series" />
					<AdminChartCard title="Storage Growth" series={DATA.resources.storageGrowth} note="Mock resource series" />
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
							{DATA.certificates.map((row) => (
								<tr key={row.domain}>
									<td className="font-medium">{row.service}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{row.domain}</td>
									<td>{row.status === 'expiring' ? <span className="admin-pill admin-pill--amber">Expiring</span> : <span className="admin-pill admin-pill--green">Valid</span>}</td>
									<td>{row.expires}</td>
									<td>{row.days}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<div className="admin-grid admin-grid--2 mt-4">
				<section className="admin-card">
					<h3>Incident History</h3>
					<div className="admin-analytics-timeline">
						{DATA.incidents.map((item) => (
							<div key={item.id} className="admin-analytics-timeline__item">
								<span className="admin-analytics-timeline__dot" aria-hidden="true" />
								<div>
									<p className="font-medium text-sm">{item.text}</p>
									<p className="text-xs" style={{ color: 'var(--admin-muted)' }}>{item.type} · {item.time}</p>
								</div>
							</div>
						))}
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
								{DATA.alerts.map((alert) => (
									<tr key={alert.id}>
										<td><StatusPill status={alert.severity === 'critical' ? 'failed' : alert.severity === 'warning' ? 'warn' : 'info'} /></td>
										<td>{alert.service}</td>
										<td>{alert.message}</td>
										<td style={{ color: 'var(--admin-muted)' }}>{alert.started}</td>
										<td><StatusPill status={alert.status === 'open' ? 'warn' : 'ready'} /></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			</div>

			<div className="admin-grid admin-grid--2 mt-4">
				<section className="admin-card">
					<h3>System Logs Preview</h3>
					<div className="admin-queue-logs">
						{DATA.logs.map((line) => (
							<code key={line}>{line}</code>
						))}
					</div>
				</section>

				<section className="admin-card">
					<h3>Prepared Actions</h3>
					<div className="admin-analytics-actions">
						<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
							<RotateCcw size={13} /> Restart Service
						</button>
						<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
							<Activity size={13} /> Run Health Check
						</button>
						<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
							<ScrollText size={13} /> View Logs
						</button>
						<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
							<LineChart size={13} /> Open Metrics
						</button>
						<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
							<Eraser size={13} /> Clear Cache
						</button>
					</div>
					<p className="admin-note">All mutations stay disabled until Admin Console APIs exist.</p>
				</section>
			</div>
		</div>
	);
}
