import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2, Plus } from 'lucide-react';
import {
	AdminHero, AdminSkeleton, AdminEmptyState, AdminErrorState, StatusPill,
} from '@/components/admin/AdminUi';
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

export default function AdminCreditsPage() {
	const { toast } = useToast();
	const [summary, setSummary] = useState(null);
	const [ledger, setLedger] = useState([]);
	const [usage, setUsage] = useState([]);
	const [reservations, setReservations] = useState([]);
	const [history, setHistory] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [saving, setSaving] = useState(false);
	const [showGrant, setShowGrant] = useState(false);
	const [grantForm, setGrantForm] = useState({
		workspaceName: '',
		amount: '100',
		reason: 'Admin grant',
		type: 'grant',
		bonus: false,
	});

	const loadData = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const [summaryRes, ledgerRes, usageRes, reservationsRes, historyRes] = await Promise.all([
				apiServerClient.fetch('/admin/v1/credits/summary'),
				apiServerClient.fetch('/admin/v1/credits/ledger?perPage=20'),
				apiServerClient.fetch('/admin/v1/credits/usage'),
				apiServerClient.fetch('/admin/v1/credits/reservations?perPage=20'),
				apiServerClient.fetch('/admin/v1/credits/history?perPage=20'),
			]);
			if (!summaryRes.ok) throw new Error(await readApiError(summaryRes));
			if (!ledgerRes.ok) throw new Error(await readApiError(ledgerRes));
			if (!usageRes.ok) throw new Error(await readApiError(usageRes));
			setSummary(await summaryRes.json());
			const ledgerData = await ledgerRes.json();
			const usageData = await usageRes.json();
			setLedger(Array.isArray(ledgerData.items) ? ledgerData.items : []);
			setUsage(Array.isArray(usageData.items) ? usageData.items : []);
			if (reservationsRes.ok) {
				const data = await reservationsRes.json();
				setReservations(Array.isArray(data.items) ? data.items : []);
			} else {
				setReservations([]);
			}
			if (historyRes.ok) {
				const data = await historyRes.json();
				setHistory(Array.isArray(data.items) ? data.items : []);
			} else {
				setHistory([]);
			}
		} catch (err) {
			setError(err?.message || 'Failed to load credits');
			setSummary(null);
			setLedger([]);
			setUsage([]);
			setReservations([]);
			setHistory([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadData();
	}, [loadData]);

	const submitGrant = async () => {
		setSaving(true);
		try {
			const response = await apiServerClient.fetch('/admin/v1/credits/grant', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					workspaceName: grantForm.workspaceName.trim(),
					workspaceKey: grantForm.workspaceName.trim(),
					amount: Number(grantForm.amount),
					reason: grantForm.reason,
					type: grantForm.type,
					bonus: grantForm.bonus,
					feature: grantForm.bonus ? 'bonus' : undefined,
				}),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const result = await response.json();
			toast({
				title: 'Credits updated',
				description: `${result.workspaceName}: ${result.amount > 0 ? '+' : ''}${result.amount} → balance ${result.balance}`,
			});
			setShowGrant(false);
			setGrantForm({ workspaceName: '', amount: '100', reason: 'Admin grant', type: 'grant', bonus: false });
			await loadData();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Grant failed', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	const runWalletAction = async (workspaceKey, path, body = {}) => {
		setSaving(true);
		try {
			const response = await apiServerClient.fetch(`/admin/v1/credits/${path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ workspaceKey, ...body }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Updated', description: `${workspaceKey} · ${path}` });
			await loadData();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Action failed', description: err?.message });
		} finally {
			setSaving(false);
		}
	};

	return (
		<div>
			<AdminHero
				title="Credits"
				description="Credit wallets, transactions, reservations, refunds, resets, and workspace history."
				action={(
					<div className="flex flex-wrap gap-2">
						<button type="button" className="admin-btn" onClick={loadData} disabled={loading}>
							<RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Reload
						</button>
						<button type="button" className="admin-btn admin-btn--primary" onClick={() => setShowGrant(true)}>
							<Plus size={14} /> Grant / adjust
						</button>
					</div>
				)}
			/>

			{loading ? <section className="admin-card"><AdminSkeleton rows={5} /></section> : null}
			{!loading && error ? (
				<section className="admin-card">
					<AdminErrorState title="Unable to load credits" description={error} />
					<div className="mt-3"><button type="button" className="admin-btn admin-btn--primary" onClick={loadData}>Retry</button></div>
				</section>
			) : null}

			{!loading && !error && summary ? (
				<div className="admin-stats admin-stats--compact">
					{[
						{ label: 'Credits issued', value: Number(summary.creditsIssued || 0).toLocaleString() },
						{ label: 'Credits burned', value: Number(summary.creditsBurned || 0).toLocaleString() },
						{ label: 'Refunds', value: Number(summary.creditsRefunded || 0).toLocaleString() },
						{ label: 'Bonus issued', value: Number(summary.bonusIssued || 0).toLocaleString() },
						{ label: 'Avg / workspace', value: Number(summary.avgPerWorkspace || 0).toLocaleString() },
						{ label: 'Open reservations', value: Number(summary.openReservations || 0).toLocaleString() },
						{ label: 'Reserved credits', value: Number(summary.reservedCredits || 0).toLocaleString() },
						{ label: 'Top-ups (30d)', value: Number(summary.topups30d || 0).toLocaleString() },
					].map((card) => (
						<div key={card.label} className="admin-stat">
							<p className="admin-stat__label">{card.label}</p>
							<p className="admin-stat__value">{card.value}</p>
							<p className="admin-stat__hint">Live</p>
						</div>
					))}
				</div>
			) : null}

			{!loading && !error ? (
				<>
					<section className="admin-card">
						<h3>Credit wallets</h3>
						{(summary?.wallets || []).length === 0 ? (
							<AdminEmptyState title="No wallets" description="Workspace subscriptions appear here once created." />
						) : (
							<div className="admin-table-wrap">
								<table className="admin-table">
									<thead>
										<tr>
											<th>Workspace</th>
											<th>Balance</th>
											<th>Purchased</th>
											<th>Bonus</th>
											<th>Used total</th>
											<th>Billing</th>
											<th>Suspended</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										{(summary?.wallets || []).map((wallet) => (
											<tr key={wallet.workspaceKey}>
												<td className="font-medium">{wallet.workspaceName}</td>
												<td>{Number(wallet.balance || 0).toLocaleString()}</td>
												<td>{Number(wallet.purchasedCredits || 0).toLocaleString()}</td>
												<td>{Number(wallet.bonusCredits || 0).toLocaleString()}</td>
												<td>{Number(wallet.usedTotal || 0).toLocaleString()}</td>
												<td><StatusPill status={wallet.billingStatus || 'active'} /></td>
												<td><StatusPill status={wallet.suspended ? 'suspended' : 'active'} /></td>
												<td>
													<div className="flex flex-wrap gap-1">
														<button type="button" className="admin-btn" disabled={saving} onClick={() => runWalletAction(wallet.workspaceKey, 'reset')}>Reset</button>
														<button
															type="button"
															className="admin-btn"
															disabled={saving}
															onClick={() => runWalletAction(wallet.workspaceKey, wallet.suspended ? 'unsuspend' : 'suspend', { suspended: !wallet.suspended })}
														>
															{wallet.suspended ? 'Unsuspend' : 'Suspend'}
														</button>
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</section>

					<section className="admin-card mt-4">
						<h3>Credit transactions</h3>
						{ledger.length === 0 ? (
							<AdminEmptyState title="No credit transactions" description="Grants, burns, refunds, and adjustments appear here." />
						) : (
							<div className="admin-list">
								{ledger.map((row) => (
									<div key={row.id} className="admin-list__item">
										<span>
											<strong className="block">{row.text}</strong>
											<span style={{ color: 'var(--admin-muted)', fontSize: '0.75rem' }}>
												balance {Number(row.balance || 0).toLocaleString()} · {row.createdBy || 'system'}
												{row.reservationId ? ` · reservation ${row.reservationId}` : ''}
											</span>
										</span>
										<span>{row.timeLabel}</span>
									</div>
								))}
							</div>
						)}
					</section>

					<section className="admin-card mt-4">
						<h3>Credit reservations</h3>
						{reservations.length === 0 ? (
							<AdminEmptyState title="No open reservations" description="Reserved credits appear while jobs hold balance." />
						) : (
							<div className="admin-table-wrap">
								<table className="admin-table">
									<thead>
										<tr>
											<th>Workspace</th>
											<th>Amount</th>
											<th>Feature</th>
											<th>Status</th>
											<th>Expires</th>
										</tr>
									</thead>
									<tbody>
										{reservations.map((row) => (
											<tr key={row.id}>
												<td className="font-medium">{row.workspaceName}</td>
												<td>{Number(row.amount || 0).toLocaleString()}</td>
												<td>{row.feature || '—'}</td>
												<td><StatusPill status={row.status} /></td>
												<td style={{ color: 'var(--admin-muted)' }}>{row.expiresAt ? new Date(row.expiresAt).toLocaleString() : '—'}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</section>

					<section className="admin-card mt-4">
						<h3>Workspace credit / billing history</h3>
						{history.length === 0 ? (
							<AdminEmptyState title="No billing events" description="Upgrades, resets, top-ups, and suspensions appear here." />
						) : (
							<div className="admin-list">
								{history.map((row) => (
									<div key={row.id} className="admin-list__item">
										<span>
											<strong className="block">{row.workspaceName} · {row.eventType}</strong>
											<span style={{ color: 'var(--admin-muted)', fontSize: '0.75rem' }}>
												{row.message || `${row.fromPlan || '—'} → ${row.toPlan || '—'}`}
											</span>
										</span>
										<span>{row.occurredAt ? new Date(row.occurredAt).toLocaleDateString() : '—'}</span>
									</div>
								))}
							</div>
						)}
					</section>

					<section className="admin-card mt-4">
						<h3>Workspace usage (current period)</h3>
						{usage.length === 0 ? (
							<AdminEmptyState title="No usage rows" description="Monthly usage aggregates will appear after activity." />
						) : (
							<div className="admin-table-wrap">
								<table className="admin-table">
									<thead>
										<tr>
											<th>Workspace</th>
											<th>Articles</th>
											<th>Images</th>
											<th>Tokens</th>
											<th>Queue Jobs</th>
											<th>Publishing</th>
											<th>API Calls</th>
											<th>Credits Burned</th>
										</tr>
									</thead>
									<tbody>
										{usage.map((row) => (
											<tr key={row.id}>
												<td className="font-medium">{row.workspaceName}</td>
												<td>{row.articles.toLocaleString()}</td>
												<td>{row.images.toLocaleString()}</td>
												<td>{row.tokens.toLocaleString()}</td>
												<td>{row.queueJobs.toLocaleString()}</td>
												<td>{row.publishing.toLocaleString()}</td>
												<td>{row.apiCalls.toLocaleString()}</td>
												<td>{row.creditsBurned.toLocaleString()}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</section>
				</>
			) : null}

			{showGrant ? (
				<div className="admin-modal-overlay" role="dialog" aria-modal="true" onClick={() => setShowGrant(false)}>
					<div className="admin-modal" onClick={(event) => event.stopPropagation()}>
						<h2>Grant / refund / adjust credits</h2>
						<p className="mt-1 text-sm" style={{ color: 'var(--admin-muted)' }}>
							Creates a credit transaction and updates the workspace wallet.
						</p>
						<div className="admin-config-grid mt-3">
							<div className="admin-field">
								<label>Workspace</label>
								<input
									value={grantForm.workspaceName}
									onChange={(e) => setGrantForm((prev) => ({ ...prev, workspaceName: e.target.value }))}
									placeholder="Sunday Kitchen"
								/>
							</div>
							<div className="admin-field">
								<label>Amount</label>
								<input
									value={grantForm.amount}
									onChange={(e) => setGrantForm((prev) => ({ ...prev, amount: e.target.value }))}
								/>
							</div>
							<div className="admin-field">
								<label>Type</label>
								<select
									value={grantForm.type}
									onChange={(e) => setGrantForm((prev) => ({ ...prev, type: e.target.value }))}
								>
									<option value="grant">grant</option>
									<option value="topup">topup (purchased)</option>
									<option value="adjust">adjust</option>
									<option value="burn">burn</option>
									<option value="refund">refund</option>
								</select>
							</div>
							<div className="admin-field">
								<label>Reason</label>
								<input
									value={grantForm.reason}
									onChange={(e) => setGrantForm((prev) => ({ ...prev, reason: e.target.value }))}
								/>
							</div>
						</div>
						<label className="admin-check mt-3">
							<input
								type="checkbox"
								checked={grantForm.bonus}
								onChange={(e) => setGrantForm((prev) => ({ ...prev, bonus: e.target.checked }))}
							/>
							Bonus credits
						</label>
						<div className="admin-modal__actions">
							<button type="button" className="admin-btn" onClick={() => setShowGrant(false)}>Cancel</button>
							<button type="button" className="admin-btn admin-btn--primary" onClick={submitGrant} disabled={saving}>
								{saving ? <Loader2 size={14} className="animate-spin" /> : null}
								{saving ? 'Saving…' : 'Apply'}
							</button>
						</div>
						<div className="mt-2"><StatusPill status="ready" /></div>
					</div>
				</div>
			) : null}
		</div>
	);
}
