import { useCallback, useEffect, useState } from 'react';
import {
	Eye, Pencil, Ban, CheckCircle2, Trash2, X, ArrowLeftRight, Loader2,
} from 'lucide-react';
import { AdminHero, StatusPill, AdminPagination, AdminEmptyState } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 6;

function boolPill(value) {
	return value ? 'connected' : 'disconnected';
}

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

export default function AdminWorkspacesPage() {
	const { toast } = useToast();
	const [search, setSearch] = useState('');
	const [plan, setPlan] = useState('');
	const [status, setStatus] = useState('');
	const [createdWithin, setCreatedWithin] = useState('');
	const [creditsRange, setCreditsRange] = useState('');
	const [page, setPage] = useState(1);
	const [selectedId, setSelectedId] = useState('');
	const [selected, setSelected] = useState(null);
	const [rows, setRows] = useState([]);
	const [totalItems, setTotalItems] = useState(0);
	const [totalPages, setTotalPages] = useState(1);
	const [stats, setStats] = useState({ total: 0, active: 0, suspended: 0, newer: 0 });
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams({
				page: String(page),
				perPage: String(PAGE_SIZE),
			});
			if (search.trim()) params.set('q', search.trim());
			if (plan) params.set('plan', plan);
			if (status) params.set('status', status);
			if (createdWithin) params.set('createdWithin', createdWithin);
			if (creditsRange) params.set('creditsRange', creditsRange);
			const response = await apiServerClient.fetch(`/admin/v1/workspaces?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setRows(Array.isArray(payload.items) ? payload.items : []);
			setTotalItems(Number(payload.totalItems) || 0);
			setTotalPages(Math.max(1, Number(payload.totalPages) || 1));
			setStats({
				total: payload.summary?.total ?? payload.totalItems ?? 0,
				active: payload.summary?.active ?? 0,
				suspended: payload.summary?.suspended ?? 0,
				newer: payload.summary?.newer ?? 0,
			});
		} catch (error) {
			toast({ variant: 'destructive', title: 'Workspaces load failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [page, search, plan, status, createdWithin, creditsRange, toast]);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(() => {
		if (page > totalPages) setPage(totalPages);
	}, [page, totalPages]);

	useEffect(() => {
		if (!selectedId) {
			setSelected(null);
			return undefined;
		}
		let cancelled = false;
		apiServerClient.fetch(`/admin/v1/workspaces/${selectedId}`)
			.then(async (response) => {
				if (!response.ok) throw new Error(await readApiError(response));
				const payload = await response.json();
				if (!cancelled) setSelected(payload);
			})
			.catch((error) => {
				toast({ variant: 'destructive', title: 'Workspace detail failed', description: error.message });
			});
		const onKeyDown = (event) => {
			if (event.key === 'Escape') setSelectedId('');
		};
		window.addEventListener('keydown', onKeyDown);
		return () => {
			cancelled = true;
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [selectedId, toast]);

	const runAction = async (id, path, method = 'POST', body) => {
		const target = id || selectedId;
		if (!target) return;
		setBusy(true);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/workspaces/${target}${path}`, {
				method,
				headers: body ? { 'Content-Type': 'application/json' } : undefined,
				body: body ? JSON.stringify(body) : undefined,
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Workspace updated' });
			await load();
			if (method === 'DELETE') setSelectedId('');
			else if (selectedId === target) {
				const detail = await apiServerClient.fetch(`/admin/v1/workspaces/${target}`);
				if (detail.ok) setSelected(await detail.json());
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Action failed', description: error.message });
		} finally {
			setBusy(false);
		}
	};

	const storagePct = selected
		? Math.min(100, Math.round((Number(selected.storageUsedGb || 0) / Math.max(1, Number(selected.storageLimitGb || 1))) * 100))
		: 0;

	return (
		<div>
			<AdminHero
				title="Workspaces Management"
				description="Manage customer workspaces across the platform from live PocketBase records."
			/>

			<div className="admin-stats admin-stats--compact">
				{[
					{ label: 'Total Workspaces', value: stats.total },
					{ label: 'Active Workspaces', value: stats.active },
					{ label: 'Suspended Workspaces', value: stats.suspended },
					{ label: 'New Workspaces (30 days)', value: stats.newer },
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
				{loading ? (
					<p className="admin-note flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading workspaces…</p>
				) : null}
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
									<td>{ws.websiteCount ?? (ws.websites || []).length}</td>
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
											<button type="button" className="admin-btn" disabled={busy} onClick={() => setSelectedId(ws.id)}>
												<Pencil size={12} /> Edit
											</button>
											<button
												type="button"
												className="admin-btn"
												disabled={busy}
												onClick={() => runAction(ws.id, ws.status === 'suspended' ? '/activate' : '/suspend')}
											>
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

				{!loading && rows.length === 0 ? (
					<AdminEmptyState title="No workspaces found" description="Adjust filters or create a workspace from the app." />
				) : null}

				<AdminPagination
					total={totalItems}
					page={page}
					totalPages={totalPages}
					noun="workspaces"
					onPrev={() => setPage((prev) => prev - 1)}
					onNext={() => setPage((prev) => prev + 1)}
				/>
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
							<div className="admin-meta-row"><span>Ledger</span><span>See Credits page</span></div>
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
								<AdminEmptyState title="No websites" description="No websites connected on this workspace." />
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
								<AdminEmptyState title="No Pinterest accounts" description="No Pinterest accounts linked on this workspace." />
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
								<AdminEmptyState title="No WordPress connections" description="No WordPress connections on this workspace." />
							)}
						</section>

						<section className="admin-user-drawer__section">
							<h3>Recent Publishing Activity</h3>
							<div className="admin-list">
								{(selected.publishing || []).length ? selected.publishing.map((item) => (
									<div key={`${item.text}-${item.time}`} className="admin-list__item">
										<span>{item.text}</span>
										<span>{item.time}</span>
									</div>
								)) : (
									<div className="admin-list__item"><span>No recent publishing</span><span>—</span></div>
								)}
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
							<p className="admin-note">{storagePct}% of allocated storage</p>
						</section>

						<div className="admin-user-drawer__actions">
							<button type="button" className="admin-btn" onClick={() => {}}>
								<Eye size={13} /> View
							</button>
							<button type="button" className="admin-btn" disabled={busy} onClick={() => toast({ title: 'Edit', description: 'Use PATCH /workspaces/:id for field updates.' })}>
								<Pencil size={13} /> Edit
							</button>
							<button type="button" className="admin-btn" disabled={busy} onClick={() => runAction(selected.id, '/suspend')}>
								<Ban size={13} /> Suspend Workspace
							</button>
							<button type="button" className="admin-btn" disabled={busy} onClick={() => runAction(selected.id, '/activate')}>
								<CheckCircle2 size={13} /> Activate Workspace
							</button>
							<button
								type="button"
								className="admin-btn"
								disabled={busy}
								onClick={() => {
									const newOwnerUserId = window.prompt('New owner user id');
									if (newOwnerUserId) runAction(selected.id, '/transfer', 'POST', { newOwnerUserId });
								}}
							>
								<ArrowLeftRight size={13} /> Transfer Ownership
							</button>
							<button type="button" className="admin-btn admin-btn--danger" disabled={busy} onClick={() => runAction(selected.id, '', 'DELETE')}>
								<Trash2 size={13} /> Delete Workspace
							</button>
						</div>
						<p className="admin-note">Mutations write to PocketBase workspaces and audit logs.</p>
					</aside>
				</div>
			) : null}
		</div>
	);
}
