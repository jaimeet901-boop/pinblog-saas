import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	RefreshCw, Download, Users, Building2, Cpu, Boxes, CreditCard,
	ListOrdered, ScrollText, TrendingUp,
} from 'lucide-react';
import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import { MOCK_PLATFORM_ANALYTICS as DATA } from '@/pages/admin/platformAnalyticsMock';

const RANGES = [
	{ id: 'today', label: 'Today' },
	{ id: '7d', label: 'Last 7 Days' },
	{ id: '30d', label: 'Last 30 Days' },
	{ id: '90d', label: 'Last 90 Days' },
	{ id: 'custom', label: 'Custom Range' },
];

function ChartCard({ title, series }) {
	const max = Math.max(...series.map((row) => row.value), 1);
	return (
		<section className="admin-card admin-analytics-chart">
			<h3>{title}</h3>
			<div className="admin-analytics-chart__bars" aria-hidden="true">
				{series.map((row) => (
					<div key={row.label} className="admin-analytics-chart__col">
						<div className="admin-analytics-chart__track">
							<div
								className="admin-analytics-chart__fill"
								style={{ height: `${Math.max(8, (row.value / max) * 100)}%` }}
							/>
						</div>
						<span>{row.label}</span>
					</div>
				))}
			</div>
			<p className="admin-note">Mock series · no live telemetry</p>
		</section>
	);
}

function money(value) {
	return `$${Number(value || 0).toLocaleString()}`;
}

export default function AdminAnalyticsPage() {
	const [range, setRange] = useState('30d');
	const [refreshedAt, setRefreshedAt] = useState(() => new Date().toLocaleTimeString());

	const kpis = DATA.kpis[range === 'custom' ? '30d' : range] || DATA.kpis['30d'];

	const kpiCards = useMemo(() => ([
		{ label: 'Total Users', value: kpis.totalUsers.toLocaleString(), icon: Users },
		{ label: 'Active Users', value: kpis.activeUsers.toLocaleString(), icon: Users },
		{ label: 'New Users Today', value: kpis.newUsersToday.toLocaleString(), icon: TrendingUp },
		{ label: 'Total Workspaces', value: kpis.totalWorkspaces.toLocaleString(), icon: Building2 },
		{ label: 'Active Workspaces', value: kpis.activeWorkspaces.toLocaleString(), icon: Building2 },
		{ label: 'Articles Generated', value: kpis.articlesGenerated.toLocaleString() },
		{ label: 'Images Generated', value: kpis.imagesGenerated.toLocaleString() },
		{ label: 'Pinterest Publications', value: kpis.pinterestPublications.toLocaleString() },
		{ label: 'WordPress Publications', value: kpis.wordpressPublications.toLocaleString() },
		{ label: 'Credits Consumed', value: kpis.creditsConsumed.toLocaleString() },
		{ label: 'MRR', value: money(kpis.mrr) },
		{ label: 'ARR', value: money(kpis.arr) },
	]), [kpis]);

	const refresh = () => {
		setRefreshedAt(new Date().toLocaleTimeString());
	};

	return (
		<div className="admin-analytics">
			<AdminHero
				title="Platform Analytics"
				description="Real-time overview of the Chef IA platform. Executive mock dashboard — no live APIs connected."
				action={(
					<div className="admin-analytics-controls">
						<label>
							<span>Date Range</span>
							<select value={range} onChange={(e) => setRange(e.target.value)}>
								{RANGES.map((item) => (
									<option key={item.id} value={item.id}>{item.label}</option>
								))}
							</select>
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

			<p className="admin-note mt-0 mb-3">
				Showing {RANGES.find((item) => item.id === range)?.label || 'range'}
				{range === 'custom' ? ' (using 30-day mock snapshot)' : ''}
				{' '}· refreshed {refreshedAt}
			</p>

			<div className="admin-analytics-kpis">
				{kpiCards.map((card, index) => (
					<div key={card.label} className="admin-stat admin-analytics-kpi" style={{ animationDelay: `${index * 30}ms` }}>
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
						<p className="admin-stat__hint">Mock KPI</p>
					</div>
				))}
			</div>

			<div className="admin-analytics-charts">
				<ChartCard title="User Growth" series={DATA.charts.userGrowth} />
				<ChartCard title="Daily Active Users" series={DATA.charts.dau} />
				<ChartCard title="Workspace Growth" series={DATA.charts.workspaceGrowth} />
				<ChartCard title="Articles Generated Per Day" series={DATA.charts.articlesPerDay} />
				<ChartCard title="Images Generated Per Day" series={DATA.charts.imagesPerDay} />
				<ChartCard title="Credits Usage" series={DATA.charts.creditsUsage} />
				<ChartCard title="Revenue Trend" series={DATA.charts.revenueTrend} />
				<ChartCard title="AI Requests" series={DATA.charts.aiRequests} />
			</div>

			<section className="admin-card mt-4">
				<h3>AI Providers</h3>
				<div className="admin-table-wrap">
					<table className="admin-table" style={{ minWidth: '58rem' }}>
						<thead>
							<tr>
								<th>Provider</th>
								<th>Total Requests</th>
								<th>Average Latency</th>
								<th>Error Rate</th>
								<th>Credits Used</th>
								<th>Success Rate</th>
								<th>Requests Today</th>
							</tr>
						</thead>
						<tbody>
							{DATA.providers.map((row) => (
								<tr key={row.name}>
									<td className="font-medium">{row.name}</td>
									<td>{row.requests.toLocaleString()}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{row.latency}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{row.errorRate}</td>
									<td>{row.credits.toLocaleString()}</td>
									<td>{row.successRate}</td>
									<td>{row.today.toLocaleString()}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section className="admin-card mt-4">
				<h3>Top Models</h3>
				<div className="admin-table-wrap">
					<table className="admin-table" style={{ minWidth: '48rem' }}>
						<thead>
							<tr>
								<th>Model</th>
								<th>Provider</th>
								<th>Requests</th>
								<th>Average Cost</th>
								<th>Average Response Time</th>
								<th>Success Rate</th>
							</tr>
						</thead>
						<tbody>
							{DATA.topModels.map((row) => (
								<tr key={row.model}>
									<td className="font-medium">{row.model}</td>
									<td>{row.provider}</td>
									<td>{row.requests.toLocaleString()}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{row.avgCost}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{row.responseTime}</td>
									<td>{row.successRate}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<div className="admin-grid admin-grid--2 mt-4">
				<section className="admin-card">
					<h3>Publishing Analytics</h3>
					<div className="admin-analytics-mini">
						{[
							{ label: 'WordPress Publications', value: DATA.publishing.wordpress },
							{ label: 'Pinterest Publications', value: DATA.publishing.pinterest },
							{ label: 'Facebook Publications', value: DATA.publishing.facebook },
							{ label: 'Scheduled Posts', value: DATA.publishing.scheduled },
							{ label: 'Failed Publications', value: DATA.publishing.failed },
						].map((card) => (
							<div key={card.label} className="admin-stat">
								<p className="admin-stat__label">{card.label}</p>
								<p className="admin-stat__value">{card.value.toLocaleString()}</p>
							</div>
						))}
					</div>
				</section>

				<section className="admin-card">
					<h3>Queue Overview</h3>
					<div className="admin-analytics-mini">
						{[
							{ label: 'Running Jobs', value: DATA.queue.running },
							{ label: 'Queued Jobs', value: DATA.queue.queued },
							{ label: 'Completed Jobs', value: DATA.queue.completed },
							{ label: 'Failed Jobs', value: DATA.queue.failed },
							{ label: 'Average Queue Time', value: DATA.queue.avgQueueTime },
						].map((card) => (
							<div key={card.label} className="admin-stat">
								<p className="admin-stat__label">{card.label}</p>
								<p className="admin-stat__value">{typeof card.value === 'number' ? card.value.toLocaleString() : card.value}</p>
							</div>
						))}
					</div>
				</section>
			</div>

			<div className="admin-grid admin-grid--2 mt-4">
				<section className="admin-card">
					<h3>Subscriptions</h3>
					<div className="admin-bars">
						{[
							{ label: 'Free', value: DATA.subscriptions.free, max: 500 },
							{ label: 'Starter', value: DATA.subscriptions.starter, max: 500 },
							{ label: 'Pro', value: DATA.subscriptions.pro, max: 500 },
							{ label: 'Business', value: DATA.subscriptions.business, max: 500 },
							{ label: 'Enterprise', value: DATA.subscriptions.enterprise, max: 500 },
						].map((row) => (
							<div key={row.label} className="admin-bar-row">
								<span>{row.label}</span>
								<div className="admin-bar-track">
									<div className="admin-bar-fill" style={{ width: `${(row.value / row.max) * 100}%` }} />
								</div>
								<span>{row.value}</span>
							</div>
						))}
					</div>
					<div className="admin-analytics-mini mt-3">
						<div className="admin-stat">
							<p className="admin-stat__label">Monthly Growth</p>
							<p className="admin-stat__value">{DATA.subscriptions.monthlyGrowth}</p>
						</div>
						<div className="admin-stat">
							<p className="admin-stat__label">Conversion Rate</p>
							<p className="admin-stat__value">{DATA.subscriptions.conversionRate}</p>
						</div>
						<div className="admin-stat">
							<p className="admin-stat__label">Churn Rate</p>
							<p className="admin-stat__value">{DATA.subscriptions.churnRate}</p>
						</div>
					</div>
				</section>

				<section className="admin-card">
					<h3>System Overview</h3>
					<div className="admin-health">
						{DATA.system.map((item) => (
							<article key={item.name} className="admin-health__card">
								<div className="flex items-start justify-between gap-2">
									<strong>{item.name}</strong>
									<StatusPill status={item.status} />
								</div>
								<p>{item.detail}</p>
							</article>
						))}
					</div>
				</section>
			</div>

			<div className="admin-grid admin-grid--2 mt-4">
				<section className="admin-card">
					<h3>Recent Activity</h3>
					<div className="admin-analytics-timeline">
						{DATA.activity.map((item) => (
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
					<h3>Quick Actions</h3>
					<div className="admin-analytics-actions">
						<Link to="/admin/users" className="admin-btn"><Users size={13} /> Open Users</Link>
						<Link to="/admin/workspaces" className="admin-btn"><Building2 size={13} /> Open Workspaces</Link>
						<Link to="/admin/providers" className="admin-btn"><Cpu size={13} /> Open Providers</Link>
						<Link to="/admin/models" className="admin-btn"><Boxes size={13} /> Open Models</Link>
						<Link to="/admin/plans" className="admin-btn"><CreditCard size={13} /> Open Plans</Link>
						<Link to="/admin/queue" className="admin-btn"><ListOrdered size={13} /> View Queue</Link>
						<Link to="/admin/logs" className="admin-btn"><ScrollText size={13} /> View Logs</Link>
					</div>
					<p className="admin-note">Navigation only — no mutation side effects.</p>
				</section>
			</div>
		</div>
	);
}
