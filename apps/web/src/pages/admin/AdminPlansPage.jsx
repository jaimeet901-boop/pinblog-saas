import { useEffect, useMemo, useState } from 'react';
import {
	Eye, Pencil, Copy, Power, PowerOff, Trash2, X, Check,
} from 'lucide-react';
import { AdminHero, StatusPill } from '@/components/admin/AdminUi';
import { MOCK_PLANS } from '@/pages/admin/mockData';

const BACKEND_READY = false;

function yesNo(value) {
	return value ? 'Yes' : 'No';
}

function formatLimit(value) {
	if (value === 'Custom' || value == null) return String(value ?? '—');
	return Number(value).toLocaleString();
}

export default function AdminPlansPage() {
	const [selectedId, setSelectedId] = useState('');
	const selected = MOCK_PLANS.find((plan) => plan.id === selectedId) || null;

	const stats = useMemo(() => {
		const total = MOCK_PLANS.length;
		const active = MOCK_PLANS.filter((plan) => plan.status === 'active').length;
		const subscribers = MOCK_PLANS.reduce((sum, plan) => sum + Number(plan.subscribers || 0), 0);
		const monthlyConsumption = MOCK_PLANS.reduce(
			(sum, plan) => sum + Number(plan.avgUsage || 0) * Number(plan.subscribers || 0),
			0,
		);
		return { total, active, subscribers, monthlyConsumption };
	}, []);

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
				title="Plans & Credits"
				description="Manage subscription plans, limits, and credit allocations. Mock catalog only — billing APIs unchanged."
			/>

			<div className="admin-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
				{[
					{ label: 'Total Plans', value: stats.total },
					{ label: 'Active Plans', value: stats.active },
					{ label: 'Total Subscribers', value: stats.subscribers.toLocaleString() },
					{ label: 'Monthly Credit Consumption', value: stats.monthlyConsumption.toLocaleString() },
				].map((card) => (
					<div key={card.label} className="admin-stat">
						<p className="admin-stat__label">{card.label}</p>
						<p className="admin-stat__value">{card.value}</p>
						<p className="admin-stat__hint">Placeholder</p>
					</div>
				))}
			</div>

			<div className="admin-plans-grid">
				{MOCK_PLANS.map((plan) => (
					<article
						key={plan.id}
						className={`admin-plan-card ${plan.highlight ? 'is-highlight' : ''} ${selectedId === plan.id ? 'is-selected' : ''}`}
						onClick={() => setSelectedId(plan.id)}
					>
						<div className="flex items-start justify-between gap-2">
							<div>
								{plan.highlight ? <span className="admin-pill admin-pill--green mb-2">Popular</span> : null}
								<h4>{plan.name}</h4>
							</div>
							<StatusPill status={plan.status} />
						</div>

						<p className="admin-plan-card__price">
							${plan.price}
							<span>/mo</span>
						</p>

						<ul className="admin-plan-card__list">
							<li><Check size={13} /> {plan.credits.toLocaleString()} credits included</li>
							<li><Check size={13} /> {formatLimit(plan.maxWorkspaces)} workspaces</li>
							<li><Check size={13} /> {formatLimit(plan.maxWordpress)} WordPress sites</li>
							<li><Check size={13} /> {formatLimit(plan.maxPinterest)} Pinterest accounts</li>
							<li><Check size={13} /> {plan.aiModels}</li>
							<li><Check size={13} /> Priority queue · {yesNo(plan.priorityQueue)}</li>
							<li><Check size={13} /> Support · {plan.support}</li>
						</ul>

						<div className="admin-plan-card__actions" onClick={(event) => event.stopPropagation()}>
							<button type="button" className="admin-btn" onClick={() => setSelectedId(plan.id)}>
								<Eye size={12} /> View
							</button>
							<button type="button" className="admin-btn admin-btn--primary" disabled={!BACKEND_READY} title="Backend not available">
								<Pencil size={12} /> Edit Plan
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<Copy size={12} /> Duplicate
							</button>
						</div>
					</article>
				))}
			</div>

			<section className="admin-card mt-4">
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					<h3 className="m-0">Credits by plan</h3>
					<p className="admin-note m-0">Allocation table · mock usage only</p>
				</div>
				<div className="admin-table-wrap">
					<table className="admin-table" style={{ minWidth: '52rem' }}>
						<thead>
							<tr>
								<th>Plan</th>
								<th>Monthly Credits</th>
								<th>Bonus Credits</th>
								<th>Roll-over</th>
								<th>Top-up Allowed</th>
								<th>Current Subscribers</th>
								<th>Average Monthly Usage</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{MOCK_PLANS.map((plan) => (
								<tr
									key={`credits-${plan.id}`}
									className={selectedId === plan.id ? 'is-selected' : ''}
									onClick={() => setSelectedId(plan.id)}
								>
									<td className="font-medium">{plan.name}</td>
									<td>{plan.credits.toLocaleString()}</td>
									<td>{plan.bonusCredits.toLocaleString()}</td>
									<td>{plan.rollover ? <span className="admin-pill admin-pill--green">Yes</span> : <span className="admin-pill">No</span>}</td>
									<td>{plan.topupAllowed ? <span className="admin-pill admin-pill--green">Yes</span> : <span className="admin-pill">No</span>}</td>
									<td>{plan.subscribers.toLocaleString()}</td>
									<td style={{ color: 'var(--admin-muted)' }}>{plan.avgUsage.toLocaleString()}</td>
									<td onClick={(event) => event.stopPropagation()}>
										<button type="button" className="admin-btn" onClick={() => setSelectedId(plan.id)}>
											<Eye size={12} /> View
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			{selected ? (
				<div className="admin-drawer-overlay" role="dialog" aria-modal="true" aria-label="Plan details" onClick={() => setSelectedId('')}>
					<aside className="admin-user-drawer admin-user-drawer--wide" onClick={(event) => event.stopPropagation()}>
						<div className="admin-user-drawer__head">
							<div>
								<p className="font-display text-xl font-semibold leading-tight">{selected.name}</p>
								<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>
									${selected.price}/mo · {selected.subscribers.toLocaleString()} subscribers
								</p>
								<div className="mt-2 flex flex-wrap gap-2">
									<StatusPill status={selected.status} />
									{selected.highlight ? <span className="admin-pill admin-pill--green">Popular</span> : null}
								</div>
							</div>
							<button type="button" className="admin-icon-btn" onClick={() => setSelectedId('')} aria-label="Close">
								<X size={16} />
							</button>
						</div>

						<section className="admin-user-drawer__section">
							<h3>Plan Information</h3>
							<div className="admin-meta-row"><span>Name</span><span>{selected.name}</span></div>
							<div className="admin-meta-row"><span>Monthly price</span><span>${selected.price}</span></div>
							<div className="admin-meta-row"><span>Status</span><StatusPill status={selected.status} /></div>
							<div className="admin-meta-row"><span>Support level</span><span>{selected.support}</span></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Monthly Credits</h3>
							<div className="admin-meta-row"><span>Included</span><span>{selected.credits.toLocaleString()}</span></div>
							<div className="admin-meta-row"><span>Bonus</span><span>{selected.bonusCredits.toLocaleString()}</span></div>
							<div className="admin-meta-row"><span>Avg usage</span><span>{selected.avgUsage.toLocaleString()}</span></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Credit Refill Policy</h3>
							<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.refillPolicy}</p>
							<div className="admin-meta-row mt-2"><span>Roll-over</span><span>{yesNo(selected.rollover)}</span></div>
							<div className="admin-meta-row"><span>Top-up allowed</span><span>{yesNo(selected.topupAllowed)}</span></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Workspace Limits</h3>
							<div className="admin-meta-row"><span>Max workspaces</span><span>{formatLimit(selected.maxWorkspaces)}</span></div>
							<div className="admin-meta-row"><span>Max WordPress sites</span><span>{formatLimit(selected.maxWordpress)}</span></div>
							<div className="admin-meta-row"><span>Max Pinterest accounts</span><span>{formatLimit(selected.maxPinterest)}</span></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Publishing Limits</h3>
							<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.publishingLimits}</p>
						</section>

						<section className="admin-user-drawer__section">
							<h3>AI Features</h3>
							<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.aiFeatures}</p>
							<div className="admin-meta-row mt-2"><span>AI models access</span><span>{selected.aiModels}</span></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Image Generation Limits</h3>
							<p className="text-sm" style={{ color: 'var(--admin-muted)' }}>{selected.imageLimits}</p>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Storage Limits</h3>
							<div className="admin-meta-row"><span>Storage</span><span>{formatLimit(selected.storageGb)} GB</span></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>API Access</h3>
							<div className="admin-meta-row"><span>API access</span><StatusPill status={selected.apiAccess ? 'connected' : 'disconnected'} /></div>
						</section>

						<section className="admin-user-drawer__section">
							<h3>Priority Processing</h3>
							<div className="admin-meta-row"><span>Priority queue</span><span>{yesNo(selected.priorityQueue)}</span></div>
							<div className="admin-meta-row"><span>Priority processing</span><span>{yesNo(selected.priorityProcessing)}</span></div>
						</section>

						<div className="admin-user-drawer__actions">
							<button type="button" className="admin-btn" onClick={() => {}}>
								<Eye size={13} /> View
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<Pencil size={13} /> Edit Plan
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<Copy size={13} /> Duplicate Plan
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<Power size={13} /> Enable
							</button>
							<button type="button" className="admin-btn" disabled={!BACKEND_READY} title="Backend not available">
								<PowerOff size={13} /> Disable
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
