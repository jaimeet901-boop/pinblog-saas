import { useEffect, useMemo, useState } from 'react';
import { Eye, Pencil, Ban, CheckCircle2, KeyRound, Trash2, X } from 'lucide-react';
import { AdminHero, StatusPill, AdminPagination, AdminEmptyState } from '@/components/admin/AdminUi';
import { MOCK_USERS } from '@/pages/admin/mockData';

const PAGE_SIZE = 6;
const BACKEND_READY = false;

function initials(name = '') {
	return String(name)
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() || '')
		.join('') || '?';
}

function daysAgo(isoDate) {
	const created = new Date(`${isoDate}T00:00:00`);
	if (Number.isNaN(created.getTime())) return Infinity;
	return (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
}

function Avatar({ name, large }) {
	return <span className={`admin-avatar ${large ? 'admin-avatar--lg' : ''}`} aria-hidden="true">{initials(name)}</span>;
}

export default function AdminUsersPage() {
	const [search, setSearch] = useState('');
	const [role, setRole] = useState('');
	const [status, setStatus] = useState('');
	const [plan, setPlan] = useState('');
	const [registeredWithin, setRegisteredWithin] = useState('');
	const [page, setPage] = useState(1);
	const [selectedId, setSelectedId] = useState('');

	const stats = useMemo(() => {
		const total = MOCK_USERS.length;
		const active = MOCK_USERS.filter((user) => user.status === 'active').length;
		const admins = MOCK_USERS.filter((user) => user.role === 'admin').length;
		const newUsers = MOCK_USERS.filter((user) => daysAgo(user.created) <= 30).length;
		return { total, active, admins, newUsers };
	}, []);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return MOCK_USERS.filter((user) => {
			if (role && user.role !== role) return false;
			if (status && user.status !== status) return false;
			if (plan && user.plan !== plan) return false;
			if (registeredWithin === '7' && daysAgo(user.created) > 7) return false;
			if (registeredWithin === '30' && daysAgo(user.created) > 30) return false;
			if (registeredWithin === '90' && daysAgo(user.created) > 90) return false;
			if (!q) return true;
			const haystack = [
				user.name,
				user.email,
				...(user.workspaces || []),
			].join(' ').toLowerCase();
			return haystack.includes(q);
		});
	}, [search, role, status, plan, registeredWithin]);

	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
	const selected = MOCK_USERS.find((user) => user.id === selectedId) || null;

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
				title="Users Management"
				description="Manage platform users and workspace owners. Mock data only — actions disabled until admin APIs exist."
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
									<td style={{ color: 'var(--admin-muted)' }}>{(user.workspaces || []).length}</td>
									<td><StatusPill status={user.status} /></td>
									<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{user.created}</td>
									<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{user.lastLogin || '—'}</td>
									<td onClick={(event) => event.stopPropagation()}>
										<div className="flex flex-wrap gap-1">
											<button type="button" className="admin-btn" onClick={() => setSelectedId(user.id)}>
												<Eye size={12} /> View
											</button>
											<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
												<Pencil size={12} /> Edit
											</button>
											<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
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

				<AdminPagination
					total={filtered.length}
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
								<AdminEmptyState title="No workspaces" description="No workspaces on this mock profile." />
							)}
						</section>

						<section className="admin-user-drawer__section">
							<h3>Credits</h3>
							<div className="admin-meta-row"><span>Available</span><span>{Number(selected.credits || 0).toLocaleString()}</span></div>
							<div className="admin-meta-row"><span>Ledger</span><span>Placeholder</span></div>
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
								<AdminEmptyState title="No websites" description="No websites connected on this mock profile." />
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
								{(selected.activity || []).map((item) => (
									<div key={`${item.text}-${item.time}`} className="admin-list__item">
										<span>{item.text}</span>
										<span>{item.time}</span>
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
								<Ban size={13} /> Suspend
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<CheckCircle2 size={13} /> Activate
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<KeyRound size={13} /> Reset Password
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
