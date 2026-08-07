import { Button, Card } from '@/components/kit';
import { setupStepMessage, setupStepWhy } from '@/lib/websites/websiteLifecycle';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';

const FACEBOOK_SETUP_STAGE = { id: 'facebook_posts', label: 'Generate First Facebook Post' };

function resolveSetupStages(lifecycle) {
	const baseStages = lifecycle.stages || lifecycle.checklist || [];
	if (!lifecycle.facebookSetupEnabled) {
		return baseStages;
	}

	if (baseStages.some((stage) => stage.id === 'facebook_posts')) {
		return baseStages;
	}

	const pinsIndex = baseStages.findIndex((stage) => stage.id === 'pins');
	const stages = [...baseStages];
	const facebookStage = {
		...FACEBOOK_SETUP_STAGE,
		done: Boolean(lifecycle.hasFacebookPost),
	};

	if (pinsIndex >= 0) {
		stages.splice(pinsIndex + 1, 0, facebookStage);
	} else {
		stages.push(facebookStage);
	}

	return stages;
}

const CONTENT_SETUP_STEPS = new Set(['articles', 'pinterest', 'publish']);

function shouldShowFacebookPrimary(lifecycle, onFacebookPrimary) {
	if (!lifecycle.facebookSetupEnabled || typeof onFacebookPrimary !== 'function') {
		return false;
	}

	if (!lifecycle.hasArticles) {
		return false;
	}

	// Content-creation setup: show alongside primary CTA until publish completes setup.
	return lifecycle.mode === 'setup' && CONTENT_SETUP_STEPS.has(lifecycle.step);
}

/**
 * Guided Website Setup progress card (Phase 1).
 * One primary CTA; optional secondary for Skip / review.
 */
export default function SetupProgressCard({
	lifecycle,
	onPrimary,
	onSecondary,
	onFacebookPrimary,
	primaryBusy = false,
	className = '',
	compact = false,
}) {
	const { platformName } = usePlatformIdentity();

	if (!lifecycle || lifecycle.mode === 'operate' && lifecycle.step === 'operate') {
		return null;
	}

	const stages = resolveSetupStages(lifecycle);
	const doneCount = stages.filter((stage) => stage.done).length;
	const totalStages = stages.length;
	const showFacebookPrimary = shouldShowFacebookPrimary(lifecycle, onFacebookPrimary);
	const why = setupStepWhy(lifecycle.step, platformName);
	const title = lifecycle.mode === 'operate' && lifecycle.step === 'analytics'
		? 'First pin published'
		: 'Setup progress';

	return (
		<Card className={`border-primary/30 bg-primary/5 ${className}`.trim()}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
					<p className="mt-1 text-sm font-medium">{setupStepMessage(lifecycle.step, platformName)}</p>
					{why ? <p className="mt-1 text-xs text-muted-foreground">{why}</p> : null}
				</div>
				<p className="text-xs text-muted-foreground">
					{doneCount}/{totalStages} complete
				</p>
			</div>

			<ol className={`mt-3 grid gap-1 ${compact ? '' : 'sm:grid-cols-2'}`}>
				{stages.map((item) => {
					const current = item.id === lifecycle.step
						|| (lifecycle.step === 'articles' && item.id === 'pins' && !lifecycle.hasPin)
						|| (lifecycle.step === 'articles' && item.id === 'facebook_posts' && !lifecycle.hasFacebookPost)
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
				{showFacebookPrimary ? (
					<Button size="sm" onClick={onFacebookPrimary} disabled={primaryBusy}>
						Create Facebook Post
					</Button>
				) : null}
				{lifecycle.secondaryLabel && onSecondary ? (
					<Button size="sm" variant="ghost" onClick={onSecondary}>
						{lifecycle.secondaryLabel}
					</Button>
				) : null}
			</div>
		</Card>
	);
}
