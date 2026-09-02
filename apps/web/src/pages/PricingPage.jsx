import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Sparkles } from 'lucide-react';
import PlatformBrandMark from '@/components/PlatformBrandMark';
import PublicSeoHead from '@/components/PublicSeoHead';
import { Badge, Button } from '@/components/kit';
import apiServerClient from '@/lib/apiServerClient';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import { buildPublicFooterLinks, mailtoHref } from '@/lib/platformIdentity';
import {
	buildPublicPricingPlanCards,
	planPriceDisplay,
} from '@/lib/subscriptionPlanCards';
import './auth/AuthShell.css';
import './PrivacyPolicyPage.css';
import './app/SubscriptionPage.css';

const BILLING_INTERVALS = Object.freeze(['monthly', 'yearly']);

export default function PricingPage() {
	const {
		platformName,
		supportEmail,
		contactEmail,
		siteUrl,
		documentationUrl,
		loginLogoUrl,
		platformLogoUrl,
	} = usePlatformIdentity();
	const brandLogoUrl = loginLogoUrl || platformLogoUrl;
	const contactMailto = mailtoHref(contactEmail);

	const [billingInterval, setBillingInterval] = useState('monthly');
	const [planCards, setPlanCards] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	const footerLinks = useMemo(() => buildPublicFooterLinks({
		supportEmail,
		contactEmail,
		documentationUrl,
	}), [supportEmail, contactEmail, documentationUrl]);

	const seoOverrides = useMemo(() => ({
		browserTitle: `Pricing — ${platformName}`,
		metaTitle: `Pricing — ${platformName}`,
		metaDescription: `Compare ${platformName} subscription plans and choose the tier that fits your publishing workflow.`,
		canonicalUrl: `${siteUrl}/pricing`,
	}), [platformName, siteUrl]);

	useEffect(() => {
		window.scrollTo(0, 0);
		let cancelled = false;

		(async () => {
			setLoading(true);
			setError('');
			try {
				const response = await apiServerClient.fetch('/public/plans');
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(payload?.message || 'Unable to load pricing plans.');
				}
				if (!cancelled) {
					setPlanCards(buildPublicPricingPlanCards(payload.items || []));
				}
			} catch (err) {
				if (!cancelled) {
					setPlanCards([]);
					setError(err?.message || 'Unable to load pricing plans.');
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => { cancelled = true; };
	}, []);

	return (
		<div className="welcome-atelier privacy-page text-foreground">
			<PublicSeoHead overrides={seoOverrides} />

			<header className="welcome-nav">
				<div className="mx-auto flex max-w-[76rem] items-center justify-between px-5 py-4">
					<Link to="/" className="auth-brand">
						<PlatformBrandMark
							logoUrl={brandLogoUrl}
							size={18}
							className="auth-brand__mark"
						/>
						<span className="auth-brand__name">{platformName}</span>
					</Link>
					<div className="flex items-center gap-2">
						<Link to="/login" className="rounded-xl px-4 py-2 text-sm font-medium hover:bg-secondary">Log in</Link>
						<Link to="/signup" className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
							Get started
						</Link>
					</div>
				</div>
			</header>

			<main className="privacy-main">
				<div className="privacy-hero">
					<Link to="/" className="privacy-back">
						<ArrowLeft size={14} /> Back to {platformName}
					</Link>
					<p className="auth-hero__eyebrow">Pricing</p>
					<h1 className="privacy-title">Simple plans for every publisher</h1>
					<p className="privacy-meta">
						Choose monthly or yearly billing. Create an account to subscribe after signup.
						{' '}
						Questions? <a href={contactMailto}>{contactEmail}</a>
					</p>
				</div>

				<div className="privacy-content privacy-content--solo bill-atelier">
					<section className="bill-panel" id="public-pricing-plans">
						<div className="bill-panel__head">
							<div className="bill-panel__title">
								<span className="bill-panel__icon"><Sparkles size={14} /></span>
								Subscription plans
							</div>
						</div>

						<div
							className="bill-interval"
							role="group"
							aria-label="Billing interval"
						>
							{BILLING_INTERVALS.map((interval) => {
								const selected = billingInterval === interval;
								const label = interval === 'yearly' ? 'Yearly' : 'Monthly';
								return (
									<button
										key={interval}
										type="button"
										className={`bill-interval__option${selected ? ' is-active' : ''}`}
										aria-pressed={selected}
										onClick={() => setBillingInterval(interval)}
									>
										{label}
									</button>
								);
							})}
						</div>

						{loading ? (
							<p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
								<Loader2 size={14} className="animate-spin" /> Loading plans…
							</p>
						) : null}

						{!loading && error ? (
							<div className="py-6">
								<p className="text-destructive">{error}</p>
								<p className="mt-3 text-sm text-muted-foreground">
									Please try again later or contact {contactEmail}.
								</p>
							</div>
						) : null}

						{!loading && !error && planCards.length === 0 ? (
							<p className="py-6 text-sm text-muted-foreground">
								No subscription plans are available right now.
							</p>
						) : null}

						{!loading && !error && planCards.length > 0 ? (
							<div className="bill-plans">
								{planCards.map((plan) => {
									const { amountLabel, periodLabel } = planPriceDisplay(plan, billingInterval);
									return (
										<div
											key={plan.id}
											className={`bill-plan ${plan.popular ? 'is-popular' : ''}`}
										>
											<div className="flex items-center justify-between gap-2">
												<h3 className="font-display text-xl font-semibold">{plan.name}</h3>
												{plan.popular ? <Badge>Most Popular</Badge> : null}
											</div>
											<p className="bill-plan__price">
												{amountLabel}
												{periodLabel ? <span>{periodLabel}</span> : null}
											</p>
											<p className="text-xs text-muted-foreground">Credits: {plan.credits}</p>
											<ul>
												{plan.items.map((item) => (
													<li key={item}>
														<Check size={15} className="mt-0.5 shrink-0 text-primary" />
														{item}
													</li>
												))}
											</ul>
											<Link to="/signup">
												<Button
													className="w-full"
													variant={plan.popular ? 'primary' : 'outline'}
												>
													Get started with {plan.name}
												</Button>
											</Link>
										</div>
									);
								})}
							</div>
						) : null}
					</section>

					<p className="mt-6 text-center text-sm text-muted-foreground">
						Already have an account?{' '}
						<Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
							Log in
						</Link>
						{' · '}
						<Link to="/terms" className="underline-offset-4 hover:underline">Terms</Link>
						{' · '}
						<Link to="/privacy" className="underline-offset-4 hover:underline">Privacy</Link>
						{' · '}
						<Link to="/refund" className="underline-offset-4 hover:underline">Refunds</Link>
					</p>
				</div>
			</main>

			<footer className="border-t border-border/80">
				<div className="mx-auto flex max-w-[76rem] flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2">
						<PlatformBrandMark
							logoUrl={brandLogoUrl}
							size={14}
							className="auth-brand__mark !h-8 !w-8"
						/>
						<span className="font-display font-semibold text-foreground">{platformName}</span>
					</div>
					<div className="auth-footer__links">
						{footerLinks.map((link) => (
							link.to
								? <Link key={link.label} to={link.to}>{link.label}</Link>
								: (
									<a
										key={link.label}
										href={link.href}
										{...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
									>
										{link.label}
									</a>
								)
						))}
					</div>
				</div>
			</footer>
		</div>
	);
}
