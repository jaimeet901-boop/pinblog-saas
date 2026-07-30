import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Archive,
	Play,
	RefreshCw,
	RotateCcw,
	ShieldCheck,
} from 'lucide-react';
import { AdminEmptyState, AdminErrorState, AdminHero, AdminSkeleton, StatusPill } from '@/components/admin/AdminUi';
import { apiServerClient } from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

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

function readinessTone(status) {
	if (status === 'Ready') return 'healthy';
	if (status === 'Degraded') return 'warning';
	if (status === 'Not Ready') return 'critical';
	return 'offline';
}

export default function AdminBillingDisasterRecoveryPage() {
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState('');
	const [readiness, setReadiness] = useState(null);
	const [backups, setBackups] = useState([]);
	const [restores, setRestores] = useState([]);
	const [audit, setAudit] = useState([]);
	const [stateVerify, setStateVerify] = useState(null);
	const [simulation, setSimulation] = useState(null);
	const [selectedId, setSelectedId] = useState('');
	const [updatedAt, setUpdatedAt] = useState(null);
	const [canManage, setCanManage] = useState(true);
	const [label, setLabel] = useState('manual');

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const [readyRes, backupsRes, restoresRes, auditRes, stateRes] = await Promise.all([
				apiServerClient.fetch('/admin/v1/billing/control-plane/dr/readiness'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/dr/backups?limit=30'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/dr/restores?limit=20'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/dr/audit?perPage=15'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/dr/verify-state', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				}),
			]);
			if (!readyRes.ok) throw new Error(await readApiError(readyRes));
			const readyPayload = await readyRes.json();
			setReadiness(readyPayload);
			setUpdatedAt(readyPayload.updatedAt || null);
			setCanManage(readyPayload.permissions?.['admin.billing.manage'] !== false);

			if (backupsRes.ok) {
				const payload = await backupsRes.json();
				const items = payload.items || [];
				setBackups(items);
				if (!selectedId && items[0]?.id) setSelectedId(items[0].id);
			}
			if (restoresRes.ok) {
				const payload = await restoresRes.json();
				setRestores(payload.items || []);
			}
			if (auditRes.ok) {
				const payload = await auditRes.json();
				setAudit(payload.items || []);
			}
			if (stateRes.ok) setStateVerify(await stateRes.json());
		} catch (err) {
			setError(err?.message || 'Unable to load disaster recovery');
		} finally {
			setLoading(false);
		}
	}, [selectedId]);

	useEffect(() => {
		load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const createBackup = async () => {
		if (!canManage) return;
		setBusy('backup');
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/dr/backups', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label, expectedUpdatedAt: updatedAt }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			toast({ title: 'Backup created', description: payload.backup?.id });
			setSelectedId(payload.backup?.id || selectedId);
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Backup failed', description: err?.message });
		} finally {
			setBusy('');
		}
	};

	const verifyBackup = async () => {
		if (!selectedId) return;
		setBusy('verify');
		try {
			const response = await apiServerClient.fetch(
				`/admin/v1/billing/control-plane/dr/backups/${encodeURIComponent(selectedId)}/verify`,
				{ method: 'POST' },
			);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			toast({
				title: 'Verification',
				description: `reason=${payload.reasonCode} · integrity=${payload.integrity?.reasonCode}`,
			});
		} catch (err) {
			toast({ variant: 'destructive', title: 'Verify failed', description: err?.message });
		} finally {
			setBusy('');
		}
	};

	const runSimulate = async () => {
		if (!selectedId) return;
		setBusy('simulate');
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/dr/simulate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ backupId: selectedId }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			setSimulation(await response.json());
		} catch (err) {
			toast({ variant: 'destructive', title: 'Simulation failed', description: err?.message });
		} finally {
			setBusy('');
		}
	};

	const runRestore = async () => {
		if (!canManage || !selectedId) return;
		const confirmed = window.confirm(
			'Restore Control Plane configuration from this backup?\n\n'
			+ 'This is configuration-only. Subscriptions and billing_events are never rewritten.\n'
			+ 'Restore is atomic: success commits fully, or nothing changes.',
		);
		if (!confirmed) return;
		setBusy('restore');
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/dr/restore', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ backupId: selectedId, expectedUpdatedAt: updatedAt }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			toast({
				title: payload.applied ? 'Restore applied' : 'Restore blocked',
				description: `${payload.reasonCode || '—'} · applied=${Boolean(payload.applied)}`,
			});
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Restore failed', description: err?.message });
		} finally {
			setBusy('');
		}
	};

	const runRollback = async () => {
		if (!canManage) return;
		const confirmed = window.confirm(
			'Roll back to the pre-restore checkpoint (or selected backup if no checkpoint)?\n\n'
			+ 'Configuration-only. Atomic all-or-nothing.',
		);
		if (!confirmed) return;
		setBusy('rollback');
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/dr/rollback', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					backupId: selectedId || undefined,
					expectedUpdatedAt: updatedAt,
				}),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			toast({
				title: payload.applied ? 'Rollback applied' : 'Rollback blocked',
				description: `${payload.reasonCode || '—'} · applied=${Boolean(payload.applied)}`,
			});
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Rollback failed', description: err?.message });
		} finally {
			setBusy('');
		}
	};

	const runValidate = async () => {
		setBusy('validate');
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/dr/validate-recovery', {
				method: 'POST',
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			toast({
				title: 'Recovery validation',
				description: `${payload.reasonCode} · validation=${payload.validationPreview?.result}`,
			});
		} catch (err) {
			toast({ variant: 'destructive', title: 'Validation failed', description: err?.message });
		} finally {
			setBusy('');
		}
	};

	if (loading && !readiness) {
		return (
			<div>
				<AdminHero title="Disaster Recovery" description="Control Plane configuration backup & restore." />
				<AdminSkeleton rows={8} />
			</div>
		);
	}

	if (error && !readiness) {
		return (
			<div>
				<AdminHero title="Disaster Recovery" description="Control Plane configuration backup & restore." />
				<AdminErrorState message={error} onRetry={load} />
			</div>
		);
	}

	return (
		<div>
			<AdminHero
				title="Disaster Recovery"
				description="Backup and restore Billing Control Plane configuration only. Never migrates subscriptions or rewrites billing history."
				action={(
					<div className="flex flex-wrap gap-2">
						<Link to="/admin/billing/providers" className="admin-btn">Providers</Link>
						<Link to="/admin/billing/health" className="admin-btn">Health</Link>
						<Link to="/admin/billing/failover" className="admin-btn">Failover</Link>
						<Link to="/admin/billing/monitoring" className="admin-btn">Monitoring</Link>
						<button type="button" className="admin-btn admin-btn--primary" onClick={load}>
							<RefreshCw size={16} /> Refresh
						</button>
					</div>
				)}
			/>

			<section className="admin-card mb-4">
				<p className="admin-note mt-0">
					Every backup includes <strong>policyVersion</strong> and <strong>manifestVersion</strong>.
					Restore is atomic and rejects unsupported versions with fixed reason codes.
					Secrets are stored as ciphertext only.
				</p>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<div>
						<div className="admin-label">Readiness</div>
						<StatusPill tone={readinessTone(readiness?.status)}>
							{readiness?.status || 'Unknown'}
						</StatusPill>
					</div>
					<div>
						<div className="admin-label">Active provider</div>
						<div className="admin-stat">{readiness?.activeProvider || 'none'}</div>
					</div>
					<div>
						<div className="admin-label">Latest backup</div>
						<div className="admin-stat text-sm">{formatWhen(readiness?.latestBackupAt)}</div>
					</div>
					<div>
						<div className="admin-label">Manifest</div>
						<div className="admin-stat text-sm">
							pv={readiness?.policyVersion ?? '—'} · mv={readiness?.manifestVersion ?? '—'}
						</div>
					</div>
				</div>
				{readiness?.notes?.length ? (
					<p className="admin-note mb-0">Notes: {readiness.notes.join(', ')}</p>
				) : null}
			</section>

			<section className="admin-card mb-4">
				<div className="flex flex-wrap items-end gap-3">
					<label className="admin-field">
						<span className="admin-label">Backup label</span>
						<input
							className="admin-input"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							disabled={!canManage}
						/>
					</label>
					<button
						type="button"
						className="admin-btn admin-btn--primary"
						disabled={!canManage || busy === 'backup'}
						onClick={createBackup}
					>
						<Archive size={16} /> {busy === 'backup' ? 'Creating…' : 'Create backup'}
					</button>
					<button
						type="button"
						className="admin-btn"
						disabled={!selectedId || busy === 'verify'}
						onClick={verifyBackup}
					>
						<ShieldCheck size={16} /> Verify
					</button>
					<button
						type="button"
						className="admin-btn"
						disabled={!selectedId || busy === 'simulate'}
						onClick={runSimulate}
					>
						<Play size={16} /> Simulate
					</button>
					<button
						type="button"
						className="admin-btn"
						disabled={!canManage || !selectedId || busy === 'restore'}
						onClick={runRestore}
					>
						Restore
					</button>
					<button
						type="button"
						className="admin-btn"
						disabled={!canManage || busy === 'rollback'}
						onClick={runRollback}
					>
						<RotateCcw size={16} /> Rollback
					</button>
					<button
						type="button"
						className="admin-btn"
						disabled={busy === 'validate'}
						onClick={runValidate}
					>
						Validate recovery
					</button>
				</div>
			</section>

			{simulation ? (
				<section className="admin-card mb-4">
					<h3 className="admin-section-title mt-0">Simulation (read-only)</h3>
					<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
						<div>Action: <strong>{simulation.predictedAction}</strong></div>
						<div>Blocking: {simulation.blockingReason || '—'}</div>
						<div>Secrets present: {String(Boolean(simulation.secretsPresent))}</div>
						<div>
							Compat: pv={simulation.compatibility?.policyVersion}
							{' · '}mv={simulation.compatibility?.manifestVersion}
						</div>
					</div>
					<p className="admin-note mb-0">
						Keys: {(simulation.wouldRestoreKeys || []).join(', ') || '—'}
					</p>
				</section>
			) : null}

			<section className="admin-card mb-4">
				<h3 className="admin-section-title mt-0">Backup history</h3>
				{!backups.length ? (
					<AdminEmptyState title="No backups yet" description="Create a Control Plane configuration backup to begin." />
				) : (
					<div className="overflow-x-auto">
						<table className="admin-table">
							<thead>
								<tr>
									<th>Select</th>
									<th>ID</th>
									<th>Label</th>
									<th>Created</th>
									<th>Versions</th>
									<th>Env</th>
									<th>Cipher</th>
								</tr>
							</thead>
							<tbody>
								{backups.map((backup) => (
									<tr key={backup.id}>
										<td>
											<input
												type="radio"
												name="backup"
												checked={selectedId === backup.id}
												onChange={() => setSelectedId(backup.id)}
											/>
										</td>
										<td className="font-mono text-xs">{backup.id}</td>
										<td>{backup.label}</td>
										<td>{formatWhen(backup.createdAt)}</td>
										<td className="text-xs">
											pv={backup.manifest?.policyVersion}
											{' · '}mv={backup.manifest?.manifestVersion}
										</td>
										<td>{backup.manifest?.environment}</td>
										<td>{backup.manifest?.includesCiphertext ? 'yes' : 'no'}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section className="admin-card mb-4">
				<h3 className="admin-section-title mt-0">Restore history</h3>
				{!restores.length ? (
					<p className="admin-note mb-0">No restores yet.</p>
				) : (
					<div className="overflow-x-auto">
						<table className="admin-table">
							<thead>
								<tr>
									<th>When</th>
									<th>Type</th>
									<th>Backup</th>
									<th>Reason</th>
									<th>Applied</th>
									<th>Actor</th>
								</tr>
							</thead>
							<tbody>
								{restores.map((row) => (
									<tr key={row.id}>
										<td>{formatWhen(row.at)}</td>
										<td>{row.type}</td>
										<td className="font-mono text-xs">{row.backupId}</td>
										<td>{row.reasonCode || '—'}</td>
										<td>{String(Boolean(row.applied))}</td>
										<td>{row.actor || '—'}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section className="admin-card mb-4">
				<h3 className="admin-section-title mt-0">Live state verification</h3>
				{stateVerify ? (
					<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
						<div>Reason: {stateVerify.state?.reasonCode}</div>
						<div>Active: {stateVerify.state?.activeProvider}</div>
						<div>Validation: {stateVerify.validationPreview?.result}</div>
						<div>Failover/Monitoring: {String(stateVerify.failoverPresent)}/{String(stateVerify.monitoringPresent)}</div>
					</div>
				) : (
					<p className="admin-note mb-0">No state verification yet.</p>
				)}
			</section>

			<section className="admin-card mb-4">
				<h3 className="admin-section-title mt-0">DR audit</h3>
				{!audit.length ? (
					<p className="admin-note mb-0">No DR audit entries yet.</p>
				) : (
					<div className="overflow-x-auto">
						<table className="admin-table">
							<thead>
								<tr>
									<th>When</th>
									<th>Action</th>
									<th>Message</th>
									<th>Backup</th>
									<th>Admin</th>
								</tr>
							</thead>
							<tbody>
								{audit.map((row) => (
									<tr key={row.id}>
										<td>{formatWhen(row.timestamp)}</td>
										<td className="text-xs">{row.action}</td>
										<td>{row.message}</td>
										<td className="font-mono text-xs">{row.backupId || '—'}</td>
										<td>{row.administrator}</td>
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
