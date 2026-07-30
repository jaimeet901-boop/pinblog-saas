import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { AdminEmptyState, AdminErrorState, AdminHero, AdminSkeleton } from '@/components/admin/AdminUi';
import { apiServerClient } from '@/lib/apiServerClient';

async function readApiError(response) {
	const payload = await response.json().catch(() => ({}));
	return payload?.error || payload?.message || `Request failed (${response.status})`;
}

function formatWhen(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return date.toLocaleString();
}

export default function AdminBillingEventsPage() {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [items, setItems] = useState([]);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [eventType, setEventType] = useState('');
	const [provider, setProvider] = useState('');

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const params = new URLSearchParams({ page: String(page), perPage: '25' });
			if (eventType) params.set('eventType', eventType);
			if (provider) params.set('provider', provider);
			const response = await apiServerClient.fetch(`/admin/v1/billing/control-plane/monitoring/events?${params}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setItems(payload.items || []);
			setTotalPages(payload.totalPages || 1);
		} catch (err) {
			setError(err?.message || 'Unable to load billing events');
		} finally {
			setLoading(false);
		}
	}, [page, eventType, provider]);

	useEffect(() => {
		load();
	}, [load]);

	return (
		<div>
			<AdminHero
				title="Payment Events"
				description="Read-only explorer over existing billing_events. Does not redesign the event ledger."
				action={(
					<div className="flex flex-wrap gap-2">
						<Link to="/admin/billing/monitoring" className="admin-btn">Monitoring</Link>
						<button type="button" className="admin-btn admin-btn--primary" onClick={load}>
							<RefreshCw size={16} /> Refresh
						</button>
					</div>
				)}
			/>

			<section className="admin-card mb-4">
				<div className="flex flex-wrap gap-3 items-end">
					<label className="admin-field">
						<span>Event type</span>
						<input value={eventType} onChange={(e) => { setPage(1); setEventType(e.target.value); }} placeholder="e.g. renew" />
					</label>
					<label className="admin-field">
						<span>Provider</span>
						<input value={provider} onChange={(e) => { setPage(1); setProvider(e.target.value); }} placeholder="stripe" />
					</label>
				</div>
			</section>

			<section className="admin-card">
				{loading ? <AdminSkeleton rows={6} /> : null}
				{!loading && error ? <AdminErrorState message={error} onRetry={load} /> : null}
				{!loading && !error && items.length === 0 ? <AdminEmptyState title="No billing events" /> : null}
				{!loading && !error && items.length > 0 ? (
					<>
						<table className="admin-table">
							<thead>
								<tr>
									<th>When</th>
									<th>Type</th>
									<th>Workspace</th>
									<th>Provider</th>
									<th>Amount snapshot</th>
									<th>Message</th>
								</tr>
							</thead>
							<tbody>
								{items.map((row) => (
									<tr key={row.id}>
										<td>{formatWhen(row.occurredAt)}</td>
										<td>{row.eventType}</td>
										<td>{row.workspaceName || row.workspaceKey}</td>
										<td>{row.provider || '—'}</td>
										<td>{row.amountSnapshot ?? '—'}</td>
										<td>{row.message || '—'}</td>
									</tr>
								))}
							</tbody>
						</table>
						<div className="flex gap-2 mt-3">
							<button type="button" className="admin-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
							<span className="admin-note m-0">Page {page} / {totalPages}</span>
							<button type="button" className="admin-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
						</div>
					</>
				) : null}
			</section>
		</div>
	);
}
