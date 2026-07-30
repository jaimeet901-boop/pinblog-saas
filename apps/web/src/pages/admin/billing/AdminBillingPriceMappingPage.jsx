import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Save, ShieldCheck, Upload } from 'lucide-react';
import { AdminEmptyState, AdminErrorState, AdminHero, AdminSkeleton, StatusPill } from '@/components/admin/AdminUi';
import { apiServerClient } from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

async function readApiError(response) {
	const payload = await response.json().catch(() => ({}));
	return payload?.error || payload?.message || `Request failed (${response.status})`;
}

const PROVIDERS = ['stripe', 'paddle', 'lemonsqueezy'];

export default function AdminBillingPriceMappingPage() {
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [mappings, setMappings] = useState({ plans: {}, packs: {} });
	const [catalog, setCatalog] = useState({ plans: [], packs: [] });
	const [validation, setValidation] = useState(null);
	const [updatedAt, setUpdatedAt] = useState(null);
	const [activeProvider, setActiveProvider] = useState('none');
	const [canManage, setCanManage] = useState(true);
	const [gapsOnly, setGapsOnly] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/price-mapping');
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setMappings(payload.mappings || { plans: {}, packs: {} });
			setCatalog(payload.catalog || { plans: [], packs: [] });
			setValidation(payload.validation || null);
			setUpdatedAt(payload.updatedAt || null);
			setActiveProvider(payload.activeProvider || 'none');
			setCanManage(payload.permissions?.['admin.billing.manage'] !== false);
		} catch (err) {
			setError(err?.message || 'Unable to load price mappings');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const gapKeys = useMemo(() => {
		const set = new Set();
		for (const item of validation?.diagnostics || []) {
			if (item.planSlug) set.add(`plan:${item.planSlug}`);
			if (item.packId) set.add(`pack:${item.packId}`);
		}
		return set;
	}, [validation]);

	const setPlanCell = (slug, interval, provider, value) => {
		setMappings((prev) => ({
			...prev,
			plans: {
				...prev.plans,
				[slug]: {
					...(prev.plans?.[slug] || { status: 'active', monthly: {}, yearly: {}, trial: {} }),
					[interval]: {
						...(prev.plans?.[slug]?.[interval] || {}),
						[provider]: value,
					},
				},
			},
		}));
	};

	const setPackCell = (packId, provider, value) => {
		setMappings((prev) => ({
			...prev,
			packs: {
				...prev.packs,
				[packId]: {
					...(prev.packs?.[packId] || { status: 'active', oneTime: {} }),
					oneTime: {
						...(prev.packs?.[packId]?.oneTime || {}),
						[provider]: value,
					},
				},
			},
		}));
	};

	const setPlanStatus = (slug, status) => {
		setMappings((prev) => ({
			...prev,
			plans: {
				...prev.plans,
				[slug]: {
					...(prev.plans?.[slug] || { monthly: {}, yearly: {}, trial: {} }),
					status,
				},
			},
		}));
	};

	const save = async () => {
		if (!canManage) return;
		setSaving(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/price-mapping', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mappings, expectedUpdatedAt: updatedAt }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setMappings(payload.mappings || mappings);
			setValidation(payload.validation || null);
			setUpdatedAt(payload.updatedAt || updatedAt);
			toast({ title: 'Price mappings saved', description: `Validation: ${payload.validation?.result || '—'}` });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Save failed', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const validateOnly = async () => {
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/price-mapping/validate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mappings }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setValidation(payload);
			toast({ title: 'Validation complete', description: payload.result });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Validation failed', description: err?.message });
		}
	};

	const sync = async () => {
		if (!canManage) return;
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/price-mapping/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ expectedUpdatedAt: updatedAt }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setUpdatedAt(payload.updatedAt || updatedAt);
			toast({ title: 'Synced to providers', description: payload.syncedAt || 'Runtime price IDs updated' });
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Sync failed', description: err?.message });
		}
	};

	const visiblePlans = (catalog.plans || []).filter((plan) => (
		!gapsOnly || gapKeys.has(`plan:${plan.slug}`)
	));
	const visiblePacks = (catalog.packs || []).filter((pack) => (
		!gapsOnly || gapKeys.has(`pack:${pack.id}`)
	));

	return (
		<div>
			<AdminHero
				title="Price Mapping"
				description="Bind internal plans and credit packs to Stripe, Paddle, and Lemon Squeezy price IDs. Sync mirrors mappings into runtime provider configuration."
				action={(
					<div className="flex flex-wrap gap-2">
						<Link to="/admin/billing" className="admin-btn">Dashboard</Link>
						<button type="button" className="admin-btn" onClick={load} disabled={loading}>
							<RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Reload
						</button>
						<button type="button" className="admin-btn" onClick={validateOnly}>
							<ShieldCheck size={14} /> Validate
						</button>
						<button type="button" className="admin-btn" disabled={!canManage} onClick={sync}>
							<Upload size={14} /> Sync
						</button>
						<button type="button" className="admin-btn admin-btn--primary" disabled={!canManage || saving} onClick={save}>
							<Save size={14} /> {saving ? 'Saving…' : 'Save'}
						</button>
					</div>
				)}
			/>

			<section className="admin-card mb-4">
				<p className="admin-note mt-0">
					Active provider: <strong>{activeProvider}</strong>
					{' · '}
					Validation: <StatusPill status={validation?.result === 'PASS' ? 'healthy' : validation?.result === 'WARNING' ? 'warning' : validation?.result === 'FAIL' ? 'critical' : 'pending'} />
					{' '}
					{validation?.summary ? (
						<span>
							missing {validation.summary.missing} · duplicates {validation.summary.duplicates} · conflicts {validation.summary.conflicts} · inactive {validation.summary.inactive}
						</span>
					) : null}
				</p>
				<label className="admin-field flex items-center gap-2">
					<input type="checkbox" checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} />
					<span>Show gaps only</span>
				</label>
			</section>

			{loading ? <section className="admin-card"><AdminSkeleton rows={8} /></section> : null}
			{!loading && error ? (
				<section className="admin-card"><AdminErrorState title="Unable to load mappings" description={error} /></section>
			) : null}

			{!loading && !error ? (
				<>
					<section className="admin-card mb-4 overflow-x-auto">
						<h3 style={{ marginTop: 0 }}>Plans</h3>
						{visiblePlans.length === 0 ? (
							<AdminEmptyState title="No plans" description="No plan rows match the current filter." />
						) : (
							<table className="admin-table w-full text-left" style={{ fontSize: 12 }}>
								<thead>
									<tr>
										<th>Plan</th>
										<th>Status</th>
										<th>Interval</th>
										{PROVIDERS.map((code) => <th key={code}>{code}</th>)}
										<th>PayPal</th>
									</tr>
								</thead>
								<tbody>
									{visiblePlans.flatMap((plan) => (
										['monthly', 'yearly', 'trial'].map((interval) => (
											<tr key={`${plan.slug}-${interval}`}>
												<td>
													<strong>{plan.name}</strong>
													<div style={{ color: 'var(--admin-muted)' }}>{plan.slug} · ${plan.monthlyPrice}/mo</div>
												</td>
												<td>
													{interval === 'monthly' ? (
														<select
															value={mappings.plans?.[plan.slug]?.status || 'active'}
															disabled={!canManage}
															onChange={(e) => setPlanStatus(plan.slug, e.target.value)}
														>
															<option value="active">active</option>
															<option value="inactive">inactive</option>
														</select>
													) : '—'}
												</td>
												<td>{interval}</td>
												{PROVIDERS.map((code) => (
													<td key={code}>
														<input
															value={mappings.plans?.[plan.slug]?.[interval]?.[code] || ''}
															disabled={!canManage}
															placeholder={`${code} id`}
															onChange={(e) => setPlanCell(plan.slug, interval, code, e.target.value)}
															style={{ minWidth: 120 }}
														/>
													</td>
												))}
												<td style={{ color: 'var(--admin-muted)' }}>N/A</td>
											</tr>
										))
									))}
								</tbody>
							</table>
						)}
					</section>

					<section className="admin-card mb-4 overflow-x-auto">
						<h3 style={{ marginTop: 0 }}>Credit packs (one-time)</h3>
						{visiblePacks.length === 0 ? (
							<AdminEmptyState title="No packs" description="No credit packs configured." />
						) : (
							<table className="admin-table w-full text-left" style={{ fontSize: 12 }}>
								<thead>
									<tr>
										<th>Pack</th>
										{PROVIDERS.map((code) => <th key={code}>{code}</th>)}
										<th>PayPal</th>
									</tr>
								</thead>
								<tbody>
									{visiblePacks.map((pack) => (
										<tr key={pack.id}>
											<td>
												<strong>{pack.name}</strong>
												<div style={{ color: 'var(--admin-muted)' }}>{pack.id} · ${pack.price}</div>
											</td>
											{PROVIDERS.map((code) => (
												<td key={code}>
													<input
														value={mappings.packs?.[pack.id]?.oneTime?.[code] || ''}
														disabled={!canManage}
														placeholder={`${code} id`}
														onChange={(e) => setPackCell(pack.id, code, e.target.value)}
														style={{ minWidth: 120 }}
													/>
												</td>
											))}
											<td style={{ color: 'var(--admin-muted)' }}>N/A</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</section>

					{validation?.diagnostics?.length ? (
						<section className="admin-card">
							<h3 style={{ marginTop: 0 }}>Diagnostics</h3>
							<ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
								{validation.diagnostics.slice(0, 40).map((item) => (
									<li key={`${item.code}-${item.message}`}>
										<StatusPill status={item.severity === 'error' ? 'critical' : item.severity === 'warn' ? 'warning' : 'info'} />
										{' '}{item.message}
									</li>
								))}
							</ul>
						</section>
					) : null}
				</>
			) : null}
		</div>
	);
}
