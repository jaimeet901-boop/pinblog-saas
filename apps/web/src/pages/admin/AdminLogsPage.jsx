import { useMemo, useState } from 'react';
import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import { MOCK_LOGS } from '@/pages/admin/mockData';

export default function AdminLogsPage() {
	const [search, setSearch] = useState('');
	const [severity, setSeverity] = useState('');

	const rows = useMemo(() => {
		const q = search.trim().toLowerCase();
		return MOCK_LOGS.filter((log) => {
			if (severity && log.severity !== severity) return false;
			if (!q) return true;
			return `${log.message} ${log.source}`.toLowerCase().includes(q);
		});
	}, [search, severity]);

	return (
		<div>
			<AdminHero
				title="Logs"
				description="Searchable platform logs with severity filters and export affordances. Mock entries only."
				action={<button type="button" className="admin-btn admin-btn--primary" disabled>Export</button>}
			/>
			<div className="admin-toolbar">
				<label className="min-w-[12rem] flex-1">
					<span>Search</span>
					<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Message or source" />
				</label>
				<label>
					<span>Severity</span>
					<select value={severity} onChange={(e) => setSeverity(e.target.value)}>
						<option value="">All</option>
						<option value="debug">Debug</option>
						<option value="info">Info</option>
						<option value="warn">Warn</option>
						<option value="error">Error</option>
					</select>
				</label>
				<label>
					<span>Date</span>
					<input type="date" disabled />
				</label>
			</div>
			<section className="admin-card">
				<div className="admin-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>Time</th>
								<th>Severity</th>
								<th>Source</th>
								<th>Message</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((log) => (
								<tr key={log.id}>
									<td style={{ color: 'var(--admin-muted)', whiteSpace: 'nowrap' }}>{log.at}</td>
									<td><StatusPill status={log.severity === 'error' ? 'failed' : log.severity === 'warn' ? 'warn' : 'info'} /></td>
									<td>{log.source}</td>
									<td>{log.message}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}
