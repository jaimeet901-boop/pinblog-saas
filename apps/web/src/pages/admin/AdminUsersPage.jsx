import { useMemo, useState } from 'react';
import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import { MOCK_USERS } from '@/pages/admin/mockData';

const PAGE_SIZE = 5;

export default function AdminUsersPage() {
	const [search, setSearch] = useState('');
	const [role, setRole] = useState('');
	const [status, setStatus] = useState('');
	const [page, setPage] = useState(1);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		return MOCK_USERS.filter((user) => {
			if (role && user.role !== role) return false;
			if (status && user.status !== status) return false;
			if (!q) return true;
			return `${user.name} ${user.email}`.toLowerCase().includes(q);
		});
	}, [search, role, status]);

	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

	return (
		<div>
			<AdminHero
				title="Users"
				description="Manage platform accounts with search, filters, and role status. Mock data only."
			/>

			<div className="admin-toolbar">
				<label className="min-w-[12rem] flex-1">
					<span>Search</span>
					<input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name or email" />
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
				<button type="button" className="admin-btn admin-btn--primary" disabled>Invite user</button>
			</div>

			<div className="admin-card">
				<div className="admin-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>Name</th>
								<th>Email</th>
								<th>Role</th>
								<th>Plan</th>
								<th>Status</th>
								<th>Created</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((user) => (
								<tr key={user.id}>
									<td className="font-medium">{user.name}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{user.email}</td>
									<td><StatusPill status={user.role} /></td>
									<td><StatusPill status={user.plan} /></td>
									<td><StatusPill status={user.status} /></td>
									<td style={{ color: 'var(--admin-muted)' }}>{user.created}</td>
									<td>
										<button type="button" className="admin-btn" disabled>View</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className="mt-3 flex items-center justify-between gap-2">
					<p className="admin-note m-0">{filtered.length} users · page {page} of {totalPages}</p>
					<div className="flex gap-2">
						<button type="button" className="admin-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
						<button type="button" className="admin-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
					</div>
				</div>
			</div>
		</div>
	);
}
