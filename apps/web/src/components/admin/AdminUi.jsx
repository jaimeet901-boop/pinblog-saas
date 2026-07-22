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
	if (['active', 'healthy', 'connected', 'completed', 'enabled', 'operational', 'success'].includes(value)) tone = 'admin-pill--green';
	else if (['waiting', 'trial', 'warn', 'warning', 'degraded', 'retry', 'invited', 'ready'].includes(value)) tone = 'admin-pill--amber';
	else if (['failed', 'error', 'suspended', 'disabled', 'danger'].includes(value)) tone = 'admin-pill--red';
	else if (['running', 'info', 'pro', 'agency'].includes(value)) tone = 'admin-pill--blue';
	return <span className={`admin-pill ${tone}`}>{status}</span>;
}
