import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { AdminEmptyState, AdminErrorState, AdminHero, AdminSkeleton, StatusPill } from '@/components/admin/AdminUi';
import { apiServerClient } from '@/lib/apiServerClient';

async function readApiError(response) {
	const payload = await response.json().catch(() => ({}));
	return payload?.error || payload?.message || `Request failed (${response.status})`;
}

function sourceTone(source) {
	const value = String(source || '').toLowerCase();
	if (value === 'event_snapshot') return 'healthy';
	if (value === 'provider_amount') return 'info';
	if (value === 'catalog_price' || value === 'mixed') return 'warning';
	return 'pending';
}

function money(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return '—';
	return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminBillingDashboardPage() {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [summary, setSummary] = useState(null);
	const [byProvider, setByProvider] = useState(null);
	const [byPlan, setByPlan] = useState(null);
	const [trends, setTrends] = useState(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const [summaryRes, providerRes, planRes, trendsRes] = await Promise.all([
				apiServerClient.fetch('/admin/v1/billing/control-plane/revenue/summary'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/revenue/by-provider'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/revenue/by-plan'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/revenue/trends'),
			]);
			for (const response of [summaryRes, providerRes, planRes, trendsRes]) {
				if (!response.ok) throw new Error(await readApiError(response));
			}
			setSummary(await summaryRes.json());
			setByProvider(await providerRes.json());
			setByPlan(await planRes.json());
			setTrends(await trendsRes.json());
		} catch (err) {
			setError(err?.message || 'Unable to load revenue dashboard');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	return (
		<div>
			<AdminHero
				title="Billing Dashboard"
				description="Revenue KPIs derived from workspace subscriptions and billing_events. Historical amounts prefer immutable event snapshots."
				action={(
					<div className="flex flex-wrap gap-2">
						<Link to="/admin/billing/price-mapping" className="admin-btn">Price Mapping</Link>
						<Link to="/admin/billing/providers" className="admin-btn">Providers</Link>
						<button type="button" className="admin-btn" onClick={load} disabled={loading}>
							<RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Reload
						</button>
					</div>
				)}
			/>

			{loading ? <section className="admin-card"><AdminSkeleton rows={8} /></section> : null}
			{!loading && error ? (
				<section className="admin-card"><AdminErrorState title="Unable to load dashboard" description={error} /></section>
			) : null}

			{!loading && !error && summary ? (
				<>
					<section className="admin-card mb-4">
						<h3 style={{ marginTop: 0 }}>Live book</h3>
						<p className="admin-note mt-0">
							{summary.liveBookLabel || 'Live MRR (catalog)'}
							{' · '}
							Source <StatusPill status={sourceTone(summary.liveMrrRecognitionSource)} />
							{' '}{summary.liveMrrRecognitionSource || '—'}
						</p>
						<div className="admin-stats admin-stats--compact">
							{[
								{ label: 'Live MRR', value: money(summary.liveMrr) },
								{ label: 'ARR', value: money(summary.arr) },
								{ label: 'Active', value: summary.activeSubscriptions },
								{ label: 'Trials', value: summary.trialingSubscriptions },
							].map((card) => (
								<div key={card.label} className="admin-stat">
									<p className="admin-stat__label">{card.label}</p>
									<p className="admin-stat__value" style={{ fontSize: 22 }}>{card.value}</p>
								</div>
							))}
						</div>
					</section>

					<section className="admin-card mb-4">
						<h3 style={{ marginTop: 0 }}>Historical revenue</h3>
						<p className="admin-note mt-0">
							{summary.historicalBookLabel || 'Historical Revenue'}
							{' · '}
							Source <StatusPill status={sourceTone(summary.historicalRecognitionSource)} />
							{' '}{summary.historicalRecognitionSource || '—'}
							{summary.recognitionSourceBreakdown ? (
								<span>
									{' · '}
									snapshot {money(summary.recognitionSourceBreakdown.event_snapshot)}
									{' / '}
									provider {money(summary.recognitionSourceBreakdown.provider_amount)}
									{' / '}
									catalog {money(summary.recognitionSourceBreakdown.catalog_price)}
								</span>
							) : null}
						</p>
						{(summary.historicalRecognitionSource === 'catalog_price' || summary.historicalRecognitionSource === 'mixed') ? (
							<p className="admin-note">
								Some historical amounts use catalog fallback. Catalog price changes do not affect snapshot-backed events.
							</p>
						) : null}
						<div className="admin-stats admin-stats--compact">
							{[
								{ label: 'Period Revenue', value: money(summary.historicalRevenue) },
								{ label: 'New (period)', value: summary.newSubscriptions },
								{ label: 'Cancelled (period)', value: summary.cancelledInPeriod },
								{ label: 'Failed payments', value: summary.failedPayments },
								{ label: 'Refunds', value: summary.refunds },
							].map((card) => (
								<div key={card.label} className="admin-stat">
									<p className="admin-stat__label">{card.label}</p>
									<p className="admin-stat__value" style={{ fontSize: 22 }}>{card.value}</p>
								</div>
							))}
						</div>
					</section>

					<section className="admin-card mb-4" id="revenue-sources">
						<h3 style={{ marginTop: 0 }}>Revenue Sources</h3>
						<p className="admin-note mt-0">
							Provider share · recognition source{' '}
							<StatusPill status={sourceTone(byProvider?.recognitionSource)} />
							{' '}{byProvider?.recognitionSource || '—'}
						</p>
						{!(byProvider?.items || []).length ? (
							<AdminEmptyState title="No provider revenue" description="No recognized revenue events in range." />
						) : (
							<table className="admin-table w-full text-left" style={{ fontSize: 13 }}>
								<thead>
									<tr>
										<th>Provider</th>
										<th>Revenue</th>
										<th>Share</th>
										<th>Events</th>
									</tr>
								</thead>
								<tbody>
									{byProvider.items.map((row) => (
										<tr key={row.provider}>
											<td>{row.provider}</td>
											<td>{money(row.revenue)}</td>
											<td>{row.share}%</td>
											<td>{row.count}</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</section>

					<div className="grid gap-4 lg:grid-cols-2 mb-4">
						<section className="admin-card">
							<h3 style={{ marginTop: 0 }}>By plan</h3>
							{!(byPlan?.items || []).length ? (
								<AdminEmptyState title="No plan revenue" description="No recognized plan revenue in range." />
							) : (
								<table className="admin-table w-full text-left" style={{ fontSize: 13 }}>
									<thead>
										<tr><th>Plan</th><th>Revenue</th><th>Events</th></tr>
									</thead>
									<tbody>
										{byPlan.items.map((row) => (
											<tr key={row.planSlug}>
												<td>{row.planSlug}</td>
												<td>{money(row.revenue)}</td>
												<td>{row.count}</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</section>
						<section className="admin-card">
							<h3 style={{ marginTop: 0 }}>Revenue trend</h3>
							{!(trends?.series || []).length ? (
								<AdminEmptyState title="No trend data" description="No monthly revenue points yet." />
							) : (
								<table className="admin-table w-full text-left" style={{ fontSize: 13 }}>
									<thead>
										<tr><th>Month</th><th>Revenue</th><th>Events</th></tr>
									</thead>
									<tbody>
										{trends.series.map((row) => (
											<tr key={row.period}>
												<td>{row.period}</td>
												<td>{money(row.revenue)}</td>
												<td>{row.count}</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</section>
					</div>
				</>
			) : null}
		</div>
	);
}
