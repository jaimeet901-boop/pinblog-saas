import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Check, Crown, Download, RefreshCw, Sparkles, Gauge,
	FileText, Image as ImageIcon, Pin, Globe, HardDrive, AlertTriangle,
	Settings, Coins, X, LifeBuoy,
} from 'lucide-react';
import {
	ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
	XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import apiServerClient from '@/lib/apiServerClient';
import { isPlanFeatureEnabled } from '@/lib/planFeatures';
import { PRODUCT_EVENTS, trackProductEvent } from '@/lib/productAnalytics';
import {
	SUBSCRIPTION_CANCEL_BODY,
	SUBSCRIPTION_CANCEL_PATH,
	accessContinuesUntilMessage,
	canShowSubscriptionCancel,
	describeCancelSuccess,
	isCancelScheduled,
	isSubscriptionCanceled,
	mapSubscriptionCancelError,
} from '@/lib/subscriptionCancel';
import {
	CREDIT_PACK_PURCHASE_PATH,
	CREDIT_PACKS_PATH,
	PAYPAL_CREDIT_PACK_UNAVAILABLE_MESSAGE,
	buildCreditPackPurchaseBody,
	canBuyCreditPack,
	creditPackPurchaseHiddenReason,
	describeCreditPackPurchaseFailure,
	listCreditPackItems,
	resolveCreditPackCheckoutUrl,
} from '@/lib/creditPackPurchase';
import { Badge, Button, Spinner } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import { mailtoHref } from '@/lib/platformIdentity';
import './SubscriptionPage.css';

const PLACEHOLDER_PLANS = [
	{
		id: 'business',
		name: 'Business',
		price: 199,
		credits: 'Custom',
		items: ['Higher volume credits', 'Multi-brand workspaces', 'Advanced analytics', 'Priority onboarding'],
		placeholder: true,
	},
	{
		id: 'enterprise',
		name: 'Enterprise',
		price: null,
		credits: 'Custom',
		items: ['Custom SLAs', 'SSO & security controls', 'Dedicated success manager', 'Custom integrations'],
		placeholder: true,
	},
];

function BillingUnavailableModal({ open, onClose, supportMailto }) {
	const backdropPointerDownRef = useRef(false);

	useEffect(() => {
		if (!open) return undefined;
		const onKey = (event) => {
			if (event.key === 'Escape') onClose?.();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, onClose]);

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

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="billing-unavailable-title"
			onPointerDown={handleBackdropPointerDown}
			onClick={handleBackdropClick}
		>
			<div
				className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-xl"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="flex items-start justify-between gap-3">
					<div>
						<h2 id="billing-unavailable-title" className="font-display text-xl font-semibold">
							Billing is not available
						</h2>
						<p className="mt-2 text-sm text-muted-foreground">
							The administrator has not configured a payment provider yet. Please try again later.
						</p>
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
				<div className="mt-6 flex flex-wrap justify-end gap-2">
					<Button variant="outline" onClick={onClose}>Close</Button>
					<a href={supportMailto}>
						<Button>
							<LifeBuoy size={15} />
							Contact Support
						</Button>
					</a>
				</div>
			</div>
		</div>
	);
}

const CHART_COLORS = ['hsl(12 80% 55%)', 'hsl(38 90% 55%)', 'hsl(142 45% 40%)', 'hsl(210 55% 45%)'];

const BILLING_INTERVALS = Object.freeze(['monthly', 'yearly']);

const CURRENT_FEATURES = [
	{ label: 'AI Writer', key: 'writer' },
	{ label: 'AI Images', key: 'images' },
	{ label: 'AI Pins', key: 'pins' },
	{ label: 'Templates', key: 'templates' },
	{ label: 'Brand Kit', key: 'brand' },
	{ label: 'Analytics', key: 'analytics' },
	{ label: 'Pinterest Accounts', key: 'pinterest' },
	{ label: 'Websites', key: 'websites' },
	{ label: 'Storage', key: 'storage' },
	{ label: 'Monthly Credits', key: 'credits' },
];

function planItemsFromDto(plan) {
	const limits = plan.limits || {};
	return [
		`${limits.articlesPerMonth >= 999999 ? 'Unlimited' : (limits.articlesPerMonth || plan.credits || 0)} articles / month`,
		`${limits.wordpressSites >= 999999 ? 'Unlimited' : (limits.wordpressSites || 1)} website${(limits.wordpressSites || 1) === 1 ? '' : 's'}`,
		`${limits.imagesPerMonth >= 999999 ? 'Unlimited' : (limits.imagesPerMonth || 0)} images`,
		plan.support || 'Support included',
	];
}

function mapPlanCard(plan) {
	const monthlyPrice = Number(plan.monthlyPrice ?? plan.price) || 0;
	const yearlyPrice = Number(plan.yearlyPrice) || 0;
	return {
		id: plan.slug || plan.id,
		planId: plan.id,
		name: plan.name,
		monthlyPrice,
		yearlyPrice,
		price: monthlyPrice,
		credits: plan.credits,
		popular: Boolean(plan.highlight),
		items: planItemsFromDto(plan),
		placeholder: false,
	};
}

function planPriceDisplay(plan, billingInterval) {
	if (plan.placeholder) {
		return { amountLabel: 'Custom', periodLabel: '' };
	}
	const monthlyPrice = plan.monthlyPrice ?? plan.price;
	const yearlyPrice = plan.yearlyPrice;
	if (monthlyPrice == null && yearlyPrice == null) {
		return { amountLabel: 'Custom', periodLabel: '' };
	}
	const amount = billingInterval === 'yearly'
		? (Number(yearlyPrice) || Number(monthlyPrice) || 0)
		: (Number(monthlyPrice) || 0);
	return {
		amountLabel: `$${amount}`,
		periodLabel: billingInterval === 'yearly' ? '/yr' : '/mo',
	};
}

export default function SubscriptionPage() {
	const { user, refresh } = useAuth();
	const { toast } = useToast();
	const { supportEmail, platformName } = usePlatformIdentity();
	const supportMailto = mailtoHref(supportEmail);
	const [busy, setBusy] = useState(null);
	const [loadingUsage, setLoadingUsage] = useState(true);
	const [plans, setPlans] = useState([]);
	const [subscription, setSubscription] = useState(null);
	const [planDto, setPlanDto] = useState(null);
	const [billing, setBilling] = useState(null);
	const [billingInterval, setBillingInterval] = useState('monthly');
	const [billingUnavailableOpen, setBillingUnavailableOpen] = useState(false);
	const [credits, setCredits] = useState({ balance: 0, quota: 0, used: 0, remaining: 0 });
	const [creditPacks, setCreditPacks] = useState({ items: [] });
	const [usage, setUsage] = useState({
		articles: 0,
		images: 0,
		pins: 0,
		websites: 0,
		pinterestAccounts: 0,
		monthArticles: 0,
	});

	const openBillingUnavailable = () => setBillingUnavailableOpen(true);

	const choose = async (planSlug) => {
		if (planSlug === (subscription?.planSlug || user?.plan)) return;
		setBusy(planSlug);
		try {
			const origin = typeof window !== 'undefined' ? window.location.origin : '';
			const response = await apiServerClient.fetch('/workspace/v1/subscription/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					planSlug,
					billingInterval,
					successUrl: origin ? `${origin}/app/subscription?checkout=success` : '',
					cancelUrl: origin ? `${origin}/app/subscription?checkout=cancel` : '',
				}),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				if (response.status === 422 && payload.errorCode === 'INVALID_BILLING_INTERVAL') {
					toast({
						variant: 'destructive',
						title: 'Billing interval unavailable',
						description: payload.message || 'Yearly billing is not available for the current payment provider.',
					});
					return;
				}
				if (
					response.status === 404
					|| payload.errorCode === 'PLAN_NOT_FOUND'
					|| payload.errorCode === 'CHECKOUT_REQUIRED'
				) {
					openBillingUnavailable();
					return;
				}
				throw new Error(payload.message || 'Could not start billing');
			}

			if (payload.status === 'billing_unavailable') {
				openBillingUnavailable();
				return;
			}

			if (payload.status === 'activated') {
				await applySubscriptionPayload(payload);
				await refresh();
				toast({
					title: 'Plan updated',
					description: `You are now on the ${payload.plan?.name || planSlug} plan.`,
				});
				return;
			}

			if (payload.status === 'checkout_pending') {
				const checkoutUrl = payload.checkoutUrl || payload.checkout?.checkoutUrl;
				if (checkoutUrl) {
					window.location.assign(checkoutUrl);
					return;
				}
				toast({
					title: 'Checkout unavailable',
					description: payload.message
						|| `${payload.provider || 'Payment'} checkout could not be started. Please try again later.`,
				});
				return;
			}

			if (payload.status === 'checkout_unavailable') {
				toast({
					title: 'Checkout unavailable',
					description: payload.message
						|| `${payload.provider || 'Payment'} checkout could not be started. Please try again later.`,
				});
				return;
			}

			openBillingUnavailable();
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		} finally {
			setBusy(null);
		}
	};

	const applySubscriptionPayload = (payload) => {
		setSubscription(payload.subscription || null);
		setPlanDto(payload.plan || null);
		setBilling(payload.billing || null);
		setPlans((payload.plans || []).map(mapPlanCard));
		setCredits(payload.credits || { balance: 0, quota: 0, used: 0, remaining: 0 });
		setCreditPacks(payload.creditPacks || { items: [] });
		const totals = payload.usage?.totals || {};
		setUsage({
			articles: totals.articles || 0,
			images: totals.images || 0,
			pins: totals.pins || 0,
			websites: totals.websites || 0,
			pinterestAccounts: totals.pinterestAccounts || 0,
			monthArticles: totals.monthArticles || 0,
		});
	};

	const loadUsage = async () => {
		setLoadingUsage(true);
		try {
			const response = await apiServerClient.fetch('/workspace/v1/subscription', { method: 'GET' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload.message || 'Failed to load subscription');
			}
			applySubscriptionPayload(payload);
			const packsResponse = await apiServerClient.fetch(CREDIT_PACKS_PATH, { method: 'GET' });
			if (packsResponse.ok) {
				const packsPayload = await packsResponse.json().catch(() => null);
				if (packsPayload && typeof packsPayload === 'object') {
					setCreditPacks(packsPayload);
				}
			}
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message || 'Failed to load subscription' });
			setUsage({
				articles: 0,
				images: 0,
				pins: 0,
				websites: 0,
				pinterestAccounts: 0,
				monthArticles: 0,
			});
		} finally {
			setLoadingUsage(false);
		}
	};

	useEffect(() => {
		trackProductEvent(
			PRODUCT_EVENTS.SUBSCRIPTION_PAGE_OPEN,
			{ sourcePage: 'subscription' },
			{ dedupeKey: 'subscription_page_open:subscription' },
		);
		loadUsage();
	}, []);

	const activeProvider = billing?.provider && billing.provider !== 'none' ? billing.provider : null;
	const yearlyBillingAvailable = activeProvider === 'paddle';

	useEffect(() => {
		if (activeProvider && activeProvider !== 'paddle' && billingInterval === 'yearly') {
			setBillingInterval('monthly');
		}
	}, [activeProvider, billingInterval]);

	const currentPlanId = subscription?.planSlug || planDto?.slug || user?.plan || 'free';
	const currentPlan = plans.find((plan) => plan.id === currentPlanId)
		|| (planDto ? mapPlanCard(planDto) : { id: currentPlanId, name: currentPlanId, price: 0, credits: credits.quota || 0, items: [] });
	const quota = Number(credits.quota) || Number(currentPlan.credits) || 0;
	const creditsUsed = Number(credits.used) || usage.monthArticles;
	const creditsRemaining = Number(credits.remaining ?? credits.balance) || Math.max(0, quota - creditsUsed);
	const usagePct = Math.min(100, Math.round((creditsUsed / Math.max(1, quota)) * 100));

	const renewalDate = useMemo(() => {
		if (subscription?.currentPeriodEnd) {
			return new Date(subscription.currentPeriodEnd);
		}
		const base = user?.updated || user?.created || new Date().toISOString();
		const date = new Date(base);
		date.setMonth(date.getMonth() + 1);
		return date;
	}, [subscription, user]);

	const creditsUsageChart = useMemo(() => {
		const points = [];
		for (let i = 6; i >= 0; i -= 1) {
			const day = new Date();
			day.setDate(day.getDate() - i);
			points.push({
				label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
				used: i === 0 ? creditsUsed : Math.max(0, Math.round(creditsUsed * ((7 - i) / 7))),
			});
		}
		return points;
	}, [creditsUsed]);

	const monthlyConsumption = useMemo(() => ([
		{ label: 'Writer', value: usage.articles || Math.max(1, creditsUsed) },
		{ label: 'Images', value: usage.images || 0 },
		{ label: 'Pins', value: usage.pins || 0 },
		{ label: 'Other', value: Math.max(0, Math.round((usage.pins || 0) * 0.15)) },
	]), [usage, creditsUsed]);

	const serviceBreakdown = useMemo(() => ([
		{ name: 'AI Writer', value: Math.max(usage.monthArticles, usage.articles ? 1 : 0) },
		{ name: 'AI Images', value: usage.images },
		{ name: 'AI Pins', value: usage.pins },
		{ name: 'Other AI', value: Math.max(0, Math.round((usage.pins + usage.images) * 0.1)) },
	]), [usage]);

	const chartsArePlaceholder = !usage.articles && !usage.pins && !usage.images && !creditsUsed;

	const featureValues = useMemo(() => {
		const features = planDto?.features || {};
		const limits = planDto?.limits || {};
		return {
			writer: isPlanFeatureEnabled(features, 'aiWriter') ? 'Included' : 'Unavailable',
			images: isPlanFeatureEnabled(features, 'aiImages') ? 'Included' : (currentPlanId === 'free' ? 'Limited' : 'Included'),
			pins: isPlanFeatureEnabled(features, 'pinterest') ? 'Full' : (currentPlanId === 'free' || currentPlanId === 'starter' ? 'Basic' : 'Full'),
			templates: isPlanFeatureEnabled(features, 'templates') ? 'Included' : 'Included',
			brand: isPlanFeatureEnabled(features, 'brandKit') ? 'Included' : (currentPlanId === 'free' ? 'Basic' : 'Included'),
			analytics: isPlanFeatureEnabled(features, 'analytics') ? 'Included' : (currentPlanId === 'free' ? 'Basic' : 'Included'),
			pinterest: usage.pinterestAccounts ? `${usage.pinterestAccounts} linked` : (isPlanFeatureEnabled(features, 'calendar') ? 'Scheduler ready' : 'Connect in Hub'),
			websites: `${usage.websites} connected`,
			storage: limits.storageGb ? `${limits.storageGb} GB` : 'Workspace ready',
			credits: `${quota}/mo`,
		};
	}, [currentPlanId, usage, quota, planDto]);

	const recommendations = useMemo(() => {
		const tips = [];
		if (usagePct >= 80) {
			tips.push({ title: 'Credit usage alert', body: `You’ve used ${usagePct}% of this month’s article credits. Consider upgrading before you hit the limit.` });
		} else {
			tips.push({ title: 'Healthy credit balance', body: `${creditsRemaining} article credits remain on the ${currentPlan.name} plan.` });
		}
		if (currentPlanId === 'free') {
			tips.push({ title: 'Upgrade suggestion', body: 'Starter unlocks more monthly articles and websites for growing food blogs.' });
		} else if (currentPlanId === 'starter') {
			tips.push({ title: 'Upgrade suggestion', body: 'Pro adds Pinterest scheduling and higher volume for multi-site publishing.' });
		} else if (currentPlanId === 'pro') {
			tips.push({ title: 'Scale option', body: 'Agency is built for teams that need unlimited volume and dedicated support.' });
		} else {
			tips.push({ title: 'You’re on Agency', body: 'You already have the highest self-serve plan. Enterprise options are placeholders until billing is connected.' });
		}
		tips.push({ title: 'Renewal reminder', body: `Next estimated renewal window: ${renewalDate.toLocaleDateString()}. Stripe billing is not live yet.` });
		if (!usage.pinterestAccounts) {
			tips.push({ title: 'Connect Pinterest', body: 'Link an account in Pinterest Hub to unlock scheduling value on higher plans.' });
		}
		return tips;
	}, [usagePct, creditsRemaining, currentPlan, currentPlanId, renewalDate, usage.pinterestAccounts]);

	const billingHistory = [];
	const allPlanCards = useMemo(() => {
		const seen = new Set(plans.map((plan) => plan.id));
		const extras = PLACEHOLDER_PLANS.filter((plan) => !seen.has(plan.id));
		return [...plans, ...extras];
	}, [plans]);

	const notifyBillingPlaceholder = (action) => {
		toast({
			title: `${action} unavailable`,
			description: billing?.provider && billing.provider !== 'none'
				? `${billing.provider} billing portal is not connected yet.`
				: 'Billing portal is unavailable until a payment provider is configured in Admin settings.',
		});
	};

	const providerLabel = billing?.provider && billing.provider !== 'none'
		? billing.provider.charAt(0).toUpperCase() + billing.provider.slice(1)
		: null;

	const scrollToPlans = () => {
		document.getElementById('bill-upgrade-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	};

	const cancelScheduled = isCancelScheduled(subscription);
	const showPaddleCancel = canShowSubscriptionCancel(subscription);
	const accessUntilCopy = accessContinuesUntilMessage(subscription?.currentPeriodEnd);
	const packItems = listCreditPackItems(creditPacks);
	const showPackBuy = canBuyCreditPack(billing);
	const packBuyReason = creditPackPurchaseHiddenReason(billing);

	const buyCreditPack = async (packId) => {
		if (!canBuyCreditPack(billing)) return;
		const origin = typeof window !== 'undefined' ? window.location.origin : '';
		const body = buildCreditPackPurchaseBody(packId, origin);
		if (!body.packId) return;

		setBusy(`pack:${body.packId}`);
		try {
			const response = await apiServerClient.fetch(CREDIT_PACK_PURCHASE_PATH, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				toast({
					variant: 'destructive',
					title: 'Purchase unavailable',
					description: payload.message || 'Could not start credit pack checkout.',
				});
				return;
			}

			const checkout = resolveCreditPackCheckoutUrl(payload);
			if (checkout.ok) {
				window.location.assign(checkout.checkoutUrl);
				return;
			}

			if (payload.status === 'fulfilled') {
				await loadUsage();
				toast({
					title: 'Credits added',
					description: 'Your credit balance has been updated.',
				});
				return;
			}

			toast({
				title: 'Checkout unavailable',
				description: describeCreditPackPurchaseFailure(payload),
			});
		} catch (err) {
			toast({
				variant: 'destructive',
				title: 'Error',
				description: err?.message || 'Could not start credit pack checkout.',
			});
		} finally {
			setBusy(null);
		}
	};

	const cancelWorkspacePlan = async () => {
		const confirmed = window.confirm(
			`Cancel this subscription at the end of the billing period? ${accessUntilCopy}`,
		);
		if (!confirmed) return;

		setBusy('cancel');
		try {
			const response = await apiServerClient.fetch(SUBSCRIPTION_CANCEL_PATH, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(SUBSCRIPTION_CANCEL_BODY),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				const mapped = mapSubscriptionCancelError(response.status, payload);
				toast({ variant: 'destructive', title: mapped.title, description: mapped.description });
				return;
			}
			await loadUsage();
			const success = describeCancelSuccess(payload, subscription?.currentPeriodEnd);
			toast({ title: success.title, description: success.description });
		} catch (err) {
			toast({
				variant: 'destructive',
				title: 'Cancellation failed',
				description: err?.message || 'Could not cancel this subscription. Please try again.',
			});
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="bill-atelier">
			<section className="bill-hero">
				<p className="bill-hero__eyebrow">{platformName} Billing & Credits</p>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<h1 className="bill-hero__title">{currentPlan.name} plan</h1>
						<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
							Manage credits, review usage, and upgrade your workspace when you&apos;re ready to scale.
						</p>
						{cancelScheduled ? (
							<p className="mt-2 max-w-2xl text-sm font-medium text-foreground">
								Cancellation scheduled. {accessUntilCopy}
							</p>
						) : null}
						{!cancelScheduled && isSubscriptionCanceled(subscription) ? (
							<p className="mt-2 max-w-2xl text-sm font-medium text-foreground">
								This subscription is cancelled.
							</p>
						) : null}
					</div>
					<div className="flex flex-wrap gap-2">
						<Button onClick={scrollToPlans}><Crown size={15} /> Upgrade Plan</Button>
						<Button variant="outline" onClick={() => notifyBillingPlaceholder('Manage Billing')}>
							<Settings size={15} /> Manage Billing
						</Button>
						{showPaddleCancel ? (
							<Button
								variant="outline"
								onClick={cancelWorkspacePlan}
								disabled={Boolean(busy)}
							>
								{busy === 'cancel' ? <Spinner className="h-4 w-4" /> : null}
								Cancel subscription
							</Button>
						) : null}
					</div>
				</div>
				<div className="bill-hero__grid">
					<div className="bill-hero__metric"><span>Current plan</span><strong>{currentPlan.name}</strong></div>
					<div className="bill-hero__metric"><span>Workspace</span><strong>{user?.name || platformName}</strong></div>
					<div className="bill-hero__metric"><span>Renewal date</span><strong>{renewalDate.toLocaleDateString()}</strong></div>
					<div className="bill-hero__metric"><span>Monthly price</span><strong>${currentPlan.price}/mo</strong></div>
					<div className="bill-hero__metric"><span>Credits remaining</span><strong>{creditsRemaining}</strong></div>
					<div className="bill-hero__metric">
						<span>Usage this month</span>
						<strong>{creditsUsed}/{quota}</strong>
						<div className="bill-meter mt-2"><span style={{ width: `${usagePct}%` }} /></div>
					</div>
				</div>
				<p className="mt-3 text-xs text-muted-foreground inline-flex items-center gap-1.5">
					<Crown size={12} className="text-primary" />
					{providerLabel
						? `Secure billing via ${providerLabel}${billing?.checkoutEnabled ? '' : ' · checkout disabled'}`
						: 'Payment provider not configured · paid upgrades require Admin billing setup'}
				</p>
			</section>

			<div className="mb-3 flex items-center justify-between gap-2">
				<p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Usage overview</p>
				<Button size="sm" variant="ghost" onClick={loadUsage} disabled={loadingUsage}>
					{loadingUsage ? <Spinner className="h-4 w-4" /> : <RefreshCw size={14} />}
					Refresh
				</Button>
			</div>

			<div className="bill-stats">
				{[
					{ label: 'Credits Used', value: creditsUsed, hint: 'Articles this month' },
					{ label: 'Credits Remaining', value: creditsRemaining, hint: null },
					{ label: 'Monthly Limit', value: quota, hint: null },
					{ label: 'Articles Generated', value: usage.articles, hint: 'All time' },
					{ label: 'Images Generated', value: usage.images, hint: 'From pin library' },
					{ label: 'Pins Generated', value: usage.pins, hint: null },
					{ label: 'Storage Used', value: planDto?.limits?.storageGb ? `0/${planDto.limits.storageGb} GB` : '—', hint: 'Workspace allocation' },
					{ label: 'Connected Websites', value: usage.websites, hint: null },
					{ label: 'Pinterest Accounts', value: usage.pinterestAccounts || '—', hint: usage.pinterestAccounts ? null : 'None linked' },
				].map((card) => (
					<div key={card.label} className="bill-stat">
						<p className="bill-stat__label">{card.label}</p>
						{loadingUsage ? (
							<div className="mt-3 h-7 w-12 animate-pulse rounded-md bg-secondary" />
						) : (
							<p className="bill-stat__value">{card.value}</p>
						)}
						{card.hint ? <p className="bill-stat__hint">{card.hint}</p> : null}
					</div>
				))}
			</div>

			<div className="bill-shell">
				<div className="bill-main">
					<section className="bill-panel">
						<div className="bill-panel__head">
							<div className="bill-panel__title">
								<span className="bill-panel__icon"><Gauge size={14} /></span>
								Usage Analytics
							</div>
							{chartsArePlaceholder ? <Badge tone="amber">Sample charts</Badge> : <Badge tone="green">Live usage</Badge>}
						</div>
						{loadingUsage ? (
							<div className="bill-charts">
								{[0, 1, 2].map((i) => <div key={i} className="bill-skeleton" />)}
							</div>
						) : (
							<div className="bill-charts">
								<div className="bill-chart">
									<h4>Credits Usage</h4>
									{chartsArePlaceholder ? <p className="bill-chart__hint">Placeholder trend until articles are generated.</p> : null}
									<div style={{ width: '100%', height: 210 }}>
										<ResponsiveContainer>
											<AreaChart data={creditsUsageChart}>
												<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
												<XAxis dataKey="label" tick={{ fontSize: 11 }} />
												<YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
												<Tooltip />
												<Area type="monotone" dataKey="used" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.2} />
											</AreaChart>
										</ResponsiveContainer>
									</div>
								</div>
								<div className="bill-chart">
									<h4>Monthly Consumption</h4>
									<div style={{ width: '100%', height: 210 }}>
										<ResponsiveContainer>
											<BarChart data={monthlyConsumption}>
												<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
												<XAxis dataKey="label" tick={{ fontSize: 11 }} />
												<YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
												<Tooltip />
												<Bar dataKey="value" fill={CHART_COLORS[1]} radius={[6, 6, 0, 0]} />
											</BarChart>
										</ResponsiveContainer>
									</div>
								</div>
								<div className="bill-chart" style={{ gridColumn: '1 / -1' }}>
									<h4>Service Usage Breakdown</h4>
									<div style={{ width: '100%', height: 230 }}>
										<ResponsiveContainer>
											<PieChart>
												<Pie data={serviceBreakdown} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={3}>
													{serviceBreakdown.map((entry, index) => (
														<Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
													))}
												</Pie>
												<Tooltip />
												<Legend />
											</PieChart>
										</ResponsiveContainer>
									</div>
								</div>
							</div>
						)}
					</section>

					<section className="bill-panel">
						<div className="bill-panel__head">
							<div className="bill-panel__title">
								<span className="bill-panel__icon"><Crown size={14} /></span>
								Current Plan
							</div>
							<Badge tone="blue">{currentPlan.name}</Badge>
						</div>
						<p className="text-sm text-muted-foreground">
							${currentPlan.price}/mo · {quota} monthly article credits · includes the {platformName} atelier suite.
						</p>
						<div className="bill-features mt-4">
							{CURRENT_FEATURES.map((feature) => (
								<div key={feature.key} className="bill-feature">
									<span>{feature.label}</span>
									<strong className="text-xs font-semibold text-muted-foreground">{featureValues[feature.key]}</strong>
								</div>
							))}
						</div>
					</section>

					<section className="bill-panel" id="bill-upgrade-plans">
						<div className="bill-panel__head">
							<div className="bill-panel__title">
								<span className="bill-panel__icon"><Sparkles size={14} /></span>
								Upgrade Plans
							</div>
						</div>
						<div
							className="bill-interval"
							role="group"
							aria-label="Billing interval"
						>
							{BILLING_INTERVALS.map((interval) => {
								const selected = billingInterval === interval;
								const disabled = interval === 'yearly' && !yearlyBillingAvailable;
								const label = interval === 'yearly' ? 'Yearly' : 'Monthly';
								return (
									<button
										key={interval}
										type="button"
										className={`bill-interval__option${selected ? ' is-active' : ''}`}
										aria-pressed={selected}
										disabled={disabled}
										title={disabled ? 'Yearly billing is available with Paddle checkout only' : undefined}
										onClick={() => setBillingInterval(interval)}
									>
										{label}
									</button>
								);
							})}
						</div>
						{activeProvider && activeProvider !== 'paddle' ? (
							<p className="bill-interval__note">
								Yearly checkout is available when Paddle is the active billing provider.
							</p>
						) : null}
						<div className="bill-plans">
							{allPlanCards.map((plan) => {
								const current = !plan.placeholder && plan.id === currentPlanId;
								const { amountLabel, periodLabel } = planPriceDisplay(plan, billingInterval);
								return (
									<div key={plan.id} className={`bill-plan ${plan.popular ? 'is-popular' : ''} ${current ? 'is-current' : ''}`}>
										<div className="flex items-center justify-between gap-2">
											<h3 className="font-display text-xl font-semibold">{plan.name}</h3>
											{plan.popular ? <Badge>Most Popular</Badge> : null}
											{plan.placeholder ? <Badge tone="amber">Placeholder</Badge> : null}
											{current ? <Badge tone="blue">Current</Badge> : null}
										</div>
										<p className="bill-plan__price">
											{amountLabel}
											{periodLabel ? <span>{periodLabel}</span> : null}
										</p>
										<p className="text-xs text-muted-foreground">Credits: {plan.credits}</p>
										<ul>
											{plan.items.map((item) => (
												<li key={item}><Check size={15} className="mt-0.5 shrink-0 text-primary" />{item}</li>
											))}
										</ul>
										<Button
											variant={current ? 'outline' : plan.popular ? 'primary' : 'outline'}
											disabled={current || busy === plan.id}
											onClick={() => choose(plan.id)}
										>
											{current ? 'Current plan' : busy === plan.id ? 'Processing…' : `Upgrade to ${plan.name}`}
										</Button>
									</div>
								);
							})}
						</div>
					</section>

					<section className="bill-panel" id="bill-credit-packs">
						<div className="bill-panel__head">
							<div className="bill-panel__title">
								<span className="bill-panel__icon"><Coins size={14} /></span>
								Credit packs
							</div>
						</div>
						{packItems.length === 0 ? (
							<div className="bill-empty">
								<p className="font-semibold">No credit packs available</p>
								<p className="mt-1 text-sm text-muted-foreground">
									Credit packs will appear here when they are configured for this workspace.
								</p>
							</div>
						) : (
							<>
								{packBuyReason === 'paypal_stub' ? (
									<p className="mb-3 text-sm text-muted-foreground">
										{PAYPAL_CREDIT_PACK_UNAVAILABLE_MESSAGE}
									</p>
								) : null}
								{packBuyReason === 'checkout_disabled' ? (
									<p className="mb-3 text-sm text-muted-foreground">
										Checkout is disabled. Credit packs cannot be purchased until checkout is enabled.
									</p>
								) : null}
								<div className="bill-plans">
									{packItems.map((pack) => (
										<div key={pack.id} className="bill-plan">
											<h3 className="font-display text-xl font-semibold">{pack.name}</h3>
											<p className="bill-plan__price">${pack.price}</p>
											<p className="text-xs text-muted-foreground">{pack.credits} credits</p>
											{showPackBuy ? (
												<Button
													disabled={Boolean(busy)}
													onClick={() => buyCreditPack(pack.id)}
												>
													{busy === `pack:${pack.id}` ? 'Processing…' : 'Buy'}
												</Button>
											) : null}
										</div>
									))}
								</div>
							</>
						)}
					</section>

					<section className="bill-panel">
						<div className="bill-panel__head">
							<div className="bill-panel__title">
								<span className="bill-panel__icon"><Coins size={14} /></span>
								Usage Breakdown
							</div>
						</div>
						<div className="bill-features">
							{[
								{ label: 'AI Writer', icon: FileText, value: `${usage.monthArticles} credits this month` },
								{ label: 'AI Images', icon: ImageIcon, value: `${usage.images} library images` },
								{ label: 'AI Pins', icon: Pin, value: `${usage.pins} pins generated` },
								{ label: 'Other AI Services', icon: Sparkles, value: 'Included in atelier workflow' },
							].map((row) => {
								const Icon = row.icon;
								return (
									<div key={row.label} className="bill-feature">
										<span className="inline-flex items-center gap-2"><Icon size={14} className="text-primary" />{row.label}</span>
										<span className="text-xs text-muted-foreground">{row.value}</span>
									</div>
								);
							})}
						</div>
					</section>

					<section className="bill-panel">
						<div className="bill-panel__head">
							<div className="bill-panel__title">
								<span className="bill-panel__icon"><Download size={14} /></span>
								Billing History
							</div>
						</div>
						{billingHistory.length === 0 ? (
							<div className="bill-empty">
								<p className="font-semibold">No invoices yet</p>
								<p className="mt-1 text-sm text-muted-foreground">
									Billing history will appear here once Stripe invoices are connected.
								</p>
							</div>
						) : (
							<div className="bill-table-wrap">
								<table className="bill-table">
									<thead>
										<tr>
											<th>Invoice</th>
											<th>Date</th>
											<th>Amount</th>
											<th>Status</th>
											<th>Payment Method</th>
											<th>Receipt</th>
											<th>Download</th>
										</tr>
									</thead>
									<tbody />
								</table>
							</div>
						)}
						<div className="mt-3 flex flex-wrap gap-2">
							<Button size="sm" variant="outline" disabled onClick={() => notifyBillingPlaceholder('Download Invoice')}>
								<Download size={14} /> Download Invoice
							</Button>
						</div>
					</section>
				</div>

				<aside className="bill-side">
					<section className="bill-panel">
						<div className="bill-panel__head">
							<div className="bill-panel__title">
								<span className="bill-panel__icon"><AlertTriangle size={14} /></span>
								Recommendations
							</div>
						</div>
						<div className="space-y-2">
							{recommendations.map((tip) => (
								<div key={tip.title} className="bill-reco">
									<strong>{tip.title}</strong>
									{tip.body}
								</div>
							))}
						</div>
						<div className="mt-3 grid gap-2">
							<Button size="sm" onClick={scrollToPlans}>Review upgrades</Button>
							<Link to="/app/pinterest"><Button size="sm" variant="outline" className="w-full"><Pin size={14} /> Pinterest Hub</Button></Link>
							<Link to="/app/websites"><Button size="sm" variant="ghost" className="w-full"><Globe size={14} /> Websites</Button></Link>
						</div>
					</section>

					<section className="bill-panel">
						<div className="bill-panel__head">
							<div className="bill-panel__title">
								<span className="bill-panel__icon"><HardDrive size={14} /></span>
								Workspace snapshot
							</div>
						</div>
						<div className="bill-features">
							<div className="bill-feature"><span>Websites</span><strong>{usage.websites}</strong></div>
							<div className="bill-feature"><span>Articles</span><strong>{usage.articles}</strong></div>
							<div className="bill-feature"><span>Pins</span><strong>{usage.pins}</strong></div>
							<div className="bill-feature"><span>Storage</span><strong>—</strong></div>
						</div>
					</section>
				</aside>
			</div>

			<BillingUnavailableModal
				open={billingUnavailableOpen}
				onClose={() => setBillingUnavailableOpen(false)}
				supportMailto={supportMailto}
			/>
		</div>
	);
}
