import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	Eye, Pencil, Power, PowerOff, Star, Trash2, X, RefreshCw, Loader2, Plus,
} from 'lucide-react';
import {
	AdminHero, StatusPill, AdminPagination, AdminSkeleton, AdminEmptyState, AdminErrorState,
} from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 6;

const ALL_CAPABILITIES = [
	'Article Writing',
	'Recipe Writing',
	'SEO',
	'Image Prompting',
	'Image Generation',
	'Summarization',
	'Translation',
	'Reasoning',
	'Code Generation',
];

const EMPTY_FORM = {
	providerId: '',
	modelId: '',
	displayName: '',
	capability: 'text',
	contextWindow: '128000',
	inputPricing: '',
	outputPricing: '',
	pricingUnit: '1M',
	supportsVision: false,
	supportsStreaming: true,
	supportsFunctionCalling: false,
	supportsReasoning: false,
	isDefault: false,
	enabled: true,
	priority: '100',
	version: '',
	capabilities: [],
};

function formatContext(value) {
	const n = Number(value || 0);
	if (!n) return '—';
	if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
	if (n >= 1000) return `${Math.round(n / 1000)}K`;
	return String(n);
}

function matchesContextFilter(contextWindow, filter) {
	const value = Number(contextWindow || 0);
	if (!filter) return true;
	if (filter === 'lt32k') return value > 0 && value < 32000;
	if (filter === '32k-128k') return value >= 32000 && value < 128000;
	if (filter === '128k-1m') return value >= 128000 && value < 1000000;
	if (filter === '1m+') return value >= 1000000;
	return true;
}

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

function modelToForm(model) {
	return {
		providerId: model.providerId || '',
		modelId: model.modelId || model.name || '',
		displayName: model.displayName || model.name || '',
		capability: model.capability || 'text',
		contextWindow: String(model.contextWindow || 0),
		inputPricing: model.inputPricing == null ? '' : String(model.inputPricing),
		outputPricing: model.outputPricing == null ? '' : String(model.outputPricing),
		pricingUnit: model.pricingUnit || '1M',
		supportsVision: Boolean(model.supportsVision),
		supportsStreaming: Boolean(model.supportsStreaming),
		supportsFunctionCalling: Boolean(model.supportsFunctionCalling),
		supportsReasoning: Boolean(model.supportsReasoning),
		isDefault: Boolean(model.isDefault),
		enabled: model.status !== 'disabled',
		priority: String(model.priority ?? 100),
		version: model.version || '',
		capabilities: Array.isArray(model.capabilities) ? [...model.capabilities] : [],
	};
}

export default function AdminModelsPage() {
	const { toast } = useToast();
	const [models, setModels] = useState([]);
	const [providers, setProviders] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [saving, setSaving] = useState(false);
	const [search, setSearch] = useState('');
	const [provider, setProvider] = useState('');
	const [status, setStatus] = useState('');
	const [capability, setCapability] = useState('');
	const [contextLength, setContextLength] = useState('');
	const [page, setPage] = useState(1);
	const [selectedId, setSelectedId] = useState('');
	const [drawerMode, setDrawerMode] = useState('view');
	const [form, setForm] = useState(EMPTY_FORM);

	const selected = models.find((model) => model.id === selectedId) || null;

	const providerOptions = useMemo(
		() => [...providers].sort((a, b) => String(a.name).localeCompare(String(b.name))),
		[providers],
	);

	const stats = useMemo(() => {
		const total = models.length;
		const active = models.filter((model) => model.status === 'enabled').length;
		const disabled = models.filter((model) => model.status === 'disabled').length;
		const defaults = models.filter((model) => model.isDefault).length;
		return { total, active, disabled, defaults };
	}, [models]);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return models.filter((model) => {
			if (provider && model.providerId !== provider && model.provider !== provider && model.providerCode !== provider) {
				return false;
			}
			if (status && model.status !== status) return false;
			if (capability) {
				const list = (model.capabilities || []).map((item) => item.toLowerCase());
				const typeMatch = String(model.capability || '').toLowerCase() === capability.toLowerCase();
				const tagMatch = list.some((item) => item.includes(capability.toLowerCase()));
				if (!typeMatch && !tagMatch) return false;
			}
			if (!matchesContextFilter(model.contextWindow, contextLength)) return false;
			if (!q) return true;
			const haystack = [
				model.name,
				model.modelId,
				model.provider,
				model.capability,
				...(model.capabilities || []),
			].join(' ').toLowerCase();
			return haystack.includes(q);
		});
	}, [models, search, provider, status, capability, contextLength]);

	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

	const upsertLocal = useCallback((model) => {
		setModels((prev) => {
			const index = prev.findIndex((item) => item.id === model.id);
			if (index === -1) return [...prev, model];
			const next = [...prev];
			next[index] = model;
			return next.map((item) => (
				model.isDefault && item.id !== model.id && item.capability === model.capability
					? { ...item, isDefault: false }
					: item
			));
		});
	}, []);

	const loadData = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const [modelsRes, providersRes] = await Promise.all([
				apiServerClient.fetch('/admin/v1/models'),
				apiServerClient.fetch('/admin/v1/providers'),
			]);
			if (!modelsRes.ok) throw new Error(await readApiError(modelsRes));
			if (!providersRes.ok) throw new Error(await readApiError(providersRes));
			const modelsData = await modelsRes.json();
			const providersData = await providersRes.json();
			setModels(Array.isArray(modelsData.items) ? modelsData.items : []);
			setProviders(Array.isArray(providersData.items) ? providersData.items : []);
		} catch (err) {
			setError(err?.message || 'Failed to load models');
			setModels([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadData();
	}, [loadData]);

	useEffect(() => {
		if (page > totalPages) setPage(totalPages);
	}, [page, totalPages]);

	useEffect(() => {
		if (!selected && drawerMode !== 'create') return undefined;
		const onKeyDown = (event) => {
			if (event.key === 'Escape') {
				setSelectedId('');
				setDrawerMode('view');
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [selected, drawerMode]);

	const openView = (id) => {
		setSelectedId(id);
		setDrawerMode('view');
	};

	const openEdit = (id) => {
		const model = models.find((item) => item.id === id);
		if (!model) return;
		setSelectedId(id);
		setForm(modelToForm(model));
		setDrawerMode('edit');
	};

	const openCreate = () => {
		setSelectedId('');
		setForm({
			...EMPTY_FORM,
			providerId: provider || providers[0]?.id || '',
		});
		setDrawerMode('create');
	};

	const closeDrawer = () => {
		setSelectedId('');
		setDrawerMode('view');
	};

	const toggleCapabilityTag = (tag) => {
		setForm((prev) => {
			const list = prev.capabilities || [];
			return {
				...prev,
				capabilities: list.includes(tag) ? list.filter((item) => item !== tag) : [...list, tag],
			};
		});
	};

	const runAction = async (path, method = 'POST') => {
		const response = await apiServerClient.fetch(path, { method });
		if (!response.ok) throw new Error(await readApiError(response));
		return response.json();
	};

	const toggleEnabled = async (model) => {
		try {
			const next = await runAction(`/admin/v1/models/${model.id}/${model.status === 'enabled' ? 'disable' : 'enable'}`);
			upsertLocal(next);
			toast({
				title: next.status === 'enabled' ? 'Model enabled' : 'Model disabled',
				description: next.name,
			});
		} catch (err) {
			toast({ variant: 'destructive', title: 'Update failed', description: err?.message });
		}
	};

	const setDefault = async (model) => {
		try {
			const next = await runAction(`/admin/v1/models/${model.id}/default`);
			upsertLocal(next);
			toast({ title: 'Default updated', description: `${next.name} is now the default ${next.capability} model.` });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Update failed', description: err?.message });
		}
	};

	const removeModel = async (model) => {
		if (!window.confirm(`Delete model "${model.name}"?`)) return;
		try {
			await runAction(`/admin/v1/models/${model.id}`, 'DELETE');
			setModels((prev) => prev.filter((item) => item.id !== model.id));
			closeDrawer();
			toast({ title: 'Model deleted', description: model.name });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Delete failed', description: err?.message });
		}
	};

	const saveForm = async () => {
		setSaving(true);
		try {
			const payload = {
				providerId: form.providerId,
				modelId: form.modelId.trim(),
				displayName: form.displayName.trim() || form.modelId.trim(),
				capability: form.capability,
				contextWindow: Number(form.contextWindow) || 0,
				inputPricing: form.inputPricing === '' ? 0 : Number(form.inputPricing),
				outputPricing: form.outputPricing === '' ? null : Number(form.outputPricing),
				pricingUnit: form.pricingUnit,
				supportsVision: form.supportsVision,
				supportsStreaming: form.supportsStreaming,
				supportsFunctionCalling: form.supportsFunctionCalling,
				supportsReasoning: form.supportsReasoning,
				isDefault: form.isDefault,
				enabled: form.enabled,
				priority: Number(form.priority) || 100,
				version: form.version,
				capabilities: form.capabilities,
			};

			const isCreate = drawerMode === 'create';
			const response = await apiServerClient.fetch(
				isCreate ? '/admin/v1/models' : `/admin/v1/models/${selectedId}`,
				{
					method: isCreate ? 'POST' : 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				},
			);
			if (!response.ok) throw new Error(await readApiError(response));
			const model = await response.json();
			upsertLocal(model);
			setSelectedId(model.id);
			setDrawerMode('view');
			toast({
				title: isCreate ? 'Model created' : 'Model updated',
				description: model.name,
			});
		} catch (err) {
			toast({ variant: 'destructive', title: 'Save failed', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const showDrawer = drawerMode === 'create' || Boolean(selected);

	return (
		<div>
			<AdminHero
				title="AI Models Management"
				description="Manage available AI models across all providers. Providers stay in /admin/providers — this page is models only."
				action={(
					<div className="flex flex-wrap gap-2">
						<button type="button" className="admin-btn" onClick={loadData} disabled={loading}>
							<RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Reload
						</button>
						<button type="button" className="admin-btn admin-btn--primary" onClick={openCreate}>
							<Plus size={14} /> Add model
						</button>
					</div>
				)}
			/>

			<div className="admin-stats admin-stats--compact">
				{[
					{ label: 'Total Models', value: stats.total },
					{ label: 'Active Models', value: stats.active },
					{ label: 'Disabled Models', value: stats.disabled },
					{ label: 'Default Models', value: stats.defaults },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
						<p className="admin-stat__hint">Live</p>
					</div>
				))}
			</div>

			<div className="admin-toolbar">
				<label className="min-w-[14rem] flex-1">
					<span>Search</span>
					<input
						value={search}
						onChange={(e) => { setSearch(e.target.value); setPage(1); }}
						placeholder="Model name, provider, or capability"
					/>
				</label>
				<label>
					<span>Provider</span>
					<select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }}>
						<option value="">All providers</option>
						{providerOptions.map((item) => (
							<option key={item.id} value={item.id}>{item.name}</option>
						))}
					</select>
				</label>
				<label>
					<span>Status</span>
					<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
						<option value="">All statuses</option>
						<option value="enabled">Enabled</option>
						<option value="disabled">Disabled</option>
					</select>
				</label>
				<label>
					<span>Capability</span>
					<select value={capability} onChange={(e) => { setCapability(e.target.value); setPage(1); }}>
						<option value="">All capabilities</option>
						<option value="text">Text</option>
						<option value="image">Image</option>
						{ALL_CAPABILITIES.map((item) => (
							<option key={item} value={item}>{item}</option>
						))}
					</select>
				</label>
				<label>
					<span>Context Length</span>
					<select value={contextLength} onChange={(e) => { setContextLength(e.target.value); setPage(1); }}>
						<option value="">Any length</option>
						<option value="lt32k">&lt; 32K</option>
						<option value="32k-128k">32K – 128K</option>
						<option value="128k-1m">128K – 1M</option>
						<option value="1m+">1M+</option>
					</select>
				</label>
			</div>

			{loading ? (
				<section className="admin-card"><AdminSkeleton rows={6} /></section>
			) : null}

			{!loading && error ? (
				<section className="admin-card">
					<AdminErrorState title="Unable to load models" description={error} />
					<div className="mt-3">
						<button type="button" className="admin-btn admin-btn--primary" onClick={loadData}>Retry</button>
					</div>
				</section>
			) : null}

			{!loading && !error ? (
				<section className="admin-card">
					{filtered.length === 0 ? (
						<AdminEmptyState title="No models match" description="Adjust filters or add a model for the selected provider." />
					) : (
						<div className="admin-table-wrap">
							<table className="admin-table" style={{ minWidth: '68rem' }}>
								<thead>
									<tr>
										<th>Model Name</th>
										<th>Provider</th>
										<th>Capability</th>
										<th>Context Window</th>
										<th>Input Cost</th>
										<th>Output Cost</th>
										<th>Default</th>
										<th>Status</th>
										<th>Last Updated</th>
										<th>Actions</th>
									</tr>
								</thead>
								<tbody>
									{rows.map((model) => (
										<tr
											key={model.id}
											className={selectedId === model.id ? 'is-selected' : ''}
											onClick={() => openView(model.id)}
										>
											<td className="font-medium">{model.name}</td>
											<td>{model.provider}</td>
											<td><StatusPill status={model.capability} /></td>
											<td style={{ color: 'var(--admin-muted)' }}>{formatContext(model.contextWindow)}</td>
											<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{model.inputCost}</td>
											<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{model.outputCost}</td>
											<td>{model.isDefault ? <span className="admin-pill admin-pill--green">Default</span> : <span className="admin-pill">—</span>}</td>
											<td><StatusPill status={model.status} /></td>
											<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{model.updated}</td>
											<td onClick={(event) => event.stopPropagation()}>
												<div className="flex flex-wrap gap-1">
													<button type="button" className="admin-btn" onClick={() => openView(model.id)}>
														<Eye size={12} /> View
													</button>
													<button type="button" className="admin-btn" onClick={() => openEdit(model.id)}>
														<Pencil size={12} /> Edit
													</button>
													<button type="button" className="admin-btn" onClick={() => toggleEnabled(model)}>
														{model.status === 'enabled' ? <PowerOff size={12} /> : <Power size={12} />}
														{model.status === 'enabled' ? 'Disable' : 'Enable'}
													</button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					<AdminPagination
						total={filtered.length}
						page={page}
						totalPages={totalPages}
						noun="models"
						onPrev={() => setPage((prev) => prev - 1)}
						onNext={() => setPage((prev) => prev + 1)}
					/>
				</section>
			) : null}

			{showDrawer ? (
				<div className="admin-drawer-overlay" role="dialog" aria-modal="true" aria-label="Model details" onClick={closeDrawer}>
					<aside className="admin-user-drawer admin-user-drawer--wide" onClick={(event) => event.stopPropagation()}>
						<div className="admin-user-drawer__head">
							<div>
								<p className="font-display text-xl font-semibold leading-tight">
									{drawerMode === 'create' ? 'Add model' : selected?.name}
								</p>
								<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>
									{drawerMode === 'create' ? 'Link a model to a live provider' : selected?.provider}
								</p>
								{selected && drawerMode === 'view' ? (
									<div className="mt-2 flex flex-wrap gap-2">
										<StatusPill status={selected.status} />
										<StatusPill status={selected.capability} />
										{selected.isDefault ? <span className="admin-pill admin-pill--green">Default</span> : null}
									</div>
								) : null}
							</div>
							<button type="button" className="admin-icon-btn" onClick={closeDrawer} aria-label="Close">
								<X size={16} />
							</button>
						</div>

						{drawerMode === 'view' && selected ? (
							<>
								<section className="admin-user-drawer__section">
									<h3>Model Information</h3>
									<div className="admin-meta-row"><span>Model Name</span><span>{selected.name}</span></div>
									<div className="admin-meta-row"><span>Model ID</span><span>{selected.modelId}</span></div>
									<div className="admin-meta-row"><span>Provider</span><span>{selected.provider}</span></div>
									<div className="admin-meta-row"><span>Version</span><span>{selected.version || '—'}</span></div>
									<div className="admin-meta-row"><span>Last Updated</span><span>{selected.updated}</span></div>
									<div className="admin-meta-row"><span>Default</span><span>{selected.isDefault ? 'Yes' : 'No'}</span></div>
									<div className="admin-meta-row"><span>Priority</span><span>{selected.priority}</span></div>
								</section>

								<section className="admin-user-drawer__section">
									<h3>Capabilities</h3>
									<div className="flex flex-wrap gap-2">
										{ALL_CAPABILITIES.map((item) => {
											const active = (selected.capabilities || []).includes(item);
											return (
												<span
													key={item}
													className={`admin-pill ${active ? 'admin-pill--green' : ''}`}
													style={active ? undefined : { opacity: 0.45 }}
												>
													{item}
												</span>
											);
										})}
									</div>
								</section>

								<section className="admin-user-drawer__section">
									<h3>Context Length</h3>
									<div className="admin-meta-row"><span>Context Window</span><span>{formatContext(selected.contextWindow)} tokens</span></div>
								</section>

								<section className="admin-user-drawer__section">
									<h3>Pricing</h3>
									<div className="admin-meta-row"><span>Input Cost</span><span>{selected.inputCost}</span></div>
									<div className="admin-meta-row"><span>Output Cost</span><span>{selected.outputCost}</span></div>
								</section>

								<section className="admin-user-drawer__section">
									<h3>Supported Features</h3>
									<div className="flex flex-wrap gap-2">
										{(selected.features || []).length === 0 ? (
											<span className="admin-pill">—</span>
										) : (
											(selected.features || []).map((feature) => (
												<span key={feature} className="admin-pill admin-pill--blue">{feature}</span>
											))
										)}
									</div>
								</section>

								<section className="admin-user-drawer__section">
									<h3>Recommended Tasks</h3>
									<div className="admin-list">
										{(selected.recommended || []).length === 0 ? (
											<AdminEmptyState title="No recommendations" description="Add recommendations when editing this model." />
										) : (
											(selected.recommended || []).map((task) => (
												<div key={task} className="admin-list__item">
													<span>{task}</span>
													<span>Live</span>
												</div>
											))
										)}
									</div>
								</section>

								<div className="admin-user-drawer__actions">
									<button type="button" className="admin-btn" onClick={() => openView(selected.id)}>
										<Eye size={13} /> View
									</button>
									<button type="button" className="admin-btn" onClick={() => openEdit(selected.id)}>
										<Pencil size={13} /> Edit
									</button>
									<button
										type="button"
										className="admin-btn"
										disabled={selected.status === 'enabled'}
										onClick={() => toggleEnabled(selected)}
									>
										<Power size={13} /> Enable
									</button>
									<button
										type="button"
										className="admin-btn"
										disabled={selected.status !== 'enabled'}
										onClick={() => toggleEnabled(selected)}
									>
										<PowerOff size={13} /> Disable
									</button>
									<button type="button" className="admin-btn" onClick={() => setDefault(selected)}>
										<Star size={13} /> Set as Default
									</button>
									<button type="button" className="admin-btn admin-btn--danger" onClick={() => removeModel(selected)}>
										<Trash2 size={13} /> Delete
									</button>
								</div>
							</>
						) : (
							<section className="admin-user-drawer__section">
								<h3>{drawerMode === 'create' ? 'Create Model' : 'Edit Model'}</h3>
								<p className="admin-note mt-0 mb-3">Provider list is loaded from live Admin Providers.</p>
								<div className="admin-config-grid">
									<div className="admin-field">
										<label htmlFor="model-provider">Provider</label>
										<select
											id="model-provider"
											value={form.providerId}
											onChange={(e) => setForm((prev) => ({ ...prev, providerId: e.target.value }))}
										>
											<option value="">Select provider</option>
											{providerOptions.map((item) => (
												<option key={item.id} value={item.id}>{item.name}</option>
											))}
										</select>
									</div>
									<div className="admin-field">
										<label htmlFor="model-id">Model ID</label>
										<input id="model-id" value={form.modelId} onChange={(e) => setForm((prev) => ({ ...prev, modelId: e.target.value }))} placeholder="e.g. gpt-4.1" />
									</div>
									<div className="admin-field">
										<label htmlFor="model-name">Display Name</label>
										<input id="model-name" value={form.displayName} onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))} />
									</div>
									<div className="admin-field">
										<label htmlFor="model-capability">Capability</label>
										<select id="model-capability" value={form.capability} onChange={(e) => setForm((prev) => ({ ...prev, capability: e.target.value }))}>
											<option value="text">text</option>
											<option value="image">image</option>
											<option value="vision">vision</option>
											<option value="embedding">embedding</option>
										</select>
									</div>
									<div className="admin-field">
										<label htmlFor="model-context">Context Window</label>
										<input id="model-context" value={form.contextWindow} onChange={(e) => setForm((prev) => ({ ...prev, contextWindow: e.target.value }))} />
									</div>
									<div className="admin-field">
										<label htmlFor="model-input">Input Pricing</label>
										<input id="model-input" value={form.inputPricing} onChange={(e) => setForm((prev) => ({ ...prev, inputPricing: e.target.value }))} placeholder="2.50" />
									</div>
									<div className="admin-field">
										<label htmlFor="model-output">Output Pricing</label>
										<input id="model-output" value={form.outputPricing} onChange={(e) => setForm((prev) => ({ ...prev, outputPricing: e.target.value }))} placeholder="10" />
									</div>
									<div className="admin-field">
										<label htmlFor="model-unit">Pricing Unit</label>
										<select id="model-unit" value={form.pricingUnit} onChange={(e) => setForm((prev) => ({ ...prev, pricingUnit: e.target.value }))}>
											<option value="1M">1M tokens</option>
											<option value="image">per image</option>
										</select>
									</div>
									<div className="admin-field">
										<label htmlFor="model-priority">Priority</label>
										<input id="model-priority" value={form.priority} onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))} />
									</div>
									<div className="admin-field">
										<label htmlFor="model-version">Version</label>
										<input id="model-version" value={form.version} onChange={(e) => setForm((prev) => ({ ...prev, version: e.target.value }))} />
									</div>
								</div>

								<div className="mt-3 flex flex-wrap gap-3">
									<label className="admin-check"><input type="checkbox" checked={form.supportsVision} onChange={(e) => setForm((prev) => ({ ...prev, supportsVision: e.target.checked }))} /> Vision</label>
									<label className="admin-check"><input type="checkbox" checked={form.supportsStreaming} onChange={(e) => setForm((prev) => ({ ...prev, supportsStreaming: e.target.checked }))} /> Streaming</label>
									<label className="admin-check"><input type="checkbox" checked={form.supportsFunctionCalling} onChange={(e) => setForm((prev) => ({ ...prev, supportsFunctionCalling: e.target.checked }))} /> Function calling</label>
									<label className="admin-check"><input type="checkbox" checked={form.supportsReasoning} onChange={(e) => setForm((prev) => ({ ...prev, supportsReasoning: e.target.checked }))} /> Reasoning</label>
									<label className="admin-check"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((prev) => ({ ...prev, isDefault: e.target.checked }))} /> Default</label>
									<label className="admin-check"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))} /> Enabled</label>
								</div>

								<div className="mt-4">
									<p className="admin-note mt-0 mb-2">Capability tags</p>
									<div className="flex flex-wrap gap-2">
										{ALL_CAPABILITIES.map((item) => {
											const active = (form.capabilities || []).includes(item);
											return (
												<button
													key={item}
													type="button"
													className={`admin-pill ${active ? 'admin-pill--green' : ''}`}
													onClick={() => toggleCapabilityTag(item)}
												>
													{item}
												</button>
											);
										})}
									</div>
								</div>

								<div className="mt-4 flex flex-wrap gap-2">
									<button type="button" className="admin-btn admin-btn--primary" onClick={saveForm} disabled={saving}>
										{saving ? <Loader2 size={13} className="animate-spin" /> : null}
										{saving ? 'Saving…' : 'Save model'}
									</button>
									<button type="button" className="admin-btn" onClick={closeDrawer}>Cancel</button>
								</div>
							</section>
						)}
					</aside>
				</div>
			) : null}
		</div>
	);
}
