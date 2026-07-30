import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { AdminEmptyState, AdminErrorState, AdminHero, AdminSkeleton, StatusPill } from '@/components/admin/AdminUi';
import { apiServerClient } from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

async function readApiError(response) {
	const payload = await response.json().catch(() => ({}));
	return payload?.error || payload?.message || payload?.details?.validation?.summary || `Request failed (${response.status})`;
}

function statusPillForSeverity(severity) {
	if (severity === 'error') return 'critical';
	if (severity === 'warn') return 'warning';
	return 'info';
}

function formatWhen(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return date.toLocaleString();
}

export default function AdminBillingHealthPage() {
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [checking, setChecking] = useState('');
	const [checkingAll, setCheckingAll] = useState(false);
	const [error, setError] = useState('');
	const [items, setItems] = useState([]);
	const [updatedAt, setUpdatedAt] = useState(null);
	const [expanded, setExpanded] = useState({});
	const [canManage, setCanManage] = useState(true);

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/health');
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setItems(payload.items || []);
			setUpdatedAt(payload.updatedAt || null);
			setCanManage(payload.permissions?.['admin.billing.manage'] !== false);
		} catch (err) {
			setError(err?.message || 'Unable to load provider health');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const upsertLocal = (provider) => {
		setItems((prev) => prev.map((item) => (item.code === provider.code ? { ...item, ...provider } : item)));
		if (provider.updatedAt) setUpdatedAt(provider.updatedAt);
	};

	const runCheck = async (code) => {
		if (!canManage) return;
		setChecking(code);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/billing/control-plane/providers/${code}/health-check`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ expectedUpdatedAt: updatedAt, probeConnectivity: true }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const provider = await response.json();
			upsertLocal(provider);
			setExpanded((prev) => ({ ...prev, [code]: true }));
			toast({
				title: 'Health check complete',
				description: `${provider.name}: ${provider.status} · score ${provider.healthScore ?? '—'}`,
			});
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Health check failed', description: err?.message });
		} finally {
			setChecking('');
		}
	};

	const runCheckAll = async () => {
		if (!canManage) return;
		setCheckingAll(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/health-check', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ probeConnectivity: true }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Health checks complete', description: 'Latest snapshots updated for all providers.' });
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Bulk health check failed', description: err?.message });
		} finally {
			setCheckingAll(false);
		}
	};

	const stats = useMemo(() => ({
		healthy: items.filter((item) => item.status === 'Healthy').length,
		warning: items.filter((item) => item.status === 'Warning').length,
		critical: items.filter((item) => item.status === 'Critical').length,
		unknown: items.filter((item) => !item.status || item.status === 'Unknown' || item.status === 'Offline').length,
	}), [items]);

	return (
		<div>
			<AdminHero
				title="Provider Health"
				description="Observation and validation for billing providers. Health checks never create payments, checkouts, or subscriptions."
				action={(
					<div className="flex flex-wrap gap-2">
						<Link to="/admin/billing/providers" className="admin-btn">Billing Providers</Link>
						<button type="button" className="admin-btn" onClick={load} disabled={loading}>
							<RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Reload
						</button>
						<button
							type="button"
							className="admin-btn admin-btn--primary"
							disabled={!canManage || checkingAll}
							onClick={runCheckAll}
						>
							<Activity size={14} /> {checkingAll ? 'Checking…' : 'Run All Health Checks'}
						</button>
					</div>
				)}
			/>

			<div className="admin-stats admin-stats--compact">
				{[
					{ label: 'Healthy', value: stats.healthy },
					{ label: 'Warning', value: stats.warning },
					{ label: 'Critical', value: stats.critical },
					{ label: 'Unknown / Offline', value: stats.unknown },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
					</div>
				))}
			</div>

			{loading ? (
				<section className="admin-card"><AdminSkeleton rows={6} /></section>
			) : null}

			{!loading && error ? (
				<section className="admin-card">
					<AdminErrorState title="Unable to load provider health" description={error} />
				</section>
			) : null}

			{!loading && !error && items.length === 0 ? (
				<section className="admin-card">
					<AdminEmptyState title="No providers" description="Billing provider catalog is empty." />
				</section>
			) : null}

			{!loading && !error && items.length > 0 ? (
				<div className="space-y-3">
					{items.map((provider) => {
						const open = Boolean(expanded[provider.code]);
						const diagnostics = provider.validation?.diagnostics || [];
						return (
							<article key={provider.code} className="admin-card">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<h3 style={{ margin: 0 }}>{provider.name}</h3>
											<StatusPill status={provider.status || 'Unknown'} />
											<span className="admin-note mb-0 mt-0">
												Score {provider.healthScore == null ? '—' : provider.healthScore}
											</span>
										</div>
										<div className="admin-provider__meta mt-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
											<div>Enabled · <strong>{provider.enabled ? 'Yes' : 'No'}</strong></div>
											<div>Active · <strong>{provider.active ? 'Yes' : 'No'}</strong></div>
											<div>Connected · <strong>{provider.connectionLabel || (provider.connected ? 'Yes' : 'No')}</strong></div>
											<div>Environment · <strong>{provider.environment || '—'}</strong></div>
											<div>Last Health Check · <strong>{formatWhen(provider.lastHealthCheck)}</strong></div>
											<div>Last Validation · <strong>{formatWhen(provider.lastValidation)}</strong></div>
											<div>Auto Health · <strong>{provider.autoHealth ? 'Yes' : 'No'}</strong></div>
											<div>Last Error · <strong>{provider.lastError || '—'}</strong></div>
										</div>
									</div>
									<div className="flex flex-wrap gap-2">
										<button
											type="button"
											className="admin-btn admin-btn--primary"
											disabled={!canManage || checking === provider.code || checkingAll}
											onClick={() => runCheck(provider.code)}
										>
											<Activity size={12} />
											{checking === provider.code ? 'Checking…' : 'Run Health Check'}
										</button>
										<button
											type="button"
											className="admin-btn"
											onClick={() => setExpanded((prev) => ({ ...prev, [provider.code]: !open }))}
										>
											{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
											Diagnostics
										</button>
									</div>
								</div>

								{open ? (
									<div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--admin-border, #333)' }}>
										<p className="admin-note mt-0">
											Validation: <strong>{provider.validation?.result || '—'}</strong>
											{provider.validation?.summary ? ` — ${provider.validation.summary}` : ''}
										</p>
										{provider.health?.connectivity ? (
											<p className="admin-note">
												Connectivity: <strong>
													{provider.health.connectivity.ok === true ? 'OK' : provider.health.connectivity.ok === false ? 'Failed' : 'Not probed'}
												</strong>
												{provider.health.connectivity.message ? ` — ${provider.health.connectivity.message}` : ''}
											</p>
										) : null}
										{diagnostics.length === 0 ? (
											<p className="admin-note mb-0">No diagnostics yet. Run a health check to populate validation details.</p>
										) : (
											<ul className="mt-2 space-y-2" style={{ paddingLeft: 18, margin: 0, fontSize: 13 }}>
												{diagnostics.map((item) => (
													<li key={`${item.code}-${item.field || ''}-${item.message}`}>
														<StatusPill status={statusPillForSeverity(item.severity)} />
														{' '}
														<span>{item.message}</span>
														{item.field ? (
															<span style={{ color: 'var(--admin-muted)' }}> ({item.field})</span>
														) : null}
													</li>
												))}
											</ul>
										)}
									</div>
								) : null}
							</article>
						);
					})}
				</div>
			) : null}

			<p className="admin-note">
				Health Engine observes readiness and stores the latest snapshot only. Validation Engine gates activation — it does not change checkout or webhook runtime.
			</p>
		</div>
	);
}
