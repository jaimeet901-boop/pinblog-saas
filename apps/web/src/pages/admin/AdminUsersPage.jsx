import { useCallback, useEffect, useState } from 'react';
import {
	Eye, Pencil, Ban, CheckCircle2, KeyRound, Trash2, X, Loader2,
} from 'lucide-react';
import { AdminHero, StatusPill, AdminPagination, AdminEmptyState } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 6;

function initials(name = '') {
	return String(name)
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() || '')
		.join('') || '?';
}

function Avatar({ name, large }) {
	return <span className={`admin-avatar ${large ? 'admin-avatar--lg' : ''}`} aria-hidden="true">{initials(name)}</span>;
}

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

export default function AdminUsersPage() {
	const { toast } = useToast();
	const [search, setSearch] = useState('');
	const [role, setRole] = useState('');
	const [status, setStatus] = useState('');
	const [plan, setPlan] = useState('');
	const [registeredWithin, setRegisteredWithin] = useState('');
	const [page, setPage] = useState(1);
	const [selectedId, setSelectedId] = useState('');
	const [selected, setSelected] = useState(null);
	const [rows, setRows] = useState([]);
	const [totalItems, setTotalItems] = useState(0);
	const [totalPages, setTotalPages] = useState(1);
	const [stats, setStats] = useState({ total: 0, active: 0, admins: 0, newUsers: 0 });
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
			if (role) params.set('role', role);
			if (status) params.set('status', status);
			if (plan) params.set('plan', plan);
			if (registeredWithin) params.set('registeredWithin', registeredWithin);
			const response = await apiServerClient.fetch(`/admin/v1/users?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setRows(Array.isArray(payload.items) ? payload.items : []);
			setTotalItems(Number(payload.totalItems) || 0);
			setTotalPages(Math.max(1, Number(payload.totalPages) || 1));
			setStats({
				total: payload.summary?.total ?? payload.totalItems ?? 0,
				active: payload.summary?.active ?? 0,
				admins: payload.summary?.admins ?? 0,
				newUsers: payload.summary?.newUsers ?? 0,
			});
		} catch (error) {
			toast({ variant: 'destructive', title: 'Users load failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [page, search, role, status, plan, registeredWithin, toast]);

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
		apiServerClient.fetch(`/admin/v1/users/${selectedId}`)
			.then(async (response) => {
				if (!response.ok) throw new Error(await readApiError(response));
				const payload = await response.json();
				if (!cancelled) setSelected(payload);
			})
			.catch((error) => {
				toast({ variant: 'destructive', title: 'User detail failed', description: error.message });
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

	const runAction = async (path, method = 'POST', userId = selectedId) => {
		const target = userId || selectedId;
		if (!target) return;
		setBusy(true);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/users/${target}${path}`, { method });
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'User updated' });
			await load();
			if (method !== 'DELETE') {
				const detail = await apiServerClient.fetch(`/admin/v1/users/${target}`);
				if (detail.ok) {
					setSelectedId(target);
					setSelected(await detail.json());
				}
			} else {
				setSelectedId('');
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Action failed', description: error.message });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div>
			<AdminHero
				title="Users Management"
				description="Manage platform users and workspace owners from live PocketBase records."
			/>

			<div className="admin-stats admin-stats--compact">
				{[
					{ label: 'Total Users', value: stats.total },
					{ label: 'Active Users', value: stats.active },
					{ label: 'Admins', value: stats.admins },
					{ label: 'New Users (30 days)', value: stats.newUsers },
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
						placeholder="Name, email, or workspace"
					/>
				</label>
				<label>
					<span>Role</span>
					<select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
						<option value="">All roles</option>
						<option value="admin">Admin</option>
						<option value="user">User</option>
					</select>
				</label>
				<label>
					<span>Status</span>
					<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
						<option value="">All statuses</option>
						<option value="active">Active</option>
						<option value="invited">Invited</option>
						<option value="suspended">Suspended</option>
					</select>
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
					<span>Registration Date</span>
					<select value={registeredWithin} onChange={(e) => { setRegisteredWithin(e.target.value); setPage(1); }}>
						<option value="">Any time</option>
						<option value="7">Last 7 days</option>
						<option value="30">Last 30 days</option>
						<option value="90">Last 90 days</option>
					</select>
				</label>
			</div>

			<section className="admin-card">
				{loading ? (
					<p className="admin-note flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading users…</p>
				) : null}
				<div className="admin-table-wrap">
					<table className="admin-table" style={{ minWidth: '64rem' }}>
						<thead>
							<tr>
								<th>Avatar</th>
								<th>Full Name</th>
								<th>Email</th>
								<th>Role</th>
								<th>Plan</th>
								<th>Credits</th>
								<th>Workspaces</th>
								<th>Status</th>
								<th>Created Date</th>
								<th>Last Login</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((user) => (
								<tr
									key={user.id}
									className={selectedId === user.id ? 'is-selected' : ''}
									onClick={() => setSelectedId(user.id)}
								>
									<td><Avatar name={user.name} /></td>
									<td className="font-medium">{user.name}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{user.email}</td>
									<td><StatusPill status={user.role} /></td>
									<td><StatusPill status={user.plan} /></td>
									<td>{Number(user.credits || 0).toLocaleString()}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{user.workspaceCount ?? (user.workspaces || []).length}</td>
									<td><StatusPill status={user.status} /></td>
									<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{user.created}</td>
									<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{user.lastLogin || '—'}</td>
									<td onClick={(event) => event.stopPropagation()}>
										<div className="flex flex-wrap gap-1">
											<button type="button" className="admin-btn" onClick={() => setSelectedId(user.id)}>
												<Eye size={12} /> View
											</button>
											<button type="button" className="admin-btn" disabled={busy} onClick={() => setSelectedId(user.id)}>
												<Pencil size={12} /> Edit
											</button>
											<button
												type="button"
												className="admin-btn"
												disabled={busy}
												onClick={() => runAction(user.status === 'suspended' ? '/activate' : '/suspend', 'POST', user.id)}
											>
												{user.status === 'suspended' ? <CheckCircle2 size={12} /> : <Ban size={12} />}
												{user.status === 'suspended' ? 'Activate' : 'Suspend'}
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{!loading && rows.length === 0 ? (
					<AdminEmptyState title="No users found" description="Adjust filters or wait for registrations." />
				) : null}

				<AdminPagination
					total={totalItems}
					page={page}
					totalPages={totalPages}
					noun="users"
					onPrev={() => setPage((prev) => prev - 1)}
					onNext={() => setPage((prev) => prev + 1)}
				/>
			</section>

			{selected ? (
				<div className="admin-drawer-overlay" role="dialog" aria-modal="true" aria-label="User details" onClick={() => setSelectedId('')}>
					<aside className="admin-user-drawer" onClick={(event) => event.stopPropagation()}>
						<div className="admin-user-drawer__head">
							<div className="flex items-center gap-3">
								<Avatar name={selected.name} large />
								<div>
									<p className="font-display text-xl font-semibold leading-tight">{selected.name}</p>
									<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.email}</p>
									<div className="mt-2 flex flex-wrap gap-2">
										<StatusPill status={selected.role} />
										<StatusPill status={selected.status} />
										<StatusPill status={selected.plan} />
									</div>
								</div>
							</div>
							<button type="button" className="admin-icon-btn" onClick={() => setSelectedId('')} aria-label="Close">
								<X size={16} />
							</button>
						</div>

						<section className="admin-user-drawer__section">
							<h3>Profile</h3>
							<div className="admin-meta-row"><span>Full name</span><span>{selected.name}</span></div>
							<div className="admin-meta-row"><span>Email</span><span>{selected.email}</span></div>
							<div className="admin-meta-row"><span>Created</span><span>{selected.created}</span></div>
							<div className="admin-meta-row"><span>Last login</span><span>{selected.lastLogin || '—'}</span></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Workspace list</h3>
							{(selected.workspaces || []).length ? (
								<div className="admin-list">
									{selected.workspaces.map((workspace) => (
										<div key={workspace} className="admin-list__item">
											<span>{workspace}</span>
											<span>Owner</span>
										</div>
									))}
								</div>
							) : (
								<AdminEmptyState title="No workspaces" description="No workspaces on this profile." />
							)}
						</section>

						<section className="admin-user-drawer__section">
							<h3>Credits</h3>
							<div className="admin-meta-row"><span>Available</span><span>{Number(selected.credits || 0).toLocaleString()}</span></div>
							<div className="admin-meta-row"><span>Ledger</span><span>See Credits page</span></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Subscription</h3>
							<div className="admin-meta-row"><span>Plan</span><span>{selected.subscription?.plan || selected.plan}</span></div>
							<div className="admin-meta-row"><span>Renews</span><span>{selected.subscription?.renews || '—'}</span></div>
							<div className="admin-meta-row"><span>Seats</span><span>{selected.subscription?.seats ?? '—'}</span></div>
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
								<AdminEmptyState title="No websites" description="No websites connected on this profile." />
							)}
						</section>

						<section className="admin-user-drawer__section">
							<h3>Integrations</h3>
							<div className="admin-meta-row"><span>Pinterest Status</span><StatusPill status={selected.pinterest} /></div>
							<div className="admin-meta-row"><span>WordPress Status</span><StatusPill status={selected.wordpress} /></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Recent Activity</h3>
							<div className="admin-list">
								{(selected.activity || []).length ? selected.activity.map((item) => (
									<div key={`${item.text}-${item.time}`} className="admin-list__item">
										<span>{item.text}</span>
										<span>{item.time}</span>
									</div>
								)) : (
									<div className="admin-list__item"><span>No recent activity</span><span>—</span></div>
								)}
							</div>
						</section>

						<div className="admin-user-drawer__actions">
							<button type="button" className="admin-btn" onClick={() => {}}>
								<Eye size={13} /> View
							</button>
							<button type="button" className="admin-btn" disabled={busy} onClick={() => toast({ title: 'Edit', description: 'Use profile fields via PATCH when needed.' })}>
								<Pencil size={13} /> Edit
							</button>
							<button type="button" className="admin-btn" disabled={busy} onClick={() => runAction('/suspend')}>
								<Ban size={13} /> Suspend
							</button>
							<button type="button" className="admin-btn" disabled={busy} onClick={() => runAction('/activate')}>
								<CheckCircle2 size={13} /> Activate
							</button>
							<button type="button" className="admin-btn" disabled={busy} onClick={() => runAction('/reset-password')}>
								<KeyRound size={13} /> Reset Password
							</button>
							<button type="button" className="admin-btn admin-btn--danger" disabled={busy} onClick={() => runAction('', 'DELETE')}>
								<Trash2 size={13} /> Delete
							</button>
						</div>
						<p className="admin-note">Mutations write to PocketBase users and audit logs.</p>
					</aside>
				</div>
			) : null}
		</div>
	);
}
