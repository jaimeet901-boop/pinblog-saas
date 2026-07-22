import { useEffect, useMemo, useState } from 'react';
import {
	Eye, Pencil, Power, PowerOff, Star, Trash2, X,
} from 'lucide-react';
import { AdminHero, StatusPill, AdminPagination } from '@/components/admin/AdminUi';
import { MOCK_MODELS } from '@/pages/admin/mockData';

const PAGE_SIZE = 6;
const BACKEND_READY = false;

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

export default function AdminModelsPage() {
	const [search, setSearch] = useState('');
	const [provider, setProvider] = useState('');
	const [status, setStatus] = useState('');
	const [capability, setCapability] = useState('');
	const [contextLength, setContextLength] = useState('');
	const [page, setPage] = useState(1);
	const [selectedId, setSelectedId] = useState('');

	const providerOptions = useMemo(
		() => [...new Set(MOCK_MODELS.map((model) => model.provider))].sort(),
		[],
	);

	const stats = useMemo(() => {
		const total = MOCK_MODELS.length;
		const active = MOCK_MODELS.filter((model) => model.status === 'enabled').length;
		const disabled = MOCK_MODELS.filter((model) => model.status === 'disabled').length;
		const defaults = MOCK_MODELS.filter((model) => model.isDefault).length;
		return { total, active, disabled, defaults };
	}, []);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return MOCK_MODELS.filter((model) => {
			if (provider && model.provider !== provider) return false;
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
				model.provider,
				model.capability,
				...(model.capabilities || []),
			].join(' ').toLowerCase();
			return haystack.includes(q);
		});
	}, [search, provider, status, capability, contextLength]);

	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
	const selected = MOCK_MODELS.find((model) => model.id === selectedId) || null;

	useEffect(() => {
		if (page > totalPages) setPage(totalPages);
	}, [page, totalPages]);

	useEffect(() => {
		if (!selected) return undefined;
		const onKeyDown = (event) => {
			if (event.key === 'Escape') setSelectedId('');
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [selected]);

	return (
		<div>
			<AdminHero
				title="AI Models Management"
				description="Manage available AI models across all providers. Providers stay in /admin/providers — this page is models only."
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
						<p className="admin-stat__hint">Placeholder</p>
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
						{providerOptions.map((name) => (
							<option key={name} value={name}>{name}</option>
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

			<section className="admin-card">
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
									onClick={() => setSelectedId(model.id)}
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
											<button type="button" className="admin-btn" onClick={() => setSelectedId(model.id)}>
												<Eye size={12} /> View
											</button>
											<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
												<Pencil size={12} /> Edit
											</button>
											<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
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

				<AdminPagination
					total={filtered.length}
					page={page}
					totalPages={totalPages}
					noun="models"
					onPrev={() => setPage((prev) => prev - 1)}
					onNext={() => setPage((prev) => prev + 1)}
				/>
			</section>

			{selected ? (
				<div className="admin-drawer-overlay" role="dialog" aria-modal="true" aria-label="Model details" onClick={() => setSelectedId('')}>
					<aside className="admin-user-drawer admin-user-drawer--wide" onClick={(event) => event.stopPropagation()}>
						<div className="admin-user-drawer__head">
							<div>
								<p className="font-display text-xl font-semibold leading-tight">{selected.name}</p>
								<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.provider}</p>
								<div className="mt-2 flex flex-wrap gap-2">
									<StatusPill status={selected.status} />
									<StatusPill status={selected.capability} />
									{selected.isDefault ? <span className="admin-pill admin-pill--green">Default</span> : null}
								</div>
							</div>
							<button type="button" className="admin-icon-btn" onClick={() => setSelectedId('')} aria-label="Close">
								<X size={16} />
							</button>
						</div>

						<section className="admin-user-drawer__section">
							<h3>Model Information</h3>
							<div className="admin-meta-row"><span>Model Name</span><span>{selected.name}</span></div>
							<div className="admin-meta-row"><span>Provider</span><span>{selected.provider}</span></div>
							<div className="admin-meta-row"><span>Version</span><span>{selected.version}</span></div>
							<div className="admin-meta-row"><span>Last Updated</span><span>{selected.updated}</span></div>
							<div className="admin-meta-row"><span>Default</span><span>{selected.isDefault ? 'Yes' : 'No'}</span></div>
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
								{(selected.features || []).map((feature) => (
									<span key={feature} className="admin-pill admin-pill--blue">{feature}</span>
								))}
							</div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Recommended Tasks</h3>
							<div className="admin-list">
								{(selected.recommended || []).map((task) => (
									<div key={task} className="admin-list__item">
										<span>{task}</span>
										<span>Mock</span>
									</div>
								))}
							</div>
						</section>

						<div className="admin-user-drawer__actions">
							<button type="button" className="admin-btn" onClick={() => {}}>
								<Eye size={13} /> View
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<Pencil size={13} /> Edit
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<Power size={13} /> Enable
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<PowerOff size={13} /> Disable
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<Star size={13} /> Set as Default
							</button>
							<button type="button" className="admin-btn admin-btn--danger" disabled={!BACKEND_READY} title="Backend not available">
								<Trash2 size={13} /> Delete
							</button>
						</div>
						<p className="admin-note">Mutation actions stay disabled until Admin Console APIs are implemented.</p>
					</aside>
				</div>
			) : null}
		</div>
	);
}
