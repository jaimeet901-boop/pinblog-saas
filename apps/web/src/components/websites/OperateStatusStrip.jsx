import { Badge, Card } from '@/components/kit';

function formatDateTime(value) {
	if (!value) return '—';
	try {
		return new Date(value).toLocaleString();
	} catch {
		return '—';
	}
}

function statusTone(status) {
	const value = String(status || '').toLowerCase();
	if (['connected', 'active', 'ready', 'healthy', 'operational', 'ok', 'published', 'completed', 'configured', 'green'].includes(value)) {
		return 'green';
	}
	if (['failed', 'error', 'down', 'disconnected', 'not_configured', 'red'].includes(value)) {
		return 'red';
	}
	if (['running', 'scanning', 'queued', 'pending', 'degraded', 'scheduled', 'paused', 'untested', 'idle', 'amber', 'blue'].includes(value)) {
		return 'amber';
	}
	return 'default';
}

/**
 * Compact Operate Mode status strip (Phase 2B).
 */
export default function OperateStatusStrip({
	website,
	lifecycle,
	health,
	systemHealth,
	pinterestConnected,
	lastScan,
	score,
}) {
	const wpStatus = health?.wordpressConnection?.status
		|| systemHealth?.wordpress?.status
		|| (lifecycle?.wpConnected ? 'connected' : 'not_connected');
	const wpTone = health?.wordpressConnection?.tone
		|| systemHealth?.wordpress?.tone
		|| statusTone(wpStatus);
	const pinterestStatus = pinterestConnected
		? (systemHealth?.pinterest?.status || 'connected')
		: (systemHealth?.pinterest?.status || 'not_connected');
	const pinterestTone = pinterestConnected
		? (systemHealth?.pinterest?.tone || 'green')
		: (systemHealth?.pinterest?.tone || statusTone(pinterestStatus));
	const healthScore = score?.score ?? systemHealth?.score?.score;
	const healthLabel = score?.label || systemHealth?.score?.label || website?.status || '—';
	const healthTone = score?.tone || systemHealth?.score?.tone || statusTone(healthLabel);

	const cells = [
		{ label: 'Website', value: website?.status || '—', tone: statusTone(website?.status) },
		{ label: 'Mode', value: lifecycle?.mode === 'operate' ? 'Operate' : 'Setup', tone: lifecycle?.mode === 'operate' ? 'green' : 'amber' },
		{ label: 'WordPress', value: wpStatus, tone: wpTone },
		{ label: 'Pinterest', value: pinterestStatus, tone: pinterestTone },
		{ label: 'Last scan', value: formatDateTime(lastScan), tone: 'default', plain: true },
		{
			label: 'Health',
			value: healthScore != null ? `${healthScore}/100 · ${healthLabel}` : healthLabel,
			tone: healthTone,
		},
	];

	return (
		<Card className="mb-4">
			<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Website status</p>
			<div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
				{cells.map((cell) => (
					<div key={cell.label} className="min-w-0">
						<p className="text-[11px] text-muted-foreground">{cell.label}</p>
						{cell.plain ? (
							<p className="mt-1 truncate text-sm font-medium">{cell.value}</p>
						) : (
							<div className="mt-1">
								<Badge tone={cell.tone}>{cell.value}</Badge>
							</div>
						)}
					</div>
				))}
			</div>
		</Card>
	);
}
