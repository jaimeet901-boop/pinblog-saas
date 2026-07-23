import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

const EMPTY = {
	stats: {
		activeUsers: 0,
		workspaces: 0,
		websites: 0,
		pinterestAccounts: 0,
		jobs: 0,
		queueDepth: 0,
		creditsUsed: 0,
		aiRequests: 0,
		revenue: 0,
		serverHealth: '—',
	},
	alerts: [],
	activity: [],
	chart: [],
	registrations: [],
};

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

export default function AdminDashboardPage() {
	const { toast } = useToast();
	const [data, setData] = useState(EMPTY);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/dashboard');
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setData({
				...EMPTY,
				...payload,
				stats: { ...EMPTY.stats, ...(payload.stats || {}) },
			});
		} catch (error) {
			toast({ variant: 'destructive', title: 'Dashboard failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [toast]);

	useEffect(() => {
		load();
	}, [load]);

	const stats = data.stats;
	const statCards = [
		{ label: 'Active users', value: Number(stats.activeUsers || 0).toLocaleString(), hint: 'Live' },
		{ label: 'Workspaces', value: Number(stats.workspaces || 0).toLocaleString(), hint: 'Live' },
		{ label: 'Websites', value: Number(stats.websites || 0).toLocaleString(), hint: 'Live' },
		{ label: 'Pinterest accounts', value: Number(stats.pinterestAccounts || 0).toLocaleString(), hint: 'Live' },
		{ label: 'Jobs', value: Number(stats.jobs || 0).toLocaleString(), hint: 'Queue jobs' },
		{ label: 'Queue depth', value: Number(stats.queueDepth || 0).toLocaleString(), hint: 'Live' },
		{ label: 'Credits used', value: Number(stats.creditsUsed || 0).toLocaleString(), hint: 'Live' },
		{ label: 'AI requests', value: Number(stats.aiRequests || 0).toLocaleString(), hint: 'Live' },
		{ label: 'Revenue', value: `$${Number(stats.revenue || 0).toLocaleString()}`, hint: 'MRR' },
		{ label: 'Server health', value: stats.serverHealth || '—', hint: 'Platform' },
	];

	return (
		<div>
			<AdminHero
				title="Platform Command Center"
				description="Premium overview of Chef IA platform health from live PocketBase and queue telemetry."
				action={loading ? <Loader2 size={16} className="animate-spin" /> : null}
			/>

			<div className="admin-stats">
				{statCards.map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
						<p className="admin-stat__hint">{card.hint}</p>
					</div>
				))}
			</div>

			<div className="admin-grid admin-grid--2">
				<section className="admin-card">
					<h3>AI request volume</h3>
					<div className="admin-bars">
						{(data.chart.length ? data.chart : [{ label: '—', value: 0 }]).map((row) => (
							<div key={row.label} className="admin-bar-row">
								<span>{row.label}</span>
								<div className="admin-bar-track">
									<div className="admin-bar-fill" style={{ width: `${row.value}%` }} />
								</div>
								<span>{row.value}%</span>
							</div>
						))}
					</div>
					<p className="admin-note">Live chart from platform analytics.</p>
				</section>

				<section className="admin-card">
					<h3>System alerts</h3>
					<div className="admin-list">
						{(data.alerts.length ? data.alerts : [{ id: 'none', text: 'No active alerts', tone: 'green' }]).map((alert) => (
							<div key={alert.id} className="admin-list__item">
								<span>{alert.text}</span>
								<StatusPill status={alert.tone === 'green' ? 'healthy' : alert.tone === 'red' ? 'failed' : 'warn'} />
							</div>
						))}
					</div>
				</section>
			</div>

			<div className="admin-grid admin-grid--2 mt-4">
				<section className="admin-card">
					<h3>Recent registrations</h3>
					<div className="admin-list">
						{(data.registrations.length ? data.registrations : [{ name: 'No recent users', plan: 'free' }]).map((row) => (
							<div key={`${row.name}-${row.plan}`} className="admin-list__item">
								<span>{row.name}</span>
								<StatusPill status={row.plan} />
							</div>
						))}
					</div>
				</section>

				<section className="admin-card">
					<h3>Recent activity</h3>
					<div className="admin-list">
						{(data.activity.length ? data.activity : [{ id: 'none', text: 'No recent activity', time: '—' }]).map((item) => (
							<div key={item.id} className="admin-list__item">
								<span>{item.text}</span>
								<span>{item.time}</span>
							</div>
						))}
					</div>
				</section>
			</div>
		</div>
	);
}
