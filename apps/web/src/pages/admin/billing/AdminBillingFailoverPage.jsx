import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	ArrowRightLeft,
	Play,
	RefreshCw,
	Save,
	Shield,
} from 'lucide-react';
import { AdminEmptyState, AdminErrorState, AdminHero, AdminSkeleton, StatusPill } from '@/components/admin/AdminUi';
import { apiServerClient } from '@/lib/apiServerClient';
import { useToast } from '@/hooks/use-toast';

async function readApiError(response) {
	const payload = await response.json().catch(() => ({}));
	return payload?.error || payload?.message || `Request failed (${response.status})`;
}

const PROVIDERS = ['stripe', 'lemonsqueezy', 'paddle'];

function formatWhen(value) {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return date.toLocaleString();
}

export default function AdminBillingFailoverPage() {
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [busy, setBusy] = useState('');
	const [error, setError] = useState('');
	const [status, setStatus] = useState(null);
	const [policy, setPolicy] = useState(null);
	const [updatedAt, setUpdatedAt] = useState(null);
	const [canManage, setCanManage] = useState(true);
	const [simulation, setSimulation] = useState(null);
	const [events, setEvents] = useState([]);
	const [forceProvider, setForceProvider] = useState('stripe');

	const load = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const [statusRes, eventsRes] = await Promise.all([
				apiServerClient.fetch('/admin/v1/billing/control-plane/failover/status'),
				apiServerClient.fetch('/admin/v1/billing/control-plane/failover/events?perPage=20'),
			]);
			if (!statusRes.ok) throw new Error(await readApiError(statusRes));
			const statusPayload = await statusRes.json();
			setStatus(statusPayload);
			setPolicy(statusPayload.policy || null);
			setUpdatedAt(statusPayload.updatedAt || null);
			setCanManage(statusPayload.permissions?.['admin.billing.manage'] !== false);
			setForceProvider(statusPayload.forcedProvider || statusPayload.preferredPrimary || 'stripe');

			if (eventsRes.ok) {
				const eventsPayload = await eventsRes.json();
				setEvents(eventsPayload.items || []);
			}
		} catch (err) {
			setError(err?.message || 'Unable to load failover status');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const patchPolicy = (key, value) => {
		setPolicy((prev) => (prev ? { ...prev, [key]: value } : prev));
	};

	const patchRecovery = (key, value) => {
		setPolicy((prev) => (prev ? {
			...prev,
			recovery: { ...(prev.recovery || {}), [key]: value },
		} : prev));
	};

	const movePriority = (index, direction) => {
		setPolicy((prev) => {
			if (!prev?.priority) return prev;
			const next = [...prev.priority];
			const target = index + direction;
			if (target < 0 || target >= next.length) return prev;
			[next[index], next[target]] = [next[target], next[index]];
			return { ...prev, priority: next };
		});
	};

	const savePolicy = async () => {
		if (!canManage || !policy) return;
		setSaving(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/failover/policy', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					expectedUpdatedAt: updatedAt,
					autoFailoverEnabled: policy.autoFailoverEnabled,
					priority: policy.priority,
					preferredPrimary: policy.preferredPrimary,
					cooldownSeconds: policy.cooldownSeconds,
					autoOnHealthCheck: policy.autoOnHealthCheck,
					recovery: policy.recovery,
					eligibility: policy.eligibility,
				}),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Failover policy saved' });
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Save failed', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const runSimulate = async (intent = 'failover') => {
		setBusy('simulate');
		try {
			const response = await apiServerClient.fetch('/admin/v1/billing/control-plane/failover/simulate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ intent, forceAuto: true }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			setSimulation(await response.json());
		} catch (err) {
			toast({ variant: 'destructive', title: 'Simulation failed', description: err?.message });
		} finally {
			setBusy('');
		}
	};

	const runAction = async (path, body, label) => {
		if (!canManage) return;
		setBusy(label);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/billing/control-plane/failover/${path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...body, expectedUpdatedAt: updatedAt }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			toast({
				title: label,
				description: `${payload.recognition || 'done'} · ${payload.reasonCode || '—'} · applied=${Boolean(payload.applied)}`,
			});
			await load();
		} catch (err) {
			toast({ variant: 'destructive', title: `${label} failed`, description: err?.message });
		} finally {
			setBusy('');
		}
	};

	if (loading) {
		return (
			<div>
				<AdminHero title="Failover & Recovery" description="Platform default provider resilience." />
				<AdminSkeleton rows={6} />
			</div>
		);
	}

	if (error) {
		return (
			<div>
				<AdminHero title="Failover & Recovery" description="Platform default provider resilience." />
				<AdminErrorState message={error} onRetry={load} />
			</div>
		);
	}

	return (
		<div>
			<AdminHero
				title="Failover & Recovery"
				description="Changes the platform default provider for new checkouts only. Existing subscriptions keep their provider affinity."
				action={(
					<div className="flex flex-wrap gap-2">
						<Link to="/admin/billing/health" className="admin-btn">Provider Health</Link>
						<button type="button" className="admin-btn" onClick={load}>
							<RefreshCw size={16} /> Refresh
						</button>
					</div>
				)}
			/>

			<section className="admin-card mb-4">
				<p className="admin-note mt-0">
					Default provider for <strong>new</strong> commercial flows only. Never migrates subscriptions or rewrites billing history.
				</p>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<div>
						<p className="admin-stat__label">Active provider</p>
						<p className="admin-stat__value">{status?.activeProvider || 'none'}</p>
					</div>
					<div>
						<p className="admin-stat__label">Mode</p>
						<p className="admin-stat__value">{status?.mode || '—'}</p>
					</div>
					<div>
						<p className="admin-stat__label">Auto failover</p>
						<StatusPill status={status?.autoFailoverEnabled ? 'enabled' : 'disabled'} />
					</div>
					<div>
						<p className="admin-stat__label">Preferred primary</p>
						<p className="admin-stat__value">{status?.preferredPrimary || '—'}</p>
					</div>
					<div>
						<p className="admin-stat__label">Next eligible</p>
						<p className="admin-stat__value">{status?.nextEligible || '—'}</p>
					</div>
					<div>
						<p className="admin-stat__label">Last decision</p>
						<p className="admin-stat__value" style={{ fontSize: 14 }}>
							{status?.lastDecision?.reasonCode || '—'}
							{' · '}
							{formatWhen(status?.lastDecision?.at)}
						</p>
					</div>
				</div>
			</section>

			<section className="admin-card mb-4">
				<div className="flex flex-wrap items-center justify-between gap-2 mb-3">
					<h2 className="admin-section-title m-0">Failover Policy</h2>
					<button type="button" className="admin-btn admin-btn--primary" disabled={!canManage || saving} onClick={savePolicy}>
						<Save size={16} /> {saving ? 'Saving…' : 'Save policy'}
					</button>
				</div>
				{!policy ? (
					<AdminEmptyState title="No policy loaded" />
				) : (
					<div className="grid gap-4 lg:grid-cols-2">
						<label className="admin-field">
							<span>Automatic failover enabled</span>
							<input
								type="checkbox"
								checked={Boolean(policy.autoFailoverEnabled)}
								disabled={!canManage}
								onChange={(e) => patchPolicy('autoFailoverEnabled', e.target.checked)}
							/>
						</label>
						<label className="admin-field">
							<span>Evaluate after health check</span>
							<input
								type="checkbox"
								checked={Boolean(policy.autoOnHealthCheck)}
								disabled={!canManage}
								onChange={(e) => patchPolicy('autoOnHealthCheck', e.target.checked)}
							/>
						</label>
						<label className="admin-field">
							<span>Preferred primary</span>
							<select
								value={policy.preferredPrimary || 'stripe'}
								disabled={!canManage}
								onChange={(e) => patchPolicy('preferredPrimary', e.target.value)}
							>
								{PROVIDERS.map((code) => <option key={code} value={code}>{code}</option>)}
							</select>
						</label>
						<label className="admin-field">
							<span>Cooldown (seconds)</span>
							<input
								type="number"
								min={0}
								max={86400}
								value={policy.cooldownSeconds ?? 300}
								disabled={!canManage}
								onChange={(e) => patchPolicy('cooldownSeconds', Number(e.target.value) || 0)}
							/>
						</label>
						<label className="admin-field">
							<span>Recovery mode</span>
							<select
								value={policy.recovery?.mode || 'manual'}
								disabled={!canManage}
								onChange={(e) => patchRecovery('mode', e.target.value)}
							>
								<option value="manual">manual</option>
								<option value="automatic">automatic</option>
							</select>
						</label>
						<label className="admin-field">
							<span>Auto-restore preferred</span>
							<input
								type="checkbox"
								checked={Boolean(policy.recovery?.autoRestorePreferred)}
								disabled={!canManage}
								onChange={(e) => patchRecovery('autoRestorePreferred', e.target.checked)}
							/>
						</label>
						<div className="lg:col-span-2">
							<p className="admin-stat__label mb-2">Provider priority</p>
							<ul className="m-0 p-0 list-none space-y-2">
								{(policy.priority || []).map((code, index) => (
									<li key={code} className="flex items-center gap-2">
										<span className="admin-pill">{index + 1}. {code}</span>
										<button type="button" className="admin-btn" disabled={!canManage || index === 0} onClick={() => movePriority(index, -1)}>Up</button>
										<button type="button" className="admin-btn" disabled={!canManage || index === policy.priority.length - 1} onClick={() => movePriority(index, 1)}>Down</button>
									</li>
								))}
							</ul>
							<p className="admin-note">policyVersion={policy.policyVersion} (reserved for policy evolution)</p>
						</div>
					</div>
				)}
			</section>

			<section className="admin-card mb-4">
				<h2 className="admin-section-title">Manual Override</h2>
				<div className="flex flex-wrap gap-2 items-end">
					<label className="admin-field">
						<span>Force provider</span>
						<select value={forceProvider} disabled={!canManage} onChange={(e) => setForceProvider(e.target.value)}>
							{PROVIDERS.map((code) => <option key={code} value={code}>{code}</option>)}
						</select>
					</label>
					<button
						type="button"
						className="admin-btn admin-btn--primary"
						disabled={!canManage || busy === 'force'}
						onClick={() => runAction('override', { mode: 'force', provider: forceProvider }, 'Force provider')}
					>
						<Shield size={16} /> Force
					</button>
					<button
						type="button"
						className="admin-btn"
						disabled={!canManage || busy === 'disable'}
						onClick={() => runAction('override', { mode: 'disable_auto', autoFailoverEnabled: false }, 'Disable auto')}
					>
						Disable auto
					</button>
					<button
						type="button"
						className="admin-btn"
						disabled={!canManage || busy === 'resume'}
						onClick={() => runAction('override', { mode: 'automatic' }, 'Resume automatic')}
					>
						Resume automatic
					</button>
					<button
						type="button"
						className="admin-btn"
						disabled={!canManage || busy === 'evaluate'}
						onClick={() => runAction('evaluate', { dryRun: true }, 'Evaluate (dry-run)')}
					>
						Evaluate
					</button>
					<button
						type="button"
						className="admin-btn"
						disabled={!canManage || busy === 'execute'}
						onClick={() => runAction('execute', {}, 'Execute failover')}
					>
						<ArrowRightLeft size={16} /> Execute failover
					</button>
					<button
						type="button"
						className="admin-btn"
						disabled={!canManage || busy === 'recover'}
						onClick={() => runAction('recover', {}, 'Recover preferred')}
					>
						Recover preferred
					</button>
				</div>
			</section>

			<section className="admin-card mb-4">
				<div className="flex flex-wrap items-center justify-between gap-2 mb-3">
					<h2 className="admin-section-title m-0">Simulation Mode</h2>
					<div className="flex gap-2">
						<button type="button" className="admin-btn" disabled={busy === 'simulate'} onClick={() => runSimulate('failover')}>
							<Play size={16} /> Simulate failover
						</button>
						<button type="button" className="admin-btn" disabled={busy === 'simulate'} onClick={() => runSimulate('recovery')}>
							Simulate recovery
						</button>
					</div>
				</div>
				<p className="admin-note mt-0">Never writes configuration, audit logs, or billing.provider.</p>
				{simulation ? (
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<div><p className="admin-stat__label">Current</p><p>{simulation.currentProvider || simulation.activeProvider}</p></div>
						<div><p className="admin-stat__label">Eligible</p><p>{(simulation.eligibleProviders || []).join(', ') || '—'}</p></div>
						<div><p className="admin-stat__label">Candidate</p><p>{simulation.selectedCandidate || '—'}</p></div>
						<div><p className="admin-stat__label">Reason / blocking</p><p>{simulation.blockingReason || simulation.reasonCode || '—'}</p></div>
						<div><p className="admin-stat__label">Predicted action</p><p>{simulation.predictedAction || '—'}</p></div>
					</div>
				) : (
					<p style={{ color: 'var(--admin-muted)' }}>Run a simulation to preview the decision.</p>
				)}
			</section>

			<section className="admin-card">
				<h2 className="admin-section-title">Event Timeline</h2>
				{events.length === 0 && !(status?.recentEvents || []).length ? (
					<AdminEmptyState title="No failover events yet" />
				) : (
					<div className="overflow-x-auto">
						<table className="admin-table">
							<thead>
								<tr>
									<th>When</th>
									<th>Action</th>
									<th>Reason</th>
									<th>Provider</th>
									<th>Administrator</th>
								</tr>
							</thead>
							<tbody>
								{events.map((row) => (
									<tr key={row.id}>
										<td>{formatWhen(row.timestamp)}</td>
										<td>{row.action}</td>
										<td>{row.reasonCode || '—'}</td>
										<td>{row.provider || '—'}</td>
										<td>{row.administrator || '—'}</td>
									</tr>
								))}
								{!(events.length) && (status?.recentEvents || []).map((row, index) => (
									<tr key={`recent-${index}`}>
										<td>{formatWhen(row.at)}</td>
										<td>{row.type}</td>
										<td>{row.reasonCode || '—'}</td>
										<td>{row.to || row.from || '—'}</td>
										<td>—</td>
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
