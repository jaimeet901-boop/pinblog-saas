import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	BarChart3, RefreshCw, Download, CalendarClock, CheckCircle2, AlertTriangle,
	Pin, Globe, Sparkles, ExternalLink, LayoutGrid,
} from 'lucide-react';
import {
	ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
	XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Select, Spinner } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import './AnalyticsPage.css';

const CHART_COLORS = ['hsl(12 80% 55%)', 'hsl(38 90% 55%)', 'hsl(142 45% 40%)', 'hsl(210 55% 45%)', 'hsl(280 40% 50%)', 'hsl(0 70% 50%)'];

function downloadBlob(filename, content, type) {
	const blob = new Blob([content], { type });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

function toCsv(rows) {
	const headers = ['id', 'title', 'status', 'board', 'websiteId', 'account', 'publishedAt', 'impressions', 'saves', 'clicks', 'closeups', 'url'];
	const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
	const lines = [headers.join(',')];
	for (const item of rows) {
		lines.push([
			item.id,
			item.pin?.title || '',
			item.status,
			item.boardName || item.boardId || '',
			item.websiteId || '',
			item.accountLabel || item.accountUsername || '',
			item.publishedAt || '',
			item.performance?.impressions ?? '',
			item.performance?.saves ?? '',
			item.performance?.outboundClicks ?? '',
			item.performance?.closeups ?? '',
			item.pinterestPinUrl || '',
		].map(escape).join(','));
	}
	return `${lines.join('\n')}\n`;
}

function startOfRange(range) {
	const now = new Date();
	const start = new Date(now);
	if (range === '7d') start.setDate(now.getDate() - 6);
	else if (range === '30d') start.setDate(now.getDate() - 29);
	else if (range === '90d') start.setDate(now.getDate() - 89);
	else if (range === 'month') {
		start.setDate(1);
	} else {
		return null;
	}
	start.setHours(0, 0, 0, 0);
	return start;
}

function monthKey(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function dayKey(date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function AnalyticsPage() {
	const { toast } = useToast();
	const { user } = useAuth();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [summary, setSummary] = useState({
		published: 0,
		failed: 0,
		scheduled: 0,
		articlesGenerated: 0,
		imagesGenerated: 0,
		aiRequests: 0,
		creditsUsed: 0,
		creditsRemaining: 0,
		wordpressPosts: 0,
		queueJobs: 0,
		avgGenerationTime: '—',
		avgPublishTime: '—',
		failureRate: 0,
	});
	const [items, setItems] = useState([]);
	const [charts, setCharts] = useState({ dailyActivity: [], monthlyActivity: [] });
	const [websiteFilter, setWebsiteFilter] = useState('');
	const [accountFilter, setAccountFilter] = useState('');
	const [boardFilter, setBoardFilter] = useState('');
	const [statusFilter, setStatusFilter] = useState('');
	const [dateRange, setDateRange] = useState('30d');
	const [exportFormat, setExportFormat] = useState('csv');

	const load = async () => {
		setLoading(true);
		setError('');
		try {
			const params = new URLSearchParams({ range: dateRange === 'month' ? '30d' : dateRange === 'all' ? '90d' : dateRange });
			let response = await apiServerClient.fetch(`/workspace/v1/analytics/overview?${params.toString()}`, { method: 'GET' });
			let payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				response = await apiServerClient.fetch('/pinterest/analytics', { method: 'GET' });
				payload = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(payload?.message || `Failed to load analytics (${response.status})`);
				}
			}
			setSummary({
				published: 0,
				failed: 0,
				scheduled: 0,
				articlesGenerated: 0,
				imagesGenerated: 0,
				aiRequests: 0,
				creditsUsed: 0,
				creditsRemaining: 0,
				wordpressPosts: 0,
				queueJobs: 0,
				avgGenerationTime: '—',
				avgPublishTime: '—',
				failureRate: 0,
				...(payload.summary || {}),
			});
			setItems(Array.isArray(payload.items) ? payload.items : []);
			setCharts(payload.charts || { dailyActivity: [], monthlyActivity: [] });
		} catch (err) {
			setError(err.message);
			toast({ variant: 'destructive', title: 'Error', description: err.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, [dateRange]);

	const websiteOptions = useMemo(() => {
		const set = new Set();
		for (const item of items) {
			if (item.websiteId) set.add(item.websiteId);
		}
		return [...set];
	}, [items]);

	const accountOptions = useMemo(() => {
		const map = new Map();
		for (const item of items) {
			const key = item.accountId || item.accountLabel || item.accountUsername;
			if (!key) continue;
			map.set(key, item.accountLabel || item.accountUsername || item.accountId);
		}
		return [...map.entries()];
	}, [items]);

	const boardOptions = useMemo(() => {
		const map = new Map();
		for (const item of items) {
			const key = item.boardId || item.boardName;
			if (!key) continue;
			map.set(key, item.boardName || item.boardId);
		}
		return [...map.entries()];
	}, [items]);

	const filteredItems = useMemo(() => {
		const rangeStart = startOfRange(dateRange);
		return items.filter((item) => {
			if (websiteFilter && item.websiteId !== websiteFilter) return false;
			if (accountFilter) {
				const key = item.accountId || item.accountLabel || item.accountUsername;
				if (key !== accountFilter) return false;
			}
			if (boardFilter) {
				const key = item.boardId || item.boardName;
				if (key !== boardFilter) return false;
			}
			if (statusFilter && item.status !== statusFilter) return false;
			if (rangeStart) {
				const stamp = item.publishedAt || item.scheduledAt || item.updatedAt || item.createdAt;
				if (!stamp || new Date(stamp) < rangeStart) return false;
			}
			return true;
		});
	}, [items, websiteFilter, accountFilter, boardFilter, statusFilter, dateRange]);

	const successRate = useMemo(() => {
		const published = summary.published || 0;
		const failed = summary.failed || 0;
		const total = published + failed;
		if (!total) return null;
		return Math.round((published / total) * 100);
	}, [summary]);

	const avgPublishTime = useMemo(() => {
		const durations = [];
		for (const item of items) {
			if (!item.createdAt || !item.publishedAt) continue;
			const ms = new Date(item.publishedAt) - new Date(item.createdAt);
			if (ms > 0 && ms < 1000 * 60 * 60 * 24 * 30) durations.push(ms);
		}
		if (!durations.length) return '—';
		const avg = durations.reduce((sum, value) => sum + value, 0) / durations.length;
		if (avg < 60_000) return `${Math.round(avg / 1000)}s`;
		if (avg < 3_600_000) return `${Math.round(avg / 60_000)}m`;
		return `${(avg / 3_600_000).toFixed(1)}h`;
	}, [items]);

	const estimatedImpressions = useMemo(() => {
		const values = filteredItems.map((item) => item.performance?.impressions).filter((value) => typeof value === 'number');
		if (!values.length) return null;
		return values.reduce((sum, value) => sum + value, 0);
	}, [filteredItems]);

	const estimatedClicks = useMemo(() => {
		const values = filteredItems.map((item) => item.performance?.outboundClicks).filter((value) => typeof value === 'number');
		if (!values.length) return null;
		return values.reduce((sum, value) => sum + value, 0);
	}, [filteredItems]);

	const uniqueAccounts = useMemo(() => accountOptions.length, [accountOptions]);
	const uniqueWebsites = useMemo(() => websiteOptions.length, [websiteOptions]);

	const publishingTrend = useMemo(() => {
		const map = new Map();
		for (const item of filteredItems) {
			const stamp = item.publishedAt || item.createdAt;
			if (!stamp) continue;
			const key = dayKey(new Date(stamp));
			const row = map.get(key) || { label: key.slice(5), published: 0, failed: 0 };
			if (item.status === 'failed') row.failed += 1;
			else row.published += 1;
			map.set(key, row);
		}
		const rows = [...map.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([, value]) => value);
		return rows.length ? rows.slice(-14) : null;
	}, [filteredItems]);

	const successVsFailed = useMemo(() => ([
		{ name: 'Published', value: summary.published || 0 },
		{ name: 'Failed', value: summary.failed || 0 },
		{ name: 'Scheduled', value: summary.scheduled || 0 },
	]), [summary]);

	const pinsByWebsite = useMemo(() => {
		const map = new Map();
		for (const item of filteredItems) {
			const key = item.websiteId || 'Unassigned';
			map.set(key, (map.get(key) || 0) + 1);
		}
		const rows = [...map.entries()].map(([name, value]) => ({ name, value }));
		return rows.length ? rows : null;
	}, [filteredItems]);

	const pinsByBoard = useMemo(() => {
		const map = new Map();
		for (const item of filteredItems) {
			const key = item.boardName || item.boardId || 'Unknown board';
			map.set(key, (map.get(key) || 0) + 1);
		}
		const rows = [...map.entries()]
			.map(([name, value]) => ({ name, value }))
			.sort((a, b) => b.value - a.value)
			.slice(0, 8);
		return rows.length ? rows : null;
	}, [filteredItems]);

	const monthlyTrend = useMemo(() => {
		const map = new Map();
		for (const item of items) {
			const stamp = item.publishedAt || item.createdAt;
			if (!stamp) continue;
			const key = monthKey(new Date(stamp));
			map.set(key, (map.get(key) || 0) + 1);
		}
		const rows = [...map.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([label, published]) => ({ label, published }));
		return rows.length ? rows.slice(-6) : null;
	}, [items]);

	const websitePerformance = useMemo(() => {
		const map = new Map();
		for (const item of items) {
			const key = item.websiteId || 'Unassigned';
			const row = map.get(key) || { website: key, published: 0, scheduled: 0, failed: 0, lastPublish: null };
			if (item.status === 'failed') row.failed += 1;
			else if (item.status === 'scheduled') row.scheduled += 1;
			else row.published += 1;
			const stamp = item.publishedAt || item.updatedAt;
			if (stamp && (!row.lastPublish || new Date(stamp) > new Date(row.lastPublish))) {
				row.lastPublish = stamp;
			}
			map.set(key, row);
		}
		return [...map.values()].map((row) => {
			const total = row.published + row.failed;
			return {
				...row,
				successRate: total ? `${Math.round((row.published / total) * 100)}%` : '—',
			};
		});
	}, [items]);

	const boardPerformance = useMemo(() => {
		const map = new Map();
		for (const item of items) {
			const key = item.boardId || item.boardName || 'Unknown';
			const row = map.get(key) || {
				board: item.boardName || item.boardId || 'Unknown',
				published: 0,
				failed: 0,
				impressions: 0,
				hasImpressions: false,
				lastPublish: null,
			};
			if (item.status === 'failed') row.failed += 1;
			else row.published += 1;
			if (typeof item.performance?.impressions === 'number') {
				row.impressions += item.performance.impressions;
				row.hasImpressions = true;
			}
			const stamp = item.publishedAt || item.updatedAt;
			if (stamp && (!row.lastPublish || new Date(stamp) > new Date(row.lastPublish))) {
				row.lastPublish = stamp;
			}
			map.set(key, row);
		}
		return [...map.values()]
			.map((row) => {
				const total = row.published + row.failed;
				return {
					...row,
					successRate: total ? `${Math.round((row.published / total) * 100)}%` : '—',
					impressionsLabel: row.hasImpressions ? row.impressions : '—',
				};
			})
			.sort((a, b) => b.published - a.published);
	}, [items]);

	const insights = useMemo(() => {
		const tips = [];
		if ((summary.published || 0) === 0) {
			tips.push({ title: 'Start publishing', body: 'No published pins yet. Publish from AI Pins to unlock live analytics.' });
		} else {
			tips.push({ title: 'Publishing volume', body: `${summary.published} published pins in your analytics feed.` });
		}
		if ((summary.failed || 0) > 0) {
			tips.push({ title: 'Retry failed jobs', body: `${summary.failed} failed pins need attention in Publishing Center.` });
		}
		if ((summary.scheduled || 0) > 0) {
			tips.push({ title: 'Upcoming schedule', body: `${summary.scheduled} pins are scheduled — review them on the Content Calendar.` });
		}
		if (successRate != null) {
			tips.push({ title: 'Success rate', body: `Current publish success rate is ${successRate}%.` });
		}
		if (pinsByBoard?.[0]) {
			tips.push({ title: 'Top board', body: `${pinsByBoard[0].name} leads with ${pinsByBoard[0].value} pins in the current view.` });
		}
		if (estimatedImpressions == null) {
			tips.push({ title: 'Impressions pending', body: 'Estimated impressions appear once Pinterest performance fields sync.' });
		}
		return tips.slice(0, 6);
	}, [summary, successRate, pinsByBoard, estimatedImpressions]);

	const exportCurrent = async () => {
		if (!filteredItems.length && !summary.published) {
			toast({ variant: 'destructive', title: 'Nothing to export', description: 'No rows match the current filters.' });
			return;
		}
		try {
			const params = new URLSearchParams({
				range: dateRange === 'month' ? '30d' : dateRange === 'all' ? '90d' : dateRange,
				format: exportFormat,
			});
			const response = await apiServerClient.fetch(`/workspace/v1/analytics/export?${params.toString()}`);
			if (response.ok) {
				const blob = await response.blob();
				const url = URL.createObjectURL(blob);
				const anchor = document.createElement('a');
				anchor.href = url;
				anchor.download = `workspace-analytics.${exportFormat}`;
				anchor.click();
				URL.revokeObjectURL(url);
			} else if (exportFormat === 'json') {
				downloadBlob('analytics-export.json', JSON.stringify({ summary, items: filteredItems, charts }, null, 2), 'application/json');
			} else {
				downloadBlob('analytics-export.csv', toCsv(filteredItems), 'text/csv;charset=utf-8');
			}
			toast({ title: 'Exported', description: `Analytics downloaded as ${exportFormat.toUpperCase()}.` });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Export failed', description: err.message });
		}
	};

	const trendData = publishingTrend || (charts.dailyActivity || []).map((row) => ({
		label: row.label,
		published: row.value,
		failed: 0,
	}));
	const trendIsPlaceholder = !publishingTrend && !(charts.dailyActivity || []).length;
	const websiteChartData = pinsByWebsite?.length ? pinsByWebsite : [];
	const boardChartData = pinsByBoard?.length ? pinsByBoard : [];
	const monthlyData = monthlyTrend?.length
		? monthlyTrend
		: (charts.monthlyActivity || []).map((row) => ({ label: row.label, published: row.value }));

	const statCards = [
		{ label: 'Articles Generated', value: summary.articlesGenerated ?? 0, hint: null },
		{ label: 'Images Generated', value: summary.imagesGenerated ?? 0, hint: null },
		{ label: 'AI Requests', value: summary.aiRequests ?? 0, hint: null },
		{ label: 'Credits Used', value: summary.creditsUsed ?? 0, hint: null },
		{ label: 'Credits Remaining', value: summary.creditsRemaining ?? 0, hint: null },
		{ label: 'WordPress Posts', value: summary.wordpressPosts ?? 0, hint: null },
		{ label: 'Published Pins', value: summary.published, hint: null },
		{ label: 'Scheduled Pins', value: summary.scheduled, hint: null },
		{ label: 'Failed Pins', value: summary.failed, hint: null },
		{ label: 'Queue Jobs', value: summary.queueJobs ?? 0, hint: null },
		{ label: 'Avg. Generation Time', value: summary.avgGenerationTime || '—', hint: null },
		{ label: 'Avg. Publish Time', value: summary.avgPublishTime || avgPublishTime, hint: null },
		{ label: 'Failure Rate', value: `${summary.failureRate ?? 0}%`, hint: null },
		{ label: 'Success Rate', value: successRate == null ? '—' : `${successRate}%`, hint: null },
		{ label: 'Est. Impressions', value: estimatedImpressions ?? summary.impressions ?? '—', hint: estimatedImpressions == null && !summary.impressions ? 'Pending sync' : null },
		{ label: 'Est. Clicks', value: estimatedClicks ?? summary.clicks ?? '—', hint: estimatedClicks == null && !summary.clicks ? 'Pending sync' : null },
	];

	return (
		<div className="an-atelier">
			<section className="an-hero">
				<p className="an-hero__eyebrow">Chef IA Analytics Center</p>
				<h1 className="an-hero__title">Publishing performance</h1>
				<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
					Track outcomes across pins, boards, and websites — with charts, tables, and exportable reports.
				</p>
				<div className="an-hero__meta">
					<span className="an-pill"><Sparkles size={12} /> {user?.name || 'Chef IA'} workspace</span>
					<span className="an-pill"><Globe size={12} /> {websiteFilter || (websiteOptions[0] || 'All websites')}</span>
					<span className="an-pill"><CalendarClock size={12} /> {dateRange === '7d' ? 'Last 7 days' : dateRange === '30d' ? 'Last 30 days' : dateRange === '90d' ? 'Last 90 days' : dateRange === 'month' ? 'This month' : 'All time'}</span>
				</div>
			</section>

			<div className="an-toolbar">
				<div className="flex flex-wrap items-end gap-2">
					<Button size="sm" variant="outline" onClick={load} disabled={loading}>
						{loading ? <Spinner className="h-4 w-4" /> : <RefreshCw size={14} />}
						Refresh
					</Button>
					<div className="flex items-end gap-2">
						<Select label="Export" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
							<option value="csv">CSV</option>
							<option value="json">JSON</option>
						</Select>
						<Button size="sm" variant="ghost" onClick={exportCurrent} disabled={!filteredItems.length}>
							<Download size={14} /> Export
						</Button>
					</div>
				</div>
				<div className="flex flex-wrap items-end gap-2">
					<Select label="Website" value={websiteFilter} onChange={(e) => setWebsiteFilter(e.target.value)}>
						<option value="">All websites</option>
						{websiteOptions.map((id) => <option key={id} value={id}>{id}</option>)}
					</Select>
					<Select label="Account" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
						<option value="">All accounts</option>
						{accountOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
					</Select>
					<Select label="Board" value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)}>
						<option value="">All boards</option>
						{boardOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
					</Select>
					<Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
						<option value="">All statuses</option>
						<option value="published">Published</option>
						<option value="failed">Failed</option>
						<option value="scheduled">Scheduled</option>
					</Select>
					<Select label="Date range" value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
						<option value="7d">Last 7 days</option>
						<option value="30d">Last 30 days</option>
						<option value="90d">Last 90 days</option>
						<option value="month">This month</option>
						<option value="all">All time</option>
					</Select>
				</div>
			</div>

			{error ? (
				<p className="mb-3 text-sm text-destructive">{error}</p>
			) : null}

			<div className="an-stats">
				{statCards.map((card) => (
					<div key={card.label} className="an-stat">
						<p className="an-stat__label">{card.label}</p>
						{loading ? (
							<div className="mt-3 h-7 w-12 animate-pulse rounded-md bg-secondary" />
						) : (
							<p className="an-stat__value">{card.value ?? 0}</p>
						)}
						{card.hint ? <p className="an-stat__hint">{card.hint}</p> : null}
					</div>
				))}
			</div>

			<div className="an-shell">
				<div className="an-main">
					<section className="an-panel">
						<div className="an-panel__head">
							<div className="an-panel__title">
								<span className="an-panel__icon"><BarChart3 size={14} /></span>
								Charts & Reports
							</div>
							{trendIsPlaceholder ? <Badge tone="amber">No activity yet</Badge> : <Badge tone="green">Live data</Badge>}
						</div>

						{loading ? (
							<div className="an-charts">
								{[0, 1, 2, 3].map((i) => <div key={i} className="an-skeleton" />)}
							</div>
						) : (
							<div className="an-charts">
								<div className="an-chart">
									<h4>Publishing Trend</h4>
									{trendIsPlaceholder ? <p className="an-chart__hint">Charts appear once publishing activity is recorded.</p> : null}
									<div style={{ width: '100%', height: 220 }}>
										<ResponsiveContainer>
											<AreaChart data={trendData}>
												<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
												<XAxis dataKey="label" tick={{ fontSize: 11 }} />
												<YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
												<Tooltip />
												<Area type="monotone" dataKey="published" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.2} />
												<Area type="monotone" dataKey="failed" stroke={CHART_COLORS[5]} fill={CHART_COLORS[5]} fillOpacity={0.15} />
											</AreaChart>
										</ResponsiveContainer>
									</div>
								</div>

								<div className="an-chart">
									<h4>Success vs Failed</h4>
									<div style={{ width: '100%', height: 220 }}>
										<ResponsiveContainer>
											<PieChart>
												<Pie data={successVsFailed} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={3}>
													{successVsFailed.map((entry, index) => (
														<Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
													))}
												</Pie>
												<Tooltip />
												<Legend />
											</PieChart>
										</ResponsiveContainer>
									</div>
								</div>

								<div className="an-chart">
									<h4>Pins by Website</h4>
									{!pinsByWebsite ? <p className="an-chart__hint">Placeholder sample distribution.</p> : null}
									<div style={{ width: '100%', height: 220 }}>
										<ResponsiveContainer>
											<BarChart data={websiteChartData}>
												<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
												<XAxis dataKey="name" tick={{ fontSize: 11 }} />
												<YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
												<Tooltip />
												<Bar dataKey="value" fill={CHART_COLORS[2]} radius={[6, 6, 0, 0]} />
											</BarChart>
										</ResponsiveContainer>
									</div>
								</div>

								<div className="an-chart">
									<h4>Pins by Board</h4>
									{!pinsByBoard ? <p className="an-chart__hint">Placeholder sample distribution.</p> : null}
									<div style={{ width: '100%', height: 220 }}>
										<ResponsiveContainer>
											<BarChart data={boardChartData} layout="vertical" margin={{ left: 24 }}>
												<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
												<XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
												<YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
												<Tooltip />
												<Bar dataKey="value" fill={CHART_COLORS[1]} radius={[0, 6, 6, 0]} />
											</BarChart>
										</ResponsiveContainer>
									</div>
								</div>

								<div className="an-chart">
									<h4>Publishing Activity</h4>
									{!websiteChartData.length && !boardChartData.length ? <p className="an-chart__hint">No website/board breakdown yet.</p> : null}
									<div style={{ width: '100%', height: 220 }}>
										<ResponsiveContainer>
											<BarChart data={trendData}>
												<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
												<XAxis dataKey="label" tick={{ fontSize: 11 }} />
												<YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
												<Tooltip />
												<Legend />
												<Bar dataKey="published" stackId="a" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
												<Bar dataKey="failed" stackId="a" fill={CHART_COLORS[5]} radius={[4, 4, 0, 0]} />
											</BarChart>
										</ResponsiveContainer>
									</div>
								</div>

								<div className="an-chart">
									<h4>Monthly Publishing Trend</h4>
									{!monthlyTrend ? <p className="an-chart__hint">Placeholder monthly sample.</p> : null}
									<div style={{ width: '100%', height: 220 }}>
										<ResponsiveContainer>
											<AreaChart data={monthlyData}>
												<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
												<XAxis dataKey="label" tick={{ fontSize: 11 }} />
												<YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
												<Tooltip />
												<Area type="monotone" dataKey="published" stroke={CHART_COLORS[3]} fill={CHART_COLORS[3]} fillOpacity={0.2} />
											</AreaChart>
										</ResponsiveContainer>
									</div>
								</div>
							</div>
						)}
					</section>

					<section className="an-panel">
						<div className="an-panel__head">
							<div className="an-panel__title">
								<span className="an-panel__icon"><Pin size={14} /></span>
								Recent Published Pins
							</div>
							<span className="text-[11px] text-muted-foreground">{filteredItems.length} shown</span>
						</div>
						{loading ? (
							<div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="an-skeleton" style={{ height: '3rem' }} />)}</div>
						) : filteredItems.length === 0 ? (
							<div className="an-empty">
								<p className="font-semibold">No published pins yet</p>
								<p className="mt-1 text-sm text-muted-foreground">Once pins are published, analytics-ready rows will appear here.</p>
								<Link to="/app/ai-pins" className="mt-4 inline-block"><Button size="sm">Go to AI Pins</Button></Link>
							</div>
						) : (
							<div className="an-table-wrap">
								<table className="an-table">
									<thead>
										<tr>
											<th>Preview</th>
											<th>Title</th>
											<th>Website</th>
											<th>Board</th>
											<th>Publish Date</th>
											<th>Status</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										{filteredItems.map((item) => {
											const articleUrl = item.pin?.destinationUrl || item.destinationUrl || '';
											return (
												<tr key={item.id}>
													<td>
														{item.pin?.imageUrl ? (
															<img className="an-thumb" src={item.pin.imageUrl} alt="" loading="lazy" decoding="async" />
														) : (
															<span className="an-thumb-fallback"><Pin size={12} /></span>
														)}
													</td>
													<td><p className="max-w-[12rem] truncate font-medium">{item.pin?.title || 'Untitled pin'}</p></td>
													<td className="text-muted-foreground">{item.websiteId || '—'}</td>
													<td className="text-muted-foreground">{item.boardName || item.boardId || '—'}</td>
													<td className="whitespace-nowrap text-muted-foreground">
														{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : '—'}
													</td>
													<td><Badge tone={item.status === 'published' ? 'green' : item.status === 'failed' ? 'red' : 'amber'}>{item.status}</Badge></td>
													<td>
														<div className="flex flex-wrap gap-1">
															{item.pinterestPinUrl ? (
																<a href={item.pinterestPinUrl} target="_blank" rel="noreferrer">
																	<Button size="sm" variant="ghost"><ExternalLink size={13} /> Pin</Button>
																</a>
															) : (
																<Button size="sm" variant="ghost" disabled><ExternalLink size={13} /> Pin</Button>
															)}
															{articleUrl ? (
																<a href={articleUrl} target="_blank" rel="noreferrer">
																	<Button size="sm" variant="ghost"><ExternalLink size={13} /> Article</Button>
																</a>
															) : (
																<Button size="sm" variant="ghost" disabled><ExternalLink size={13} /> Article</Button>
															)}
														</div>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
					</section>

					<section className="an-panel">
						<div className="an-panel__head">
							<div className="an-panel__title">
								<span className="an-panel__icon"><Globe size={14} /></span>
								Website Performance
							</div>
						</div>
						{websitePerformance.length === 0 ? (
							<div className="an-empty"><p className="font-semibold">No website performance yet</p><p className="mt-1 text-sm text-muted-foreground">Published jobs with website IDs will aggregate here.</p></div>
						) : (
							<div className="an-table-wrap">
								<table className="an-table" style={{ minWidth: '36rem' }}>
									<thead>
										<tr>
											<th>Website</th>
											<th>Published</th>
											<th>Scheduled</th>
											<th>Failed</th>
											<th>Success Rate</th>
											<th>Last Publish</th>
										</tr>
									</thead>
									<tbody>
										{websitePerformance.map((row) => (
											<tr key={row.website}>
												<td className="font-medium">{row.website}</td>
												<td>{row.published}</td>
												<td>{row.scheduled}</td>
												<td>{row.failed}</td>
												<td>{row.successRate}</td>
												<td className="text-muted-foreground">{row.lastPublish ? new Date(row.lastPublish).toLocaleString() : '—'}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</section>

					<section className="an-panel">
						<div className="an-panel__head">
							<div className="an-panel__title">
								<span className="an-panel__icon"><LayoutGrid size={14} /></span>
								Board Performance
							</div>
						</div>
						{boardPerformance.length === 0 ? (
							<div className="an-empty"><p className="font-semibold">No board performance yet</p><p className="mt-1 text-sm text-muted-foreground">Boards appear after pins are published.</p></div>
						) : (
							<div className="an-table-wrap">
								<table className="an-table" style={{ minWidth: '36rem' }}>
									<thead>
										<tr>
											<th>Board</th>
											<th>Published</th>
											<th>Failed</th>
											<th>Success Rate</th>
											<th>Impressions</th>
											<th>Last Publish</th>
										</tr>
									</thead>
									<tbody>
										{boardPerformance.map((row) => (
											<tr key={row.board}>
												<td className="font-medium">{row.board}</td>
												<td>{row.published}</td>
												<td>{row.failed}</td>
												<td>{row.successRate}</td>
												<td>{row.impressionsLabel}</td>
												<td className="text-muted-foreground">{row.lastPublish ? new Date(row.lastPublish).toLocaleString() : '—'}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</section>

					<section className="an-panel">
						<div className="an-panel__head">
							<div className="an-panel__title">
								<span className="an-panel__icon"><CheckCircle2 size={14} /></span>
								Performance Snapshot
							</div>
						</div>
						{filteredItems.length === 0 ? (
							<div className="an-empty"><p className="font-semibold">No performance fields yet</p><p className="mt-1 text-sm text-muted-foreground">Impressions, saves, clicks, and closeups show when synced.</p></div>
						) : (
							<div className="an-table-wrap">
								<table className="an-table" style={{ minWidth: '40rem' }}>
									<thead>
										<tr>
											<th>Pin</th>
											<th>Impressions</th>
											<th>Saves</th>
											<th>Outbound Clicks</th>
											<th>Closeups</th>
										</tr>
									</thead>
									<tbody>
										{filteredItems.map((item) => (
											<tr key={`perf-${item.id}`}>
												<td className="max-w-[14rem] truncate font-medium">{item.pin?.title || 'Untitled pin'}</td>
												<td className="text-muted-foreground">{item.performance?.impressions ?? '—'}</td>
												<td className="text-muted-foreground">{item.performance?.saves ?? '—'}</td>
												<td className="text-muted-foreground">{item.performance?.outboundClicks ?? '—'}</td>
												<td className="text-muted-foreground">{item.performance?.closeups ?? '—'}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</section>
				</div>

				<aside className="an-side">
					<section className="an-panel">
						<div className="an-panel__head">
							<div className="an-panel__title">
								<span className="an-panel__icon"><Sparkles size={14} /></span>
								Insights
							</div>
						</div>
						<div className="space-y-2">
							{insights.map((tip) => (
								<div key={tip.title} className="an-insight">
									<strong>{tip.title}</strong>
									{tip.body}
								</div>
							))}
						</div>
						<div className="mt-3 grid gap-2">
							<Link to="/app/pinterest-history"><Button size="sm" variant="outline" className="w-full"><AlertTriangle size={14} /> Publishing Center</Button></Link>
							<Link to="/app/calendar"><Button size="sm" variant="outline" className="w-full"><CalendarClock size={14} /> Content Calendar</Button></Link>
							<Link to="/app/pinterest"><Button size="sm" variant="ghost" className="w-full"><Pin size={14} /> Pinterest Hub</Button></Link>
						</div>
					</section>

					<section className="an-panel">
						<div className="an-panel__head">
							<div className="an-panel__title">
								<span className="an-panel__icon"><CheckCircle2 size={14} /></span>
								Summary
							</div>
						</div>
						<ul className="space-y-2 text-sm">
							<li className="flex items-center justify-between"><span>Published</span><Badge tone="green">{summary.published}</Badge></li>
							<li className="flex items-center justify-between"><span>Failed</span><Badge tone="red">{summary.failed}</Badge></li>
							<li className="flex items-center justify-between"><span>Scheduled</span><Badge tone="amber">{summary.scheduled}</Badge></li>
							<li className="flex items-center justify-between"><span>Filtered rows</span><Badge>{filteredItems.length}</Badge></li>
						</ul>
					</section>
				</aside>
			</div>
		</div>
	);
}
