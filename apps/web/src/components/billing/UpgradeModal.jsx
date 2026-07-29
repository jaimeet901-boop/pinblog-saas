import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/components/kit';
import apiServerClient from '@/lib/apiServerClient';
import {
	formatMissingFeatureLabels,
	getTemplateAccess,
	suggestUpgradePlan,
} from '@/lib/templateAccess';
import {
	PRODUCT_EVENTS,
	buildTemplateEventProps,
	trackProductEvent,
} from '@/lib/productAnalytics';

/**
 * Upgrade Modal — driven solely by the backend `access` object.
 * Does not evaluate plan features itself for lock state.
 */
export default function UpgradeModal({
	open,
	onClose,
	templateName = '',
	templateId = '',
	access = null,
	sourcePage = 'upgrade_modal',
	requiredFeatureKeys = undefined,
}) {
	const backdropPointerDownRef = useRef(false);
	const [loadingPlan, setLoadingPlan] = useState(false);
	const [currentPlanName, setCurrentPlanName] = useState('');
	const [currentPlanSlug, setCurrentPlanSlug] = useState('');
	const [suggestedPlan, setSuggestedPlan] = useState(null);
	const trackedOpenRef = useRef('');

	const normalized = useMemo(() => getTemplateAccess(access), [access]);
	const missingLabels = useMemo(
		() => formatMissingFeatureLabels(normalized?.missingKeys || []),
		[normalized],
	);

	useEffect(() => {
		if (!open) return undefined;
		const onKey = (event) => {
			if (event.key === 'Escape') onClose?.();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, onClose]);

	useEffect(() => {
		if (!open) {
			trackedOpenRef.current = '';
			return;
		}
		const openKey = `${templateId || ''}:${templateName || ''}:${(normalized?.missingKeys || []).join(',')}`;
		if (trackedOpenRef.current === openKey) return;
		trackedOpenRef.current = openKey;
		trackProductEvent(
			PRODUCT_EVENTS.UPGRADE_MODAL_OPEN,
			buildTemplateEventProps(
				{ id: templateId, name: templateName, access: normalized, requiredFeatureKeys },
				{
					sourcePage,
					requiredFeatureKeys: requiredFeatureKeys || normalized?.missingKeys,
					missingKeys: normalized?.missingKeys,
				},
			),
			{ dedupeKey: `upgrade_modal_open:${openKey}` },
		);
	}, [open, templateId, templateName, normalized, sourcePage, requiredFeatureKeys]);

	useEffect(() => {
		if (!open) return undefined;
		let cancelled = false;

		async function loadSubscriptionContext() {
			setLoadingPlan(true);
			setSuggestedPlan(null);
			try {
				const response = await apiServerClient.fetch('/workspace/v1/subscription', { method: 'GET' });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok || cancelled) return;

				const slug = String(
					payload.subscription?.planSlug
					|| payload.plan?.slug
					|| 'free',
				).trim();
				const name = String(
					payload.subscription?.planName
					|| payload.plan?.name
					|| slug
					|| 'Free',
				).trim();

				setCurrentPlanName(name);
				setCurrentPlanSlug(slug);

				const suggestion = suggestUpgradePlan(
					payload.plans || [],
					normalized?.missingKeys || [],
					{ currentPlanSlug: slug },
				);
				if (!cancelled) setSuggestedPlan(suggestion);
			} catch {
				if (!cancelled) {
					setCurrentPlanName('');
					setCurrentPlanSlug('');
					setSuggestedPlan(null);
				}
			} finally {
				if (!cancelled) setLoadingPlan(false);
			}
		}

		void loadSubscriptionContext();
		return () => { cancelled = true; };
	}, [open, normalized?.missingKeys?.join('|')]);

	if (!open) return null;

	const displayName = String(templateName || 'This template').trim() || 'This template';

	const handleBackdropPointerDown = (event) => {
		backdropPointerDownRef.current = event.target === event.currentTarget;
	};

	const handleBackdropClick = (event) => {
		const pressedOnBackdrop = backdropPointerDownRef.current;
		backdropPointerDownRef.current = false;
		if (event.target !== event.currentTarget) return;
		if (!pressedOnBackdrop) return;
		onClose?.();
	};

	const handleUpgradeClick = () => {
		trackProductEvent(
			PRODUCT_EVENTS.UPGRADE_BUTTON_CLICK,
			buildTemplateEventProps(
				{ id: templateId, name: templateName, access: normalized, requiredFeatureKeys },
				{
					sourcePage,
					currentPlan: currentPlanSlug || undefined,
					requiredFeatureKeys: requiredFeatureKeys || normalized?.missingKeys,
					missingKeys: normalized?.missingKeys,
				},
			),
			{ dedupe: false },
		);
		onClose?.();
	};

	return (
		<div
			className="upgrade-modal-root fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="upgrade-modal-title"
			onPointerDown={handleBackdropPointerDown}
			onClick={handleBackdropClick}
		>
			<div
				className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-xl"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-start gap-3">
						<span
							className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
							aria-hidden="true"
						>
							<Sparkles size={18} />
						</span>
						<div>
							<h2 id="upgrade-modal-title" className="font-display text-xl font-semibold">
								Upgrade to unlock
							</h2>
							<p className="mt-1.5 text-sm text-muted-foreground">
								<span className="font-medium text-foreground">{displayName}</span>
								{' '}requires a plan upgrade before you can use it.
							</p>
						</div>
					</div>
					<button
						type="button"
						className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
						aria-label="Close"
						onClick={onClose}
					>
						<X size={16} />
					</button>
				</div>

				<dl className="mt-5 space-y-3 rounded-xl border border-border/80 bg-secondary/30 p-4 text-sm">
					<div>
						<dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Template</dt>
						<dd className="mt-0.5 font-medium text-foreground">{displayName}</dd>
					</div>
					<div>
						<dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Missing feature(s)</dt>
						<dd className="mt-0.5 text-foreground">
							{missingLabels.length
								? missingLabels.join(', ')
								: 'A higher plan is required for this template.'}
						</dd>
					</div>
					<div>
						<dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current plan</dt>
						<dd className="mt-0.5 text-foreground">
							{loadingPlan && !currentPlanName
								? 'Loading…'
								: (currentPlanName || 'Unknown')}
						</dd>
					</div>
					<div>
						<dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested upgrade</dt>
						<dd className="mt-0.5 text-foreground">
							{loadingPlan && !suggestedPlan
								? 'Looking for a plan…'
								: suggestedPlan
									? (
										<>
											{suggestedPlan.name}
											{suggestedPlan.monthlyPrice > 0
												? ` · $${suggestedPlan.monthlyPrice}/mo`
												: ''}
										</>
									)
									: 'See available plans on the subscription page.'}
						</dd>
					</div>
				</dl>

				<div className="mt-6 flex flex-wrap justify-end gap-2">
					<Button variant="outline" onClick={onClose}>Not now</Button>
					<Link
						to={suggestedPlan?.slug
							? `/app/subscription#bill-upgrade-plans`
							: '/app/subscription'}
						onClick={handleUpgradeClick}
					>
						<Button>
							{suggestedPlan ? `Upgrade to ${suggestedPlan.name}` : 'View plans'}
						</Button>
					</Link>
				</div>
			</div>
		</div>
	);
}
