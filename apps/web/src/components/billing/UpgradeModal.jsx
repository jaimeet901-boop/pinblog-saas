import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { Badge, Button } from '@/components/kit';
import apiServerClient from '@/lib/apiServerClient';
import {
	getTemplateAccess,
	resolveLockedFeatureIdentity,
} from '@/lib/templateAccess';
import {
	buildUpgradeModalPlanCards,
	planPriceDisplay,
	startSubscriptionCheckout,
} from '@/lib/subscriptionPlanCards';
import {
	PRODUCT_EVENTS,
	buildTemplateEventProps,
	trackProductEvent,
} from '@/lib/productAnalytics';
import { useToast } from '@/hooks/use-toast';
import './UpgradeModal.css';

/**
 * Upgrade Modal — driven by backend `access` + live subscription catalog.
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
	const { toast } = useToast();
	const [loadingPlan, setLoadingPlan] = useState(false);
	const [currentPlanSlug, setCurrentPlanSlug] = useState('');
	const [paidPlans, setPaidPlans] = useState([]);
	const [busyPlanId, setBusyPlanId] = useState(null);
	const trackedOpenRef = useRef('');

	const normalized = useMemo(() => getTemplateAccess(access), [access]);
	const lockedIdentity = useMemo(
		() => resolveLockedFeatureIdentity(
			{
				access: normalized,
				requiredFeatureKeys,
				templateName,
				sourcePage,
			},
			{ sourcePage, requiredFeatureKeys, templateName },
		),
		[normalized, requiredFeatureKeys, templateName, sourcePage],
	);
	const missingKeys = useMemo(
		() => (Array.isArray(requiredFeatureKeys) && requiredFeatureKeys.length
			? requiredFeatureKeys
			: (lockedIdentity.requiredFeatureKeys.length
				? lockedIdentity.requiredFeatureKeys
				: (normalized?.missingKeys || []))),
		[requiredFeatureKeys, lockedIdentity, normalized],
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
		const openKey = `${templateId || ''}:${lockedIdentity.featureKey}:${lockedIdentity.label}:${(normalized?.missingKeys || []).join(',')}`;
		if (trackedOpenRef.current === openKey) return;
		trackedOpenRef.current = openKey;
		trackProductEvent(
			PRODUCT_EVENTS.UPGRADE_MODAL_OPEN,
			buildTemplateEventProps(
				{
					id: templateId || lockedIdentity.featureKey,
					name: lockedIdentity.label || templateName,
					access: normalized,
					requiredFeatureKeys: missingKeys,
				},
				{
					sourcePage: lockedIdentity.sourcePage || sourcePage,
					requiredFeatureKeys: missingKeys,
					missingKeys: normalized?.missingKeys,
				},
			),
			{ dedupeKey: `upgrade_modal_open:${openKey}` },
		);
	}, [open, templateId, templateName, normalized, sourcePage, requiredFeatureKeys, lockedIdentity, missingKeys]);

	const missingKeysJoin = (normalized?.missingKeys || []).join('|');

	useEffect(() => {
		if (!open) return undefined;
		let cancelled = false;

		async function loadSubscriptionContext() {
			setLoadingPlan(true);
			setPaidPlans([]);
			try {
				const response = await apiServerClient.fetch('/workspace/v1/subscription', { method: 'GET' });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok || cancelled) return;

				const slug = String(
					payload.subscription?.planSlug
					|| payload.plan?.slug
					|| 'free',
				).trim();

				setCurrentPlanSlug(slug);
				setPaidPlans(buildUpgradeModalPlanCards(payload.plans || [], { currentPlanSlug: slug }));
			} catch {
				if (!cancelled) {
					setCurrentPlanSlug('');
					setPaidPlans([]);
				}
			} finally {
				if (!cancelled) setLoadingPlan(false);
			}
		}

		void loadSubscriptionContext();
		return () => { cancelled = true; };
	}, [open, missingKeysJoin]);

	if (!open) return null;

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

	const trackUpgradeClick = (plan) => {
		trackProductEvent(
			PRODUCT_EVENTS.UPGRADE_BUTTON_CLICK,
			buildTemplateEventProps(
				{
					id: templateId || lockedIdentity.featureKey,
					name: lockedIdentity.label || templateName,
					access: normalized,
					requiredFeatureKeys: missingKeys,
				},
				{
					sourcePage: lockedIdentity.sourcePage || sourcePage,
					currentPlan: currentPlanSlug || undefined,
					targetPlan: plan?.id || plan?.slug,
					requiredFeatureKeys: missingKeys,
					missingKeys: normalized?.missingKeys,
				},
			),
			{ dedupe: false },
		);
	};

	const handleUpgradePlan = async (plan) => {
		if (!plan?.id || plan.placeholder || busyPlanId) return;
		trackUpgradeClick(plan);
		setBusyPlanId(plan.id);
		try {
			const result = await startSubscriptionCheckout({
				planSlug: plan.id,
				billingInterval: 'monthly',
				fetchFn: (url, options) => apiServerClient.fetch(url, options),
			});

			if (result.status === 'checkout_pending' && result.checkoutUrl) {
				onClose?.();
				window.location.assign(result.checkoutUrl);
				return;
			}

			if (result.status === 'activated') {
				onClose?.();
				toast({
					title: 'Plan updated',
					description: `You are now on the ${result.payload?.plan?.name || plan.name} plan.`,
				});
				return;
			}

			if (
				result.status === 'billing_unavailable'
				|| result.errorCode === 'PLAN_NOT_FOUND'
				|| result.errorCode === 'CHECKOUT_REQUIRED'
				|| result.httpStatus === 404
			) {
				onClose?.();
				window.location.assign('/app/subscription#bill-upgrade-plans');
				return;
			}

			toast({
				variant: 'destructive',
				title: 'Checkout unavailable',
				description: result.message
					|| 'Could not start checkout. Open Subscription to choose a plan.',
			});
		} catch (error) {
			toast({
				variant: 'destructive',
				title: 'Checkout unavailable',
				description: error?.message || 'Could not start checkout. Please try again.',
			});
		} finally {
			setBusyPlanId(null);
		}
	};

	const handlePlaceholderPlan = (plan) => {
		trackUpgradeClick(plan);
		onClose?.();
		window.location.assign('/app/subscription#bill-upgrade-plans');
	};

	return (
		<div
			className="upgrade-modal-root fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-3 sm:p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="upgrade-modal-title"
			data-locked-feature={lockedIdentity.featureKey || undefined}
			data-locked-feature-label={lockedIdentity.label || undefined}
			onPointerDown={handleBackdropPointerDown}
			onClick={handleBackdropClick}
		>
			<div
				className="upgrade-modal-panel w-full max-w-5xl rounded-2xl border border-border bg-background shadow-xl"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="flex items-start justify-between gap-3 border-b border-border/70 px-5 py-4 sm:px-6">
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
								Choose the plan that fits your needs.
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

				<div className="upgrade-modal-plans-wrap px-5 py-4 sm:px-6">
					{loadingPlan && paidPlans.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">Loading available plans…</p>
					) : paidPlans.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							No upgrade plans are available right now. Open Subscription to review options.
						</p>
					) : (
						<div className="upgrade-modal-plans" role="list">
							{paidPlans.map((plan) => {
								const { amountLabel, periodLabel } = planPriceDisplay(plan, 'monthly');
								const featurePreview = (plan.items || []).slice(0, 3);
								const busy = busyPlanId === plan.id;
								return (
									<div
										key={plan.id}
										role="listitem"
										className={`upgrade-modal-plan${plan.popular ? ' is-popular' : ''}`}
									>
										<div className="flex items-start justify-between gap-2">
											<h3 className="font-display text-lg font-semibold">{plan.name}</h3>
											{plan.popular ? <Badge>Most Popular</Badge> : null}
										</div>
										<p className="upgrade-modal-plan__price">
											{amountLabel}
											{periodLabel ? <span>{periodLabel}</span> : null}
										</p>
										<p className="text-xs text-muted-foreground">
											Credits: {plan.credits == null || plan.credits === '' ? '—' : plan.credits}
										</p>
										<ul className="upgrade-modal-plan__features">
											{featurePreview.map((item) => (
												<li key={item}>
													<Check size={14} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
													<span>{item}</span>
												</li>
											))}
										</ul>
										<Button
											className="mt-auto w-full"
											variant={plan.popular ? 'primary' : 'outline'}
											disabled={Boolean(busyPlanId)}
											onClick={() => (
												plan.placeholder
													? handlePlaceholderPlan(plan)
													: void handleUpgradePlan(plan)
											)}
										>
											{busy ? 'Processing…' : `Upgrade to ${plan.name}`}
										</Button>
									</div>
								);
							})}
						</div>
					)}
				</div>

				<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-5 py-3 sm:px-6">
					<p className="text-xs text-muted-foreground">
						Checkout uses your workspace billing provider (Paddle when configured).
					</p>
					<Button variant="outline" onClick={onClose}>Not now</Button>
				</div>
			</div>
		</div>
	);
}
