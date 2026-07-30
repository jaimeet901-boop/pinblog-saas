import { Button, Card } from '@/components/kit';
import { setupStepMessage, setupStepWhy } from '@/lib/websites/websiteLifecycle';

/**
 * Guided Website Setup progress card (Phase 1).
 * One primary CTA; optional secondary for Skip / review.
 */
export default function SetupProgressCard({
	lifecycle,
	onPrimary,
	onSecondary,
	primaryBusy = false,
	className = '',
	compact = false,
}) {
	if (!lifecycle || lifecycle.mode === 'operate' && lifecycle.step === 'operate') {
		return null;
	}

	const stages = lifecycle.stages || lifecycle.checklist || [];
	const why = setupStepWhy(lifecycle.step);
	const title = lifecycle.mode === 'operate' && lifecycle.step === 'analytics'
		? 'First pin published'
		: 'Setup progress';

	return (
		<Card className={`border-primary/30 bg-primary/5 ${className}`.trim()}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
					<p className="mt-1 text-sm font-medium">{setupStepMessage(lifecycle.step)}</p>
					{why ? <p className="mt-1 text-xs text-muted-foreground">{why}</p> : null}
				</div>
				<p className="text-xs text-muted-foreground">
					{lifecycle.doneCount}/{lifecycle.totalStages || stages.length} complete
				</p>
			</div>

			<ol className={`mt-3 grid gap-1 ${compact ? '' : 'sm:grid-cols-2'}`}>
				{stages.map((item) => {
					const current = item.id === lifecycle.step
						|| (lifecycle.step === 'articles' && item.id === 'pins' && !lifecycle.hasPin)
						|| (lifecycle.step === 'scan' && item.id === 'scan');
					return (
						<li
							key={item.id}
							className={`text-xs ${item.done ? 'text-foreground' : 'text-muted-foreground'} ${current && !item.done ? 'font-semibold text-primary' : ''}`}
						>
							{item.done ? '✓' : '○'} {item.label}
						</li>
					);
				})}
			</ol>

			<div className="mt-4 flex flex-wrap items-center gap-2">
				<Button size="sm" onClick={onPrimary} disabled={primaryBusy}>
					{primaryBusy ? 'Working…' : lifecycle.primaryLabel}
				</Button>
				{lifecycle.secondaryLabel && onSecondary ? (
					<Button size="sm" variant="ghost" onClick={onSecondary}>
						{lifecycle.secondaryLabel}
					</Button>
				) : null}
			</div>
		</Card>
	);
}
