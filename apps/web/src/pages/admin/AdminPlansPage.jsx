import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	Eye, Pencil, Copy, Power, PowerOff, Trash2, X, Check, RefreshCw, Loader2, Plus, UserPlus,
} from 'lucide-react';
import {
	AdminHero, StatusPill, AdminSkeleton, AdminEmptyState, AdminErrorState,
} from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

function yesNo(value) {
	return value ? 'Yes' : 'No';
}

function formatLimit(value) {
	if (value === 'Custom' || value == null) return String(value ?? '—');
	return Number(value).toLocaleString();
}

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

const EMPTY_FORM = {
	name: '',
	slug: '',
	description: '',
	monthlyPrice: '0',
	yearlyPrice: '0',
	currency: 'USD',
	credits: '0',
	bonusCredits: '0',
	rollover: false,
	topupAllowed: false,
	support: '',
	refillPolicy: '',
	publishingLimits: '',
	aiFeatures: '',
	imageLimits: '',
	aiModels: '',
	highlight: false,
	active: true,
	displayOrder: '100',
	limits: {
		articlesPerMonth: 0,
		imagesPerMonth: 0,
		aiRequests: 0,
		pinterestAccounts: 0,
		wordpressSites: 0,
		teamMembers: 1,
		storageGb: 1,
		queueJobs: 0,
		exports: 0,
		apiRequests: 0,
		maxWorkspaces: 1,
	},
	features: {
		aiWriter: false,
		aiImages: false,
		templates: false,
		brandKit: false,
		analytics: false,
		calendar: false,
		pinterest: false,
		wordpress: false,
		history: false,
		apiAccess: false,
		priorityQueue: false,
	},
};

function planToForm(plan) {
	return {
		...EMPTY_FORM,
		name: plan.name || '',
		slug: plan.slug || '',
		description: plan.description || '',
		monthlyPrice: String(plan.monthlyPrice ?? plan.price ?? 0),
		yearlyPrice: String(plan.yearlyPrice ?? 0),
		currency: plan.currency || 'USD',
		credits: String(plan.credits ?? 0),
		bonusCredits: String(plan.bonusCredits ?? 0),
		rollover: Boolean(plan.rollover),
		topupAllowed: Boolean(plan.topupAllowed),
		support: plan.support || '',
		refillPolicy: plan.refillPolicy || '',
		publishingLimits: plan.publishingLimits || '',
		aiFeatures: plan.aiFeatures || '',
		imageLimits: plan.imageLimits || '',
		aiModels: plan.aiModels || '',
		highlight: Boolean(plan.highlight),
		active: plan.status === 'active',
		displayOrder: String(plan.displayOrder ?? 100),
		limits: { ...EMPTY_FORM.limits, ...(plan.limits || {}) },
		features: { ...EMPTY_FORM.features, ...(plan.features || {}) },
	};
}

export default function AdminPlansPage() {
	const { toast } = useToast();
	const [plans, setPlans] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [saving, setSaving] = useState(false);
	const [selectedId, setSelectedId] = useState('');
	const [drawerMode, setDrawerMode] = useState('view');
	const [form, setForm] = useState(EMPTY_FORM);
	const [assignForm, setAssignForm] = useState({ workspaceName: '', ownerEmail: '', planId: '' });

	const selected = plans.find((plan) => plan.id === selectedId) || null;

	const stats = useMemo(() => {
		const total = plans.length;
		const active = plans.filter((plan) => plan.status === 'active').length;
		const subscribers = plans.reduce((sum, plan) => sum + Number(plan.subscribers || 0), 0);
		const monthlyConsumption = plans.reduce(
			(sum, plan) => sum + Number(plan.avgUsage || 0) * Number(plan.subscribers || 0),
			0,
		);
		return { total, active, subscribers, monthlyConsumption };
	}, [plans]);

	const loadPlans = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const response = await apiServerClient.fetch('/admin/v1/plans');
			if (!response.ok) throw new Error(await readApiError(response));
			const data = await response.json();
			setPlans(Array.isArray(data.items) ? data.items : []);
		} catch (err) {
			setError(err?.message || 'Failed to load plans');
			setPlans([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadPlans();
	}, [loadPlans]);

	useEffect(() => {
		if (!selected && drawerMode === 'view') return undefined;
		const onKeyDown = (event) => {
			if (event.key === 'Escape') {
				setSelectedId('');
				setDrawerMode('view');
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [selected, drawerMode]);

	const upsertLocal = (plan) => {
		setPlans((prev) => {
			const index = prev.findIndex((item) => item.id === plan.id);
			if (index === -1) return [...prev, plan].sort((a, b) => a.displayOrder - b.displayOrder);
			const next = [...prev];
			next[index] = plan;
			return next;
		});
	};

	const openView = (id) => {
		setSelectedId(id);
		setDrawerMode('view');
	};

	const openEdit = (id) => {
		const plan = plans.find((item) => item.id === id);
		if (!plan) return;
		setSelectedId(id);
		setForm(planToForm(plan));
		setDrawerMode('edit');
	};

	const openCreate = () => {
		setSelectedId('');
		setForm(EMPTY_FORM);
		setDrawerMode('create');
	};

	const openAssign = (planId = '') => {
		setAssignForm({ workspaceName: '', ownerEmail: '', planId: planId || selectedId || plans[0]?.id || '' });
		setDrawerMode('assign');
	};

	const closeDrawer = () => {
		setSelectedId('');
		setDrawerMode('view');
	};

	const runAction = async (path, method = 'POST', body) => {
		const response = await apiServerClient.fetch(path, {
			method,
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!response.ok) throw new Error(await readApiError(response));
		return response.status === 204 ? null : response.json();
	};

	const toggleEnabled = async (plan, enabled) => {
		try {
			const next = await runAction(`/admin/v1/plans/${plan.id}/${enabled ? 'enable' : 'disable'}`);
			upsertLocal(next);
			toast({ title: enabled ? 'Plan enabled' : 'Plan disabled', description: next.name });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Update failed', description: err?.message });
		}
	};

	const duplicate = async (plan) => {
		try {
			const next = await runAction(`/admin/v1/plans/${plan.id}/duplicate`);
			upsertLocal(next);
			toast({ title: 'Plan duplicated', description: next.name });
			openEdit(next.id);
		} catch (err) {
			toast({ variant: 'destructive', title: 'Duplicate failed', description: err?.message });
		}
	};

	const removePlan = async (plan) => {
		if (!window.confirm(`Delete plan "${plan.name}"?`)) return;
		try {
			await runAction(`/admin/v1/plans/${plan.id}`, 'DELETE');
			setPlans((prev) => prev.filter((item) => item.id !== plan.id));
			closeDrawer();
			toast({ title: 'Plan deleted', description: plan.name });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Delete failed', description: err?.message });
		}
	};

	const savePlan = async () => {
		setSaving(true);
		try {
			const payload = {
				name: form.name.trim(),
				slug: form.slug.trim(),
				description: form.description,
				monthlyPrice: Number(form.monthlyPrice),
				yearlyPrice: Number(form.yearlyPrice),
				currency: form.currency,
				credits: Number(form.credits),
				bonusCredits: Number(form.bonusCredits),
				rollover: form.rollover,
				topupAllowed: form.topupAllowed,
				support: form.support,
				refillPolicy: form.refillPolicy,
				publishingLimits: form.publishingLimits,
				aiFeatures: form.aiFeatures,
				imageLimits: form.imageLimits,
				aiModels: form.aiModels,
				highlight: form.highlight,
				active: form.active,
				displayOrder: Number(form.displayOrder),
				limits: Object.fromEntries(
					Object.entries(form.limits).map(([key, value]) => [key, Number(value) || 0]),
				),
				features: form.features,
				status: form.active ? 'active' : 'hidden',
			};
			const isCreate = drawerMode === 'create';
			const response = await apiServerClient.fetch(
				isCreate ? '/admin/v1/plans' : `/admin/v1/plans/${selectedId}`,
				{
					method: isCreate ? 'POST' : 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				},
			);
			if (!response.ok) throw new Error(await readApiError(response));
			const plan = await response.json();
			upsertLocal(plan);
			setSelectedId(plan.id);
			setDrawerMode('view');
			toast({ title: isCreate ? 'Plan created' : 'Plan updated', description: plan.name });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Save failed', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const saveAssign = async () => {
		setSaving(true);
		try {
			const result = await runAction('/admin/v1/plans/assign', 'POST', {
				workspaceName: assignForm.workspaceName.trim(),
				workspaceKey: assignForm.workspaceName.trim(),
				ownerEmail: assignForm.ownerEmail.trim(),
				planId: assignForm.planId,
			});
			await loadPlans();
			toast({
				title: 'Workspace assigned',
				description: `${result.workspaceName} → ${result.planName}`,
			});
			closeDrawer();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Assign failed', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const showDrawer = drawerMode === 'create' || drawerMode === 'assign' || Boolean(selected);

	return (
		<div>
			<AdminHero
				title="Plans & Credits"
				description="Manage subscription plans, limits, and credit allocations."
				action={(
					<div className="flex flex-wrap gap-2">
						<button type="button" className="admin-btn" onClick={loadPlans} disabled={loading}>
							<RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Reload
						</button>
						<button type="button" className="admin-btn" onClick={() => openAssign()}>
							<UserPlus size={14} /> Assign workspace
						</button>
						<button type="button" className="admin-btn admin-btn--primary" onClick={openCreate}>
							<Plus size={14} /> Add plan
						</button>
					</div>
				)}
			/>

			<div className="admin-stats admin-stats--compact">
				{[
					{ label: 'Total Plans', value: stats.total },
					{ label: 'Active Plans', value: stats.active },
					{ label: 'Total Subscribers', value: stats.subscribers.toLocaleString() },
					{ label: 'Monthly Credit Consumption', value: stats.monthlyConsumption.toLocaleString() },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
						<p className="admin-stat__hint">Live</p>
					</div>
				))}
			</div>

			{loading ? <section className="admin-card"><AdminSkeleton rows={6} /></section> : null}
			{!loading && error ? (
				<section className="admin-card">
					<AdminErrorState title="Unable to load plans" description={error} />
					<div className="mt-3"><button type="button" className="admin-btn admin-btn--primary" onClick={loadPlans}>Retry</button></div>
				</section>
			) : null}

			{!loading && !error && plans.length === 0 ? (
				<section className="admin-card">
					<AdminEmptyState title="No plans" description="Create a plan to get started." />
				</section>
			) : null}

			{!loading && !error && plans.length > 0 ? (
				<>
					<div className="admin-plans-grid">
						{plans.map((plan) => (
							<article
								key={plan.id}
								className={`admin-plan-card ${plan.highlight ? 'is-highlight' : ''} ${selectedId === plan.id ? 'is-selected' : ''}`}
								onClick={() => openView(plan.id)}
							>
								<div className="flex items-start justify-between gap-2">
									<div>
										{plan.highlight ? <span className="admin-pill admin-pill--green mb-2">Popular</span> : null}
										<h4>{plan.name}</h4>
									</div>
									<StatusPill status={plan.status} />
								</div>

								<p className="admin-plan-card__price">
									${plan.price}
									<span>/mo</span>
								</p>

								<ul className="admin-plan-card__list">
									<li><Check size={13} /> {plan.credits.toLocaleString()} credits included</li>
									<li><Check size={13} /> {formatLimit(plan.maxWorkspaces)} workspaces</li>
									<li><Check size={13} /> {formatLimit(plan.maxWordpress)} WordPress sites</li>
									<li><Check size={13} /> {formatLimit(plan.maxPinterest)} Pinterest accounts</li>
									<li><Check size={13} /> {plan.aiModels || 'Model access configured'}</li>
									<li><Check size={13} /> Priority queue · {yesNo(plan.priorityQueue)}</li>
									<li><Check size={13} /> Support · {plan.support || '—'}</li>
								</ul>

								<div className="admin-plan-card__actions" onClick={(event) => event.stopPropagation()}>
									<button type="button" className="admin-btn" onClick={() => openView(plan.id)}>
										<Eye size={12} /> View
									</button>
									<button type="button" className="admin-btn admin-btn--primary" onClick={() => openEdit(plan.id)}>
										<Pencil size={12} /> Edit Plan
									</button>
									<button type="button" className="admin-btn" onClick={() => duplicate(plan)}>
										<Copy size={12} /> Duplicate
									</button>
								</div>
							</article>
						))}
					</div>

					<section className="admin-card mt-4">
						<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
							<h3 className="m-0">Credits by plan</h3>
							<p className="admin-note m-0">Allocation table · live usage</p>
						</div>
						<div className="admin-table-wrap">
							<table className="admin-table" style={{ minWidth: '52rem' }}>
								<thead>
									<tr>
										<th>Plan</th>
										<th>Monthly Credits</th>
										<th>Bonus Credits</th>
										<th>Roll-over</th>
										<th>Top-up Allowed</th>
										<th>Current Subscribers</th>
										<th>Average Monthly Usage</th>
										<th>Actions</th>
									</tr>
								</thead>
								<tbody>
									{plans.map((plan) => (
										<tr
											key={`credits-${plan.id}`}
											className={selectedId === plan.id ? 'is-selected' : ''}
											onClick={() => openView(plan.id)}
										>
											<td className="font-medium">{plan.name}</td>
											<td>{plan.credits.toLocaleString()}</td>
											<td>{plan.bonusCredits.toLocaleString()}</td>
											<td>{plan.rollover ? <span className="admin-pill admin-pill--green">Yes</span> : <span className="admin-pill">No</span>}</td>
											<td>{plan.topupAllowed ? <span className="admin-pill admin-pill--green">Yes</span> : <span className="admin-pill">No</span>}</td>
											<td>{plan.subscribers.toLocaleString()}</td>
											<td style={{ color: 'var(--admin-muted)' }}>{plan.avgUsage.toLocaleString()}</td>
											<td onClick={(event) => event.stopPropagation()}>
												<button type="button" className="admin-btn" onClick={() => openView(plan.id)}>
													<Eye size={12} /> View
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>
				</>
			) : null}

			{showDrawer ? (
				<div className="admin-drawer-overlay" role="dialog" aria-modal="true" aria-label="Plan details" onClick={closeDrawer}>
					<aside className="admin-user-drawer admin-user-drawer--wide" onClick={(event) => event.stopPropagation()}>
						<div className="admin-user-drawer__head">
							<div>
								<p className="font-display text-xl font-semibold leading-tight">
									{drawerMode === 'create' ? 'Add plan' : drawerMode === 'assign' ? 'Assign workspace' : selected?.name}
								</p>
								{selected && drawerMode === 'view' ? (
									<>
										<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>
											${selected.price}/mo · {selected.subscribers.toLocaleString()} subscribers
										</p>
										<div className="mt-2 flex flex-wrap gap-2">
											<StatusPill status={selected.status} />
											{selected.highlight ? <span className="admin-pill admin-pill--green">Popular</span> : null}
										</div>
									</>
								) : null}
							</div>
							<button type="button" className="admin-icon-btn" onClick={closeDrawer} aria-label="Close">
								<X size={16} />
							</button>
						</div>

						{drawerMode === 'view' && selected ? (
							<>
								<section className="admin-user-drawer__section">
									<h3>Plan Information</h3>
									<div className="admin-meta-row"><span>Name</span><span>{selected.name}</span></div>
									<div className="admin-meta-row"><span>Slug</span><span>{selected.slug}</span></div>
									<div className="admin-meta-row"><span>Monthly price</span><span>${selected.price}</span></div>
									<div className="admin-meta-row"><span>Yearly price</span><span>${selected.yearlyPrice}</span></div>
									<div className="admin-meta-row"><span>Status</span><StatusPill status={selected.status} /></div>
									<div className="admin-meta-row"><span>Support level</span><span>{selected.support}</span></div>
								</section>
								<section className="admin-user-drawer__section">
									<h3>Monthly Credits</h3>
									<div className="admin-meta-row"><span>Included</span><span>{selected.credits.toLocaleString()}</span></div>
									<div className="admin-meta-row"><span>Bonus</span><span>{selected.bonusCredits.toLocaleString()}</span></div>
									<div className="admin-meta-row"><span>Avg usage</span><span>{selected.avgUsage.toLocaleString()}</span></div>
								</section>
								<section className="admin-user-drawer__section">
									<h3>Credit Refill Policy</h3>
									<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.refillPolicy}</p>
									<div className="admin-meta-row mt-2"><span>Roll-over</span><span>{yesNo(selected.rollover)}</span></div>
									<div className="admin-meta-row"><span>Top-up allowed</span><span>{yesNo(selected.topupAllowed)}</span></div>
								</section>
								<section className="admin-user-drawer__section">
									<h3>Workspace Limits</h3>
									<div className="admin-meta-row"><span>Max workspaces</span><span>{formatLimit(selected.maxWorkspaces)}</span></div>
									<div className="admin-meta-row"><span>Max WordPress sites</span><span>{formatLimit(selected.maxWordpress)}</span></div>
									<div className="admin-meta-row"><span>Max Pinterest accounts</span><span>{formatLimit(selected.maxPinterest)}</span></div>
									<div className="admin-meta-row"><span>Articles / mo</span><span>{formatLimit(selected.limits?.articlesPerMonth)}</span></div>
									<div className="admin-meta-row"><span>Images / mo</span><span>{formatLimit(selected.limits?.imagesPerMonth)}</span></div>
									<div className="admin-meta-row"><span>AI requests</span><span>{formatLimit(selected.limits?.aiRequests)}</span></div>
								</section>
								<section className="admin-user-drawer__section">
									<h3>Feature Access</h3>
									<div className="flex flex-wrap gap-2">
										{Object.entries(selected.features || {}).map(([key, enabled]) => (
											<span key={key} className={`admin-pill ${enabled ? 'admin-pill--green' : ''}`} style={enabled ? undefined : { opacity: 0.45 }}>
												{key}
											</span>
										))}
									</div>
								</section>
								<section className="admin-user-drawer__section">
									<h3>Publishing Limits</h3>
									<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.publishingLimits}</p>
								</section>
								<section className="admin-user-drawer__section">
									<h3>AI Features</h3>
									<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.aiFeatures}</p>
									<div className="admin-meta-row mt-2"><span>AI models access</span><span>{selected.aiModels}</span></div>
								</section>
								<section className="admin-user-drawer__section">
									<h3>Image Generation Limits</h3>
									<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.imageLimits}</p>
								</section>
								<section className="admin-user-drawer__section">
									<h3>Storage Limits</h3>
									<div className="admin-meta-row"><span>Storage</span><span>{formatLimit(selected.storageGb)} GB</span></div>
								</section>
								<section className="admin-user-drawer__section">
									<h3>API Access</h3>
									<div className="admin-meta-row"><span>API access</span><StatusPill status={selected.apiAccess ? 'connected' : 'disconnected'} /></div>
								</section>
								<section className="admin-user-drawer__section">
									<h3>Priority Processing</h3>
									<div className="admin-meta-row"><span>Priority queue</span><span>{yesNo(selected.priorityQueue)}</span></div>
									<div className="admin-meta-row"><span>Priority processing</span><span>{yesNo(selected.priorityProcessing)}</span></div>
								</section>
								<div className="admin-user-drawer__actions">
									<button type="button" className="admin-btn" onClick={() => openView(selected.id)}><Eye size={13} /> View</button>
									<button type="button" className="admin-btn" onClick={() => openEdit(selected.id)}><Pencil size={13} /> Edit Plan</button>
									<button type="button" className="admin-btn" onClick={() => duplicate(selected)}><Copy size={13} /> Duplicate Plan</button>
									<button type="button" className="admin-btn" disabled={selected.status === 'active'} onClick={() => toggleEnabled(selected, true)}><Power size={13} /> Enable</button>
									<button type="button" className="admin-btn" disabled={selected.status !== 'active'} onClick={() => toggleEnabled(selected, false)}><PowerOff size={13} /> Disable</button>
									<button type="button" className="admin-btn" onClick={() => openAssign(selected.id)}><UserPlus size={13} /> Assign</button>
									<button type="button" className="admin-btn admin-btn--danger" onClick={() => removePlan(selected)}><Trash2 size={13} /> Delete</button>
								</div>
							</>
						) : null}

						{(drawerMode === 'create' || drawerMode === 'edit') ? (
							<section className="admin-user-drawer__section">
								<h3>{drawerMode === 'create' ? 'Create Plan' : 'Edit Plan'}</h3>
								<div className="admin-config-grid">
									<div className="admin-field"><label>Name</label><input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} /></div>
									<div className="admin-field"><label>Slug</label><input value={form.slug} onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))} /></div>
									<div className="admin-field"><label>Monthly Price</label><input value={form.monthlyPrice} onChange={(e) => setForm((prev) => ({ ...prev, monthlyPrice: e.target.value }))} /></div>
									<div className="admin-field"><label>Yearly Price</label><input value={form.yearlyPrice} onChange={(e) => setForm((prev) => ({ ...prev, yearlyPrice: e.target.value }))} /></div>
									<div className="admin-field"><label>Credits</label><input value={form.credits} onChange={(e) => setForm((prev) => ({ ...prev, credits: e.target.value }))} /></div>
									<div className="admin-field"><label>Bonus Credits</label><input value={form.bonusCredits} onChange={(e) => setForm((prev) => ({ ...prev, bonusCredits: e.target.value }))} /></div>
									<div className="admin-field"><label>Support</label><input value={form.support} onChange={(e) => setForm((prev) => ({ ...prev, support: e.target.value }))} /></div>
									<div className="admin-field"><label>AI Models</label><input value={form.aiModels} onChange={(e) => setForm((prev) => ({ ...prev, aiModels: e.target.value }))} /></div>
								</div>
								<div className="admin-field mt-3"><label>Description</label><textarea rows={2} value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} /></div>
								<div className="mt-3 flex flex-wrap gap-3">
									<label className="admin-check"><input type="checkbox" checked={form.rollover} onChange={(e) => setForm((prev) => ({ ...prev, rollover: e.target.checked }))} /> Rollover</label>
									<label className="admin-check"><input type="checkbox" checked={form.topupAllowed} onChange={(e) => setForm((prev) => ({ ...prev, topupAllowed: e.target.checked }))} /> Top-up</label>
									<label className="admin-check"><input type="checkbox" checked={form.highlight} onChange={(e) => setForm((prev) => ({ ...prev, highlight: e.target.checked }))} /> Popular</label>
									<label className="admin-check"><input type="checkbox" checked={form.active} onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))} /> Active</label>
								</div>
								<p className="admin-note mt-3 mb-2">Limits</p>
								<div className="admin-config-grid">
									{Object.keys(form.limits).map((key) => (
										<div key={key} className="admin-field">
											<label>{key}</label>
											<input
												value={form.limits[key]}
												onChange={(e) => setForm((prev) => ({
													...prev,
													limits: { ...prev.limits, [key]: e.target.value },
												}))}
											/>
										</div>
									))}
								</div>
								<p className="admin-note mt-3 mb-2">Features</p>
								<div className="flex flex-wrap gap-3">
									{Object.keys(form.features).map((key) => (
										<label key={key} className="admin-check">
											<input
												type="checkbox"
												checked={Boolean(form.features[key])}
												onChange={(e) => setForm((prev) => ({
													...prev,
													features: { ...prev.features, [key]: e.target.checked },
												}))}
											/>
											{key}
										</label>
									))}
								</div>
								<div className="mt-4 flex flex-wrap gap-2">
									<button type="button" className="admin-btn admin-btn--primary" onClick={savePlan} disabled={saving}>
										{saving ? <Loader2 size={13} className="animate-spin" /> : null}
										{saving ? 'Saving…' : 'Save plan'}
									</button>
									<button type="button" className="admin-btn" onClick={closeDrawer}>Cancel</button>
								</div>
							</section>
						) : null}

						{drawerMode === 'assign' ? (
							<section className="admin-user-drawer__section">
								<h3>Assign Workspace to Plan</h3>
								<div className="admin-config-grid">
									<div className="admin-field">
										<label>Workspace name</label>
										<input value={assignForm.workspaceName} onChange={(e) => setAssignForm((prev) => ({ ...prev, workspaceName: e.target.value }))} placeholder="Sunday Kitchen" />
									</div>
									<div className="admin-field">
										<label>Owner email</label>
										<input value={assignForm.ownerEmail} onChange={(e) => setAssignForm((prev) => ({ ...prev, ownerEmail: e.target.value }))} />
									</div>
									<div className="admin-field">
										<label>Plan</label>
										<select value={assignForm.planId} onChange={(e) => setAssignForm((prev) => ({ ...prev, planId: e.target.value }))}>
											<option value="">Select plan</option>
											{plans.map((plan) => (
												<option key={plan.id} value={plan.id}>{plan.name}</option>
											))}
										</select>
									</div>
								</div>
								<div className="mt-4 flex flex-wrap gap-2">
									<button type="button" className="admin-btn admin-btn--primary" onClick={saveAssign} disabled={saving}>
										{saving ? <Loader2 size={13} className="animate-spin" /> : null}
										Assign
									</button>
									<button type="button" className="admin-btn" onClick={closeDrawer}>Cancel</button>
								</div>
							</section>
						) : null}
					</aside>
				</div>
			) : null}
		</div>
	);
}
