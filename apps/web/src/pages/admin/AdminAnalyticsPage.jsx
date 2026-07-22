import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	RefreshCw, Download, Users, Building2, Cpu, Boxes, CreditCard,
	ListOrdered, ScrollText, TrendingUp, Loader2,
} from 'lucide-react';
import { AdminHero, StatusPill, AdminChartCard } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

const RANGES = [
	{ id: 'today', label: 'Today' },
	{ id: '7d', label: 'Last 7 Days' },
	{ id: '30d', label: 'Last 30 Days' },
	{ id: '90d', label: 'Last 90 Days' },
	{ id: 'custom', label: 'Custom Range' },
];

const EMPTY = {
	kpis: {
		today: {},
		'7d': {},
		'30d': {},
		'90d': {},
	},
	charts: {
		userGrowth: [],
		dau: [],
		workspaceGrowth: [],
		articlesPerDay: [],
		imagesPerDay: [],
		creditsUsage: [],
		revenueTrend: [],
		aiRequests: [],
	},
	providers: [],
	topModels: [],
	publishing: { wordpress: 0, pinterest: 0, facebook: 0, scheduled: 0, failed: 0 },
	queue: { running: 0, queued: 0, completed: 0, failed: 0, avgQueueTime: '—' },
	subscriptions: {
		free: 0, starter: 0, pro: 0, business: 0, enterprise: 0,
		monthlyGrowth: '0%', conversionRate: '0%', churnRate: '0%',
	},
	system: [],
	activity: [],
};

function money(value) {
	return `$${Number(value || 0).toLocaleString()}`;
}

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

export default function AdminAnalyticsPage() {
	const { toast } = useToast();
	const [range, setRange] = useState('30d');
	const [data, setData] = useState(EMPTY);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [exporting, setExporting] = useState(false);
	const [refreshedAt, setRefreshedAt] = useState(() => new Date().toLocaleTimeString());

	const load = useCallback(async ({ refresh = false } = {}) => {
		setLoading(true);
		setError('');
		try {
			const params = new URLSearchParams({ range: range === 'custom' ? '30d' : range });
			if (refresh) params.set('refresh', '1');
			const response = await apiServerClient.fetch(`/admin/v1/analytics/overview?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setData({
				...EMPTY,
				...payload,
				charts: { ...EMPTY.charts, ...(payload.charts || {}) },
				publishing: { ...EMPTY.publishing, ...(payload.publishing || {}) },
				queue: { ...EMPTY.queue, ...(payload.queue || {}) },
				subscriptions: { ...EMPTY.subscriptions, ...(payload.subscriptions || {}) },
			});
			setRefreshedAt(new Date().toLocaleTimeString());
		} catch (err) {
			setError(err.message);
			toast({ variant: 'destructive', title: 'Analytics failed', description: err.message });
		} finally {
			setLoading(false);
		}
	}, [range, toast]);

	useEffect(() => {
		load();
	}, [load]);

	const kpis = data.kpis?.[range === 'custom' ? '30d' : range] || data.kpis?.['30d'] || {};

	const kpiCards = useMemo(() => ([
		{ label: 'Total Users', value: Number(kpis.totalUsers || 0).toLocaleString(), icon: Users },
		{ label: 'Active Users', value: Number(kpis.activeUsers || 0).toLocaleString(), icon: Users },
		{ label: 'New Users Today', value: Number(kpis.newUsersToday || 0).toLocaleString(), icon: TrendingUp },
		{ label: 'Total Workspaces', value: Number(kpis.totalWorkspaces || 0).toLocaleString(), icon: Building2 },
		{ label: 'Active Workspaces', value: Number(kpis.activeWorkspaces || 0).toLocaleString(), icon: Building2 },
		{ label: 'Articles Generated', value: Number(kpis.articlesGenerated || 0).toLocaleString() },
		{ label: 'Images Generated', value: Number(kpis.imagesGenerated || 0).toLocaleString() },
		{ label: 'Pinterest Publications', value: Number(kpis.pinterestPublications || 0).toLocaleString() },
		{ label: 'WordPress Publications', value: Number(kpis.wordpressPublications || 0).toLocaleString() },
		{ label: 'Credits Consumed', value: Number(kpis.creditsConsumed || 0).toLocaleString() },
		{ label: 'MRR', value: money(kpis.mrr) },
		{ label: 'ARR', value: money(kpis.arr) },
	]), [kpis]);

	const exportReport = async () => {
		setExporting(true);
		try {
			const params = new URLSearchParams({
				range: range === 'custom' ? '30d' : range,
				format: 'json',
			});
			const response = await apiServerClient.fetch(`/admin/v1/analytics/export?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = `platform-analytics-${range}.json`;
			anchor.click();
			URL.revokeObjectURL(url);
			toast({ title: 'Exported', description: 'Platform analytics downloaded.' });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Export failed', description: err.message });
		} finally {
			setExporting(false);
		}
	};

	const subMax = Math.max(
		data.subscriptions.free,
		data.subscriptions.starter,
		data.subscriptions.pro,
		data.subscriptions.business,
		data.subscriptions.enterprise,
		1,
	);

	return (
		<div className="admin-analytics">
			<AdminHero
				title="Platform Analytics"
				description="Real-time overview of the Chef IA platform from live queue, publishing, credits, and subscription data."
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
						<button type="button" className="admin-btn" onClick={() => load({ refresh: true })} disabled={loading}>
							{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
						</button>
						<button type="button" className="admin-btn admin-btn--primary" onClick={exportReport} disabled={exporting || loading}>
							{exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export Report
						</button>
					</div>
				)}
			/>

			<p className="admin-note mt-0 mb-3">
				Showing {RANGES.find((item) => item.id === range)?.label || 'range'}
				{range === 'custom' ? ' (using 30-day snapshot)' : ''}
				{' '}· refreshed {refreshedAt}
				{data.meta?.cached ? ' · cached' : ' · live'}
			</p>

			{error ? <p className="admin-note" style={{ color: 'var(--admin-danger, #b91c1c)' }}>{error}</p> : null}

			<div className="admin-analytics-kpis">
				{kpiCards.map((card, index) => (
					<div key={card.label} className="admin-stat admin-analytics-kpi" style={{ animationDelay: `${index * 30}ms` }}>
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
						<p className="admin-stat__hint">{loading ? 'Loading' : 'Live'}</p>
					</div>
				))}
			</div>

			<div className="admin-analytics-charts">
				<AdminChartCard title="User Growth" series={data.charts.userGrowth} />
				<AdminChartCard title="Daily Active Users" series={data.charts.dau} />
				<AdminChartCard title="Workspace Growth" series={data.charts.workspaceGrowth} />
				<AdminChartCard title="Articles Generated Per Day" series={data.charts.articlesPerDay} />
				<AdminChartCard title="Images Generated Per Day" series={data.charts.imagesPerDay} />
				<AdminChartCard title="Credits Usage" series={data.charts.creditsUsage} />
				<AdminChartCard title="Revenue Trend" series={data.charts.revenueTrend} />
				<AdminChartCard title="AI Requests" series={data.charts.aiRequests} />
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
							{data.providers.length === 0 ? (
								<tr><td colSpan={7} style={{ color: 'var(--admin-muted)' }}>{loading ? 'Loading…' : 'No provider usage yet.'}</td></tr>
							) : data.providers.map((row) => (
								<tr key={row.name}>
									<td className="font-medium">{row.name}</td>
									<td>{Number(row.requests || 0).toLocaleString()}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{row.latency}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{row.errorRate}</td>
									<td>{Number(row.credits || 0).toLocaleString()}</td>
									<td>{row.successRate}</td>
									<td>{Number(row.today || 0).toLocaleString()}</td>
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
							{data.topModels.length === 0 ? (
								<tr><td colSpan={6} style={{ color: 'var(--admin-muted)' }}>{loading ? 'Loading…' : 'No model usage yet.'}</td></tr>
							) : data.topModels.map((row) => (
								<tr key={row.model}>
									<td className="font-medium">{row.model}</td>
									<td>{row.provider}</td>
									<td>{Number(row.requests || 0).toLocaleString()}</td>
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
							{ label: 'WordPress Publications', value: data.publishing.wordpress },
							{ label: 'Pinterest Publications', value: data.publishing.pinterest },
							{ label: 'Facebook Publications', value: data.publishing.facebook },
							{ label: 'Scheduled Posts', value: data.publishing.scheduled },
							{ label: 'Failed Publications', value: data.publishing.failed },
						].map((card) => (
							<div key={card.label} className="admin-stat">
								<p className="admin-stat__label">{card.label}</p>
								<p className="admin-stat__value">{Number(card.value || 0).toLocaleString()}</p>
							</div>
						))}
					</div>
				</section>

				<section className="admin-card">
					<h3>Queue Overview</h3>
					<div className="admin-analytics-mini">
						{[
							{ label: 'Running Jobs', value: data.queue.running },
							{ label: 'Queued Jobs', value: data.queue.queued },
							{ label: 'Completed Jobs', value: data.queue.completed },
							{ label: 'Failed Jobs', value: data.queue.failed },
							{ label: 'Average Queue Time', value: data.queue.avgQueueTime },
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
							{ label: 'Free', value: data.subscriptions.free },
							{ label: 'Starter', value: data.subscriptions.starter },
							{ label: 'Pro', value: data.subscriptions.pro },
							{ label: 'Business', value: data.subscriptions.business },
							{ label: 'Enterprise', value: data.subscriptions.enterprise },
						].map((row) => (
							<div key={row.label} className="admin-bar-row">
								<span>{row.label}</span>
								<div className="admin-bar-track">
									<div className="admin-bar-fill" style={{ width: `${(row.value / subMax) * 100}%` }} />
								</div>
								<span>{row.value}</span>
							</div>
						))}
					</div>
					<div className="admin-analytics-mini mt-3">
						<div className="admin-stat">
							<p className="admin-stat__label">Monthly Growth</p>
							<p className="admin-stat__value">{data.subscriptions.monthlyGrowth}</p>
						</div>
						<div className="admin-stat">
							<p className="admin-stat__label">Conversion Rate</p>
							<p className="admin-stat__value">{data.subscriptions.conversionRate}</p>
						</div>
						<div className="admin-stat">
							<p className="admin-stat__label">Churn Rate</p>
							<p className="admin-stat__value">{data.subscriptions.churnRate}</p>
						</div>
					</div>
				</section>

				<section className="admin-card">
					<h3>System Overview</h3>
					<div className="admin-health">
						{(data.system || []).length === 0 ? (
							<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{loading ? 'Loading…' : 'No system metrics.'}</p>
						) : data.system.map((item) => (
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
						{(data.activity || []).length === 0 ? (
							<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{loading ? 'Loading…' : 'No recent activity.'}</p>
						) : data.activity.map((item) => (
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
