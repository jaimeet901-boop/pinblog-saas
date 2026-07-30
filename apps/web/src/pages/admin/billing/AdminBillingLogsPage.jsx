import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { AdminEmptyState, AdminErrorState, AdminHero, AdminSkeleton, StatusPill } from '@/components/admin/AdminUi';
import { apiServerClient } from '@/lib/apiServerClient';

async function readApiError(response) {
	const payload = await response.json().catch(() => ({}));
	return payload?.error || payload?.message || `Request failed (${response.status})`;
}

function severityTone(severity) {
	const value = String(severity || '').toLowerCase();
	if (value === 'error' || value === 'critical') return 'error';
	if (value === 'warn' || value === 'warning') return 'warning';
	return 'info';
}

export default function AdminBillingLogsPage() {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [items, setItems] = useState([]);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(0);
	const [totalItems, setTotalItems] = useState(0);
	const [provider, setProvider] = useState('');
	const [severity, setSeverity] = useState('');
	const [search, setSearch] = useState('');
	const [draftSearch, setDraftSearch] = useState('');

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const params = new URLSearchParams({
				page: String(page),
				perPage: '20',
			});
			if (provider) params.set('provider', provider);
			if (severity) params.set('severity', severity);
			if (search) params.set('q', search);
			const response = await apiServerClient.fetch(`/admin/v1/billing/control-plane/logs?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setItems(payload.items || []);
			setTotalPages(payload.totalPages || 0);
			setTotalItems(payload.totalItems || 0);
		} catch (err) {
			setError(err?.message || 'Unable to load billing logs');
		} finally {
			setLoading(false);
		}
	}, [page, provider, severity, search]);

	useEffect(() => {
		load();
	}, [load]);

	return (
		<div>
			<AdminHero
				title="Billing Logs"
				description="Administrator actions for the Billing Control Plane only. Runtime payment activity stays in Payment Events and Webhook Monitor."
				action={(
					<div className="flex flex-wrap gap-2">
						<Link to="/admin/billing/providers" className="admin-btn">Billing Providers</Link>
						<button type="button" className="admin-btn" onClick={load} disabled={loading}>
							<RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Reload
						</button>
					</div>
				)}
			/>

			<section className="admin-card mb-4">
				<div className="admin-config-grid">
					<label className="admin-field">
						<span>Provider</span>
						<select value={provider} onChange={(e) => { setPage(1); setProvider(e.target.value); }}>
							<option value="">All</option>
							<option value="stripe">Stripe</option>
							<option value="paddle">Paddle</option>
							<option value="lemonsqueezy">Lemon Squeezy</option>
							<option value="paypal">PayPal</option>
						</select>
					</label>
					<label className="admin-field">
						<span>Severity</span>
						<select value={severity} onChange={(e) => { setPage(1); setSeverity(e.target.value); }}>
							<option value="">All</option>
							<option value="info">Info</option>
							<option value="warn">Warn</option>
							<option value="error">Error</option>
						</select>
					</label>
					<label className="admin-field">
						<span>Search</span>
						<input
							value={draftSearch}
							onChange={(e) => setDraftSearch(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									setPage(1);
									setSearch(draftSearch.trim());
								}
							}}
							placeholder="Action, admin, audit id, IP"
						/>
					</label>
					<div className="admin-field flex items-end">
						<button
							type="button"
							className="admin-btn admin-btn--primary"
							onClick={() => { setPage(1); setSearch(draftSearch.trim()); }}
						>
							Apply filters
						</button>
					</div>
				</div>
				<p className="admin-note mb-0">
					Filter: service = billing-control-plane OR ui_category = Billing Admin · {totalItems} matching events
				</p>
			</section>

			{loading ? (
				<section className="admin-card"><AdminSkeleton rows={8} /></section>
			) : null}

			{!loading && error ? (
				<section className="admin-card">
					<AdminErrorState title="Unable to load billing logs" description={error} />
				</section>
			) : null}

			{!loading && !error && items.length === 0 ? (
				<section className="admin-card">
					<AdminEmptyState
						title="No billing admin logs yet"
						description="Configure or activate a provider to create Control Plane audit entries."
					/>
				</section>
			) : null}

			{!loading && !error && items.length > 0 ? (
				<section className="admin-card overflow-x-auto">
					<table className="admin-table w-full text-left" style={{ fontSize: 13 }}>
						<thead>
							<tr>
								<th>Timestamp</th>
								<th>Administrator</th>
								<th>Provider</th>
								<th>Action</th>
								<th>Severity</th>
								<th>Audit ID</th>
								<th>IP</th>
							</tr>
						</thead>
						<tbody>
							{items.map((row) => (
								<tr key={row.id}>
									<td>{row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}</td>
									<td>{row.administrator}</td>
									<td>{row.provider}</td>
									<td>{row.action}</td>
									<td><StatusPill status={severityTone(row.severity)} /></td>
									<td style={{ fontFamily: 'monospace', fontSize: 12 }}>{row.auditId}</td>
									<td>{row.ip}</td>
								</tr>
							))}
						</tbody>
					</table>
					<div className="mt-4 flex items-center justify-between gap-3">
						<button
							type="button"
							className="admin-btn"
							disabled={page <= 1}
							onClick={() => setPage((prev) => Math.max(1, prev - 1))}
						>
							Previous
						</button>
						<span style={{ color: 'var(--admin-muted)', fontSize: 12 }}>
							Page {page} of {Math.max(totalPages, 1)}
						</span>
						<button
							type="button"
							className="admin-btn"
							disabled={totalPages > 0 ? page >= totalPages : true}
							onClick={() => setPage((prev) => prev + 1)}
						>
							Next
						</button>
					</div>
				</section>
			) : null}
		</div>
	);
}
