import { useEffect, useMemo, useState } from 'react';
import {
	Eye, Pencil, Ban, CheckCircle2, Trash2, X, ArrowLeftRight,
} from 'lucide-react';
import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import { MOCK_WORKSPACES } from '@/pages/admin/mockData';

const PAGE_SIZE = 6;
const BACKEND_READY = false;

function daysAgo(isoDate) {
	const created = new Date(`${isoDate}T00:00:00`);
	if (Number.isNaN(created.getTime())) return Infinity;
	return (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
}

function boolPill(value) {
	return value ? 'connected' : 'disconnected';
}

function matchesCreditsRange(credits, range) {
	const value = Number(credits || 0);
	if (!range) return true;
	if (range === '0') return value === 0;
	if (range === '1-1k') return value > 0 && value <= 1000;
	if (range === '1k-5k') return value > 1000 && value <= 5000;
	if (range === '5k+') return value > 5000;
	return true;
}

export default function AdminWorkspacesPage() {
	const [search, setSearch] = useState('');
	const [plan, setPlan] = useState('');
	const [status, setStatus] = useState('');
	const [createdWithin, setCreatedWithin] = useState('');
	const [creditsRange, setCreditsRange] = useState('');
	const [page, setPage] = useState(1);
	const [selectedId, setSelectedId] = useState('');

	const stats = useMemo(() => {
		const total = MOCK_WORKSPACES.length;
		const active = MOCK_WORKSPACES.filter((ws) => ws.status === 'active').length;
		const suspended = MOCK_WORKSPACES.filter((ws) => ws.status === 'suspended').length;
		const newer = MOCK_WORKSPACES.filter((ws) => daysAgo(ws.created) <= 30).length;
		return { total, active, suspended, newer };
	}, []);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return MOCK_WORKSPACES.filter((ws) => {
			if (plan && ws.plan !== plan) return false;
			if (status && ws.status !== status) return false;
			if (createdWithin === '7' && daysAgo(ws.created) > 7) return false;
			if (createdWithin === '30' && daysAgo(ws.created) > 30) return false;
			if (createdWithin === '90' && daysAgo(ws.created) > 90) return false;
			if (!matchesCreditsRange(ws.credits, creditsRange)) return false;
			if (!q) return true;
			const domains = (ws.websites || []).map((site) => site.domain).join(' ');
			const haystack = [ws.name, ws.owner, ws.ownerEmail, domains].join(' ').toLowerCase();
			return haystack.includes(q);
		});
	}, [search, plan, status, createdWithin, creditsRange]);

	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
	const selected = MOCK_WORKSPACES.find((ws) => ws.id === selectedId) || null;

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

	const storagePct = selected
		? Math.min(100, Math.round((Number(selected.storageUsedGb || 0) / Math.max(1, Number(selected.storageLimitGb || 1))) * 100))
		: 0;

	return (
		<div>
			<AdminHero
				title="Workspaces Management"
				description="Manage customer workspaces across the platform. Mock data only — mutation actions stay disabled until admin APIs exist."
			/>

			<div className="admin-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
				{[
					{ label: 'Total Workspaces', value: stats.total },
					{ label: 'Active Workspaces', value: stats.active },
					{ label: 'Suspended Workspaces', value: stats.suspended },
					{ label: 'New Workspaces (30 days)', value: stats.newer },
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
						placeholder="Workspace, owner, email, or domain"
					/>
				</label>
				<label>
					<span>Plan</span>
					<select value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1); }}>
						<option value="">All plans</option>
						<option value="free">Free</option>
						<option value="starter">Starter</option>
						<option value="pro">Pro</option>
						<option value="agency">Agency</option>
					</select>
				</label>
				<label>
					<span>Status</span>
					<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
						<option value="">All statuses</option>
						<option value="active">Active</option>
						<option value="trial">Trial</option>
						<option value="suspended">Suspended</option>
					</select>
				</label>
				<label>
					<span>Created Date</span>
					<select value={createdWithin} onChange={(e) => { setCreatedWithin(e.target.value); setPage(1); }}>
						<option value="">Any time</option>
						<option value="7">Last 7 days</option>
						<option value="30">Last 30 days</option>
						<option value="90">Last 90 days</option>
					</select>
				</label>
				<label>
					<span>Credits Range</span>
					<select value={creditsRange} onChange={(e) => { setCreditsRange(e.target.value); setPage(1); }}>
						<option value="">Any credits</option>
						<option value="0">0</option>
						<option value="1-1k">1 – 1,000</option>
						<option value="1k-5k">1,001 – 5,000</option>
						<option value="5k+">5,000+</option>
					</select>
				</label>
			</div>

			<section className="admin-card">
				<div className="admin-table-wrap">
					<table className="admin-table" style={{ minWidth: '72rem' }}>
						<thead>
							<tr>
								<th>Workspace</th>
								<th>Owner</th>
								<th>Email</th>
								<th>Plan</th>
								<th>Credits Remaining</th>
								<th>Connected Websites</th>
								<th>Pinterest Connected</th>
								<th>WordPress Connected</th>
								<th>Status</th>
								<th>Created Date</th>
								<th>Last Activity</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((ws) => (
								<tr
									key={ws.id}
									className={selectedId === ws.id ? 'is-selected' : ''}
									onClick={() => setSelectedId(ws.id)}
								>
									<td className="font-medium">{ws.name}</td>
									<td>{ws.owner}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{ws.ownerEmail}</td>
									<td><StatusPill status={ws.plan} /></td>
									<td>{Number(ws.credits || 0).toLocaleString()}</td>
									<td>{(ws.websites || []).length}</td>
									<td><StatusPill status={boolPill(ws.pinterestConnected)} /></td>
									<td><StatusPill status={boolPill(ws.wordpressConnected)} /></td>
									<td><StatusPill status={ws.status} /></td>
									<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{ws.created}</td>
									<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{ws.lastActivity || '—'}</td>
									<td onClick={(event) => event.stopPropagation()}>
										<div className="flex flex-wrap gap-1">
											<button type="button" className="admin-btn" onClick={() => setSelectedId(ws.id)}>
												<Eye size={12} /> View
											</button>
											<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
												<Pencil size={12} /> Edit
											</button>
											<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
												{ws.status === 'suspended' ? <CheckCircle2 size={12} /> : <Ban size={12} />}
												{ws.status === 'suspended' ? 'Activate' : 'Suspend'}
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{filtered.length === 0 ? (
					<p className="admin-note">No workspaces match the current filters.</p>
				) : (
					<div className="mt-3 flex items-center justify-between gap-2">
						<p className="admin-note m-0">{filtered.length} workspaces · page {page} of {totalPages}</p>
						<div className="flex gap-2">
							<button type="button" className="admin-btn" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>Previous</button>
							<button type="button" className="admin-btn" disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>Next</button>
						</div>
					</div>
				)}
			</section>

			{selected ? (
				<div className="admin-drawer-overlay" role="dialog" aria-modal="true" aria-label="Workspace details" onClick={() => setSelectedId('')}>
					<aside className="admin-user-drawer" onClick={(event) => event.stopPropagation()}>
						<div className="admin-user-drawer__head">
							<div>
								<p className="font-display text-xl font-semibold leading-tight">{selected.name}</p>
								<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.ownerEmail}</p>
								<div className="mt-2 flex flex-wrap gap-2">
									<StatusPill status={selected.status} />
									<StatusPill status={selected.plan} />
								</div>
							</div>
							<button type="button" className="admin-icon-btn" onClick={() => setSelectedId('')} aria-label="Close">
								<X size={16} />
							</button>
						</div>

						<section className="admin-user-drawer__section">
							<h3>Workspace Information</h3>
							<div className="admin-meta-row"><span>Name</span><span>{selected.name}</span></div>
							<div className="admin-meta-row"><span>Created</span><span>{selected.created}</span></div>
							<div className="admin-meta-row"><span>Last activity</span><span>{selected.lastActivity || '—'}</span></div>
							<div className="admin-meta-row"><span>Status</span><StatusPill status={selected.status} /></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Owner Information</h3>
							<div className="admin-meta-row"><span>Owner</span><span>{selected.owner}</span></div>
							<div className="admin-meta-row"><span>Email</span><span>{selected.ownerEmail}</span></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Subscription</h3>
							<div className="admin-meta-row"><span>Plan</span><span>{selected.subscription?.plan || selected.plan}</span></div>
							<div className="admin-meta-row"><span>Renews</span><span>{selected.subscription?.renews || '—'}</span></div>
							<div className="admin-meta-row"><span>Seats</span><span>{selected.subscription?.seats ?? '—'}</span></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Credits Usage</h3>
							<div className="admin-meta-row"><span>Remaining</span><span>{Number(selected.credits || 0).toLocaleString()}</span></div>
							<div className="admin-meta-row"><span>Used</span><span>{Number(selected.creditsUsed || 0).toLocaleString()}</span></div>
							<div className="admin-meta-row"><span>Ledger</span><span>Placeholder</span></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Connected Websites</h3>
							{(selected.websites || []).length ? (
								<div className="admin-list">
									{selected.websites.map((site) => (
										<div key={site.domain} className="admin-list__item">
											<span>{site.domain}</span>
											<StatusPill status={site.status} />
										</div>
									))}
								</div>
							) : (
								<p className="admin-note m-0">No websites connected.</p>
							)}
						</section>

						<section className="admin-user-drawer__section">
							<h3>Pinterest Accounts</h3>
							{(selected.pinterestAccounts || []).length ? (
								<div className="admin-list">
									{selected.pinterestAccounts.map((account) => (
										<div key={account.name} className="admin-list__item">
											<span>{account.name} · {account.boards} boards</span>
											<StatusPill status={account.status} />
										</div>
									))}
								</div>
							) : (
								<p className="admin-note m-0">No Pinterest accounts linked.</p>
							)}
						</section>

						<section className="admin-user-drawer__section">
							<h3>WordPress Connections</h3>
							{(selected.wordpressConnections || []).length ? (
								<div className="admin-list">
									{selected.wordpressConnections.map((conn) => (
										<div key={conn.site} className="admin-list__item">
											<span>{conn.site}</span>
											<StatusPill status={conn.status} />
										</div>
									))}
								</div>
							) : (
								<p className="admin-note m-0">No WordPress connections.</p>
							)}
						</section>

						<section className="admin-user-drawer__section">
							<h3>Recent Publishing Activity</h3>
							<div className="admin-list">
								{(selected.publishing || []).map((item) => (
									<div key={`${item.text}-${item.time}`} className="admin-list__item">
										<span>{item.text}</span>
										<span>{item.time}</span>
									</div>
								))}
							</div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Storage Usage</h3>
							<div className="admin-meta-row">
								<span>Used</span>
								<span>{selected.storageUsedGb} GB / {selected.storageLimitGb} GB</span>
							</div>
							<div className="admin-bar-track mt-2">
								<div className="admin-bar-fill" style={{ width: `${storagePct}%` }} />
							</div>
							<p className="admin-note">{storagePct}% of allocated storage (mock)</p>
						</section>

						<div className="admin-user-drawer__actions">
							<button type="button" className="admin-btn" onClick={() => {}}>
								<Eye size={13} /> View
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<Pencil size={13} /> Edit
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<Ban size={13} /> Suspend Workspace
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<CheckCircle2 size={13} /> Activate Workspace
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<ArrowLeftRight size={13} /> Transfer Ownership
							</button>
							<button type="button" className="admin-btn admin-btn--danger" disabled={!BACKEND_READY} title="Backend not available">
								<Trash2 size={13} /> Delete Workspace
							</button>
						</div>
						<p className="admin-note">Mutation actions stay disabled until Admin Console APIs are implemented.</p>
					</aside>
				</div>
			) : null}
		</div>
	);
}
