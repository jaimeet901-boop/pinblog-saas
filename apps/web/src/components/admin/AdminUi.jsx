import { Inbox, AlertTriangle } from 'lucide-react';

export function AdminHero({ eyebrow = 'Chef IA Admin', title, description, action }) {
	return (
		<section className="admin-page-hero">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="admin-page-hero__eyebrow">{eyebrow}</p>
					<h1 className="admin-page-hero__title">{title}</h1>
					{description ? <p className="admin-page-hero__desc">{description}</p> : null}
				</div>
				{action}
			</div>
		</section>
	);
}

export function StatusPill({ status }) {
	const value = String(status || '').toLowerCase();
	let tone = '';
	if (['active', 'healthy', 'connected', 'completed', 'enabled', 'operational', 'success', 'online', 'ok'].includes(value)) tone = 'admin-pill--green';
	else if (['waiting', 'trial', 'warn', 'warning', 'degraded', 'retry', 'retrying', 'invited', 'ready', 'pending', 'queued', 'paused', 'throttled', 'scheduled', 'draft'].includes(value)) tone = 'admin-pill--amber';
	else if (['failed', 'error', 'suspended', 'disabled', 'danger', 'disconnected', 'cancelled', 'offline', 'critical', 'denied'].includes(value)) tone = 'admin-pill--red';
	else if (['running', 'info', 'pro', 'agency', 'admin', 'user', 'text', 'image', 'high', 'normal', 'low'].includes(value)) tone = 'admin-pill--blue';
	return <span className={`admin-pill ${tone}`}>{status}</span>;
}

export function AdminEmptyState({
	title = 'Nothing here yet',
	description = 'No records match the current view.',
	icon: Icon = Inbox,
}) {
	return (
		<div className="admin-empty" role="status">
			<span className="admin-empty__icon" aria-hidden="true">
				<Icon size={18} />
			</span>
			<p className="admin-empty__title">{title}</p>
			{description ? <p className="admin-empty__desc">{description}</p> : null}
		</div>
	);
}

export function AdminErrorState({
	title = 'Something went wrong',
	description = 'Unable to load this view. Try again after the backend is connected.',
}) {
	return (
		<div className="admin-error" role="alert">
			<span className="admin-error__icon" aria-hidden="true">
				<AlertTriangle size={18} />
			</span>
			<p className="admin-error__title">{title}</p>
			{description ? <p className="admin-error__desc">{description}</p> : null}
		</div>
	);
}

export function AdminSkeleton({ rows = 4, className = '' }) {
	return (
		<div className={`admin-skeleton ${className}`.trim()} aria-hidden="true">
			{Array.from({ length: rows }, (_, index) => (
				<div key={index} className="admin-skeleton__row" style={{ width: `${88 - (index % 3) * 12}%` }} />
			))}
		</div>
	);
}

export function AdminSkeletonTable({ rows = 5, cols = 4 }) {
	return (
		<div className="admin-skeleton-table" aria-busy="true" aria-label="Loading">
			{Array.from({ length: rows }, (_, row) => (
				<div key={row} className="admin-skeleton-table__row">
					{Array.from({ length: cols }, (_, col) => (
						<div key={col} className="admin-skeleton__row" />
					))}
				</div>
			))}
		</div>
	);
}

export function AdminPagination({
	total,
	page,
	totalPages,
	onPrev,
	onNext,
	noun = 'items',
}) {
	if (total === 0) {
		return (
			<AdminEmptyState
				title={`No ${noun} match`}
				description="Adjust search or filters and try again."
			/>
		);
	}

	return (
		<div className="admin-pagination">
			<p className="admin-note m-0">
				{total} {noun} · page {page} of {totalPages}
			</p>
			<div className="admin-pagination__actions">
				<button type="button" className="admin-btn" disabled={page <= 1} onClick={onPrev}>
					Previous
				</button>
				<button type="button" className="admin-btn" disabled={page >= totalPages} onClick={onNext}>
					Next
				</button>
			</div>
		</div>
	);
}

export function AdminChartCard({ title, series, note = 'Mock series · no live telemetry' }) {
	const max = Math.max(...series.map((row) => row.value), 1);
	return (
		<section className="admin-card admin-analytics-chart">
			<h3>{title}</h3>
			<div className="admin-analytics-chart__bars" aria-hidden="true">
				{series.map((row) => (
					<div key={row.label} className="admin-analytics-chart__col">
						<div className="admin-analytics-chart__track">
							<div
								className="admin-analytics-chart__fill"
								style={{ height: `${Math.max(8, (row.value / max) * 100)}%` }}
							/>
						</div>
						<span>{row.label}</span>
					</div>
				))}
			</div>
			{note ? <p className="admin-note">{note}</p> : null}
		</section>
	);
}

export function AdminProgressBar({ value }) {
	const pct = Math.max(0, Math.min(100, Number(value || 0)));
	return (
		<div className="admin-queue-progress" title={`${pct}%`}>
			<div className="admin-queue-progress__track">
				<div className="admin-queue-progress__fill" style={{ width: `${pct}%` }} />
			</div>
			<span>{pct}%</span>
		</div>
	);
}
