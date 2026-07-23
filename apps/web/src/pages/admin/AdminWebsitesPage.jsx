import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AdminHero, StatusPill, AdminEmptyState } from '@/components/admin/AdminUi';
import apiServerClient from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

export default function AdminWebsitesPage() {
	const { toast } = useToast();
	const [search, setSearch] = useState('');
	const [status, setStatus] = useState('');
	const [sites, setSites] = useState([]);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (search.trim()) params.set('q', search.trim());
			if (status) params.set('status', status);
			const response = await apiServerClient.fetch(`/admin/v1/inventory/websites?${params.toString()}`);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setSites(Array.isArray(payload.items) ? payload.items : []);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Websites load failed', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [search, status, toast]);

	useEffect(() => {
		load();
	}, [load]);

	return (
		<div>
			<AdminHero
				title="Websites"
				description="Connected customer sites across workspaces from live PocketBase records."
			/>
			<section className="admin-card">
				<div className="admin-toolbar">
					<label className="min-w-[12rem] flex-1">
						<span>Search</span>
						<input
							placeholder="Domain or workspace"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</label>
					<label>
						<span>Status</span>
						<select value={status} onChange={(e) => setStatus(e.target.value)}>
							<option value="">All</option>
							<option value="connected">Connected</option>
							<option value="degraded">Degraded</option>
						</select>
					</label>
				</div>
				{loading ? (
					<p className="admin-note flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading websites…</p>
				) : null}
				{!loading && sites.length === 0 ? (
					<AdminEmptyState title="No websites match" description="Adjust search or status filters and try again." />
				) : (
					<div className="admin-table-wrap">
						<table className="admin-table">
							<thead>
								<tr>
									<th>Domain</th>
									<th>Workspace</th>
									<th>CMS</th>
									<th>Status</th>
									<th>Actions</th>
								</tr>
							</thead>
							<tbody>
								{sites.map((site) => (
									<tr key={site.id}>
										<td className="font-medium">{site.domain}</td>
										<td style={{ color: 'var(--admin-muted)' }}>{site.workspace}</td>
										<td>{site.cms}</td>
										<td><StatusPill status={site.status} /></td>
										<td><button type="button" className="admin-btn" disabled title="Open in workspace">Open</button></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
}
