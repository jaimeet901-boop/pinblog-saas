import { Button, Card } from '@/components/kit';

function formatStatValue(value) {
	if (value === 0) return '0';
	if (value == null || value === '') return '—';
	return value;
}

/**
 * Compact publishing pipeline counts → Publishing History (Phase 2B).
 */
export default function OperatePublishingPipeline({
	drafts = 0,
	scheduled = 0,
	published = 0,
	failed = 0,
	onOpenHistory,
}) {
	const cells = [
		{ label: 'Draft', value: drafts },
		{ label: 'Scheduled', value: scheduled },
		{ label: 'Published', value: published },
		{ label: 'Failed', value: failed },
	];

	return (
		<Card className="h-full">
			<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Publishing pipeline</p>
			<p className="mt-1 text-sm text-muted-foreground">Pin pipeline for this website.</p>
			<button
				type="button"
				onClick={onOpenHistory}
				className="mt-3 grid w-full grid-cols-2 gap-2 sm:grid-cols-4"
			>
				{cells.map((cell) => (
					<div key={cell.label} className="rounded-xl border border-border bg-secondary/30 px-3 py-3 text-left transition hover:bg-secondary/50">
						<p className="text-[11px] text-muted-foreground">{cell.label}</p>
						<p className="mt-1 text-xl font-semibold">{formatStatValue(cell.value)}</p>
					</div>
				))}
			</button>
			<div className="mt-3">
				<Button size="sm" variant="outline" onClick={onOpenHistory}>Open Publishing History</Button>
			</div>
		</Card>
	);
}
