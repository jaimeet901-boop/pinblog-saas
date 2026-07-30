import { Button, Card } from '@/components/kit';

function formatDateTime(value) {
	if (!value) return '—';
	try {
		return new Date(value).toLocaleString();
	} catch {
		return '—';
	}
}

function formatStatValue(value) {
	if (value === 0) return '0';
	if (value == null || value === '') return '—';
	return value;
}

/**
 * Compact analytics snapshot → full Analytics page (Phase 2B).
 */
export default function OperateAnalyticsSnapshot({
	publishedPins,
	successRate,
	lastPublishAt,
	lastPublishTitle,
	aiPinsGenerated,
	onOpenAnalytics,
}) {
	return (
		<Card className="mb-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Analytics snapshot</p>
					<p className="mt-1 text-sm text-muted-foreground">Recent performance for this website.</p>
				</div>
				<Button size="sm" onClick={onOpenAnalytics}>Open Analytics</Button>
			</div>
			<div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<div>
					<p className="text-[11px] text-muted-foreground">Published pins</p>
					<p className="mt-1 text-lg font-semibold">{formatStatValue(publishedPins)}</p>
				</div>
				<div>
					<p className="text-[11px] text-muted-foreground">Success rate</p>
					<p className="mt-1 text-lg font-semibold">{successRate != null ? `${successRate}%` : '—'}</p>
				</div>
				<div>
					<p className="text-[11px] text-muted-foreground">AI pins generated</p>
					<p className="mt-1 text-lg font-semibold">{formatStatValue(aiPinsGenerated)}</p>
				</div>
				<div>
					<p className="text-[11px] text-muted-foreground">Last publish</p>
					<p className="mt-1 truncate text-sm font-medium">{lastPublishTitle || '—'}</p>
					<p className="text-[11px] text-muted-foreground">{formatDateTime(lastPublishAt)}</p>
				</div>
			</div>
		</Card>
	);
}
