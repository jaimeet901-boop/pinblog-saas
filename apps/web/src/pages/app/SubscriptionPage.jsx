import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Check, Crown, CreditCard, Download, RefreshCw, Sparkles, Gauge,
	FileText, Image as ImageIcon, Pin, Globe, HardDrive, AlertTriangle,
	Settings, Coins,
} from 'lucide-react';
import {
	ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
	XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Spinner } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
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

const CHART_COLORS = ['hsl(12 80% 55%)', 'hsl(38 90% 55%)', 'hsl(142 45% 40%)', 'hsl(210 55% 45%)'];

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
	return {
		id: plan.slug || plan.id,
		planId: plan.id,
		name: plan.name,
		price: Number(plan.monthlyPrice ?? plan.price) || 0,
		credits: plan.credits,
		popular: Boolean(plan.highlight),
		items: planItemsFromDto(plan),
		placeholder: false,
	};
}

export default function SubscriptionPage() {
	const { user, refresh } = useAuth();
	const { toast } = useToast();
	const [busy, setBusy] = useState(null);
	const [loadingUsage, setLoadingUsage] = useState(true);
	const [plans, setPlans] = useState([]);
	const [subscription, setSubscription] = useState(null);
	const [planDto, setPlanDto] = useState(null);
	const [credits, setCredits] = useState({ balance: 0, quota: 0, used: 0, remaining: 0 });
	const [usage, setUsage] = useState({
		articles: 0,
		images: 0,
		pins: 0,
		websites: 0,
		pinterestAccounts: 0,
		monthArticles: 0,
	});

	const choose = async (planSlug) => {
		if (planSlug === (subscription?.planSlug || user?.plan)) return;
		setBusy(planSlug);
		try {
			const response = await apiServerClient.fetch('/workspace/v1/subscription/change', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ planSlug }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload.message || 'Could not update plan');
			}
			await applySubscriptionPayload(payload);
			await refresh();
			toast({ title: 'Plan updated', description: `You are now on the ${payload.plan?.name || planSlug} plan.` });
		} catch (err) {
			toast({ variant: 'destructive', title: 'Error', description: err?.message });
		} finally {
			setBusy(null);
		}
	};

	const applySubscriptionPayload = (payload) => {
		setSubscription(payload.subscription || null);
		setPlanDto(payload.plan || null);
		setPlans((payload.plans || []).map(mapPlanCard));
		setCredits(payload.credits || { balance: 0, quota: 0, used: 0, remaining: 0 });
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
		loadUsage();
	}, []);

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
			writer: features.aiWriter ? 'Included' : 'Unavailable',
			images: features.aiImages ? 'Included' : (currentPlanId === 'free' ? 'Limited' : 'Included'),
			pins: features.pinterest ? 'Full' : (currentPlanId === 'free' || currentPlanId === 'starter' ? 'Basic' : 'Full'),
			templates: features.templates ? 'Included' : 'Included',
			brand: features.brandKit ? 'Included' : (currentPlanId === 'free' ? 'Basic' : 'Included'),
			analytics: features.analytics ? 'Included' : (currentPlanId === 'free' ? 'Basic' : 'Included'),
			pinterest: usage.pinterestAccounts ? `${usage.pinterestAccounts} linked` : (features.calendar ? 'Scheduler ready' : 'Connect in Hub'),
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
	const allPlanCards = [...plans, ...PLACEHOLDER_PLANS];

	const notifyBillingPlaceholder = (action) => {
		toast({
			title: `${action} unavailable`,
			description: 'Stripe billing UI is a placeholder until payment integration is connected.',
		});
	};

	const scrollToPlans = () => {
		document.getElementById('bill-upgrade-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	};

	return (
		<div className="bill-atelier">
			<section className="bill-hero">
				<p className="bill-hero__eyebrow">Chef IA Billing & Credits</p>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<h1 className="bill-hero__title">{currentPlan.name} plan</h1>
						<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
							Manage credits, review usage, and upgrade your workspace when you&apos;re ready to scale.
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button onClick={scrollToPlans}><Crown size={15} /> Upgrade Plan</Button>
						<Button variant="outline" onClick={() => notifyBillingPlaceholder('Manage Billing')}>
							<Settings size={15} /> Manage Billing
						</Button>
					</div>
				</div>
				<div className="bill-hero__grid">
					<div className="bill-hero__metric"><span>Current plan</span><strong>{currentPlan.name}</strong></div>
					<div className="bill-hero__metric"><span>Workspace</span><strong>{user?.name || 'Chef IA'}</strong></div>
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
					Secure billing powered by Stripe · Checkout session not connected yet
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
							${currentPlan.price}/mo · {quota} monthly article credits · includes the Chef IA atelier suite.
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
						<div className="bill-plans">
							{allPlanCards.map((plan) => {
								const current = !plan.placeholder && plan.id === currentPlanId;
								const priceLabel = plan.price == null ? 'Custom' : `$${plan.price}`;
								return (
									<div key={plan.id} className={`bill-plan ${plan.popular ? 'is-popular' : ''} ${current ? 'is-current' : ''}`}>
										<div className="flex items-center justify-between gap-2">
											<h3 className="font-display text-xl font-semibold">{plan.name}</h3>
											{plan.popular ? <Badge>Most Popular</Badge> : null}
											{plan.placeholder ? <Badge tone="amber">Placeholder</Badge> : null}
											{current ? <Badge tone="blue">Current</Badge> : null}
										</div>
										<p className="bill-plan__price">
											{priceLabel}
											{plan.price != null ? <span>/mo</span> : null}
										</p>
										<p className="text-xs text-muted-foreground">Credits: {plan.credits}</p>
										<ul>
											{plan.items.map((item) => (
												<li key={item}><Check size={15} className="mt-0.5 shrink-0 text-primary" />{item}</li>
											))}
										</ul>
										{plan.placeholder ? (
											<Button variant="outline" onClick={() => notifyBillingPlaceholder(`${plan.name} upgrade`)}>
												Contact sales
											</Button>
										) : (
											<Button
												variant={current ? 'outline' : plan.popular ? 'primary' : 'outline'}
												disabled={current || busy === plan.id}
												onClick={() => choose(plan.id)}
											>
												{current ? 'Current plan' : busy === plan.id ? 'Processing…' : `Upgrade to ${plan.name}`}
											</Button>
										)}
									</div>
								);
							})}
						</div>
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
								<span className="bill-panel__icon"><CreditCard size={14} /></span>
								Payment Method
							</div>
						</div>
						<div className="bill-card-box">
							<p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Current card</p>
							<p className="bill-card-box__number">•••• •••• •••• — — — —</p>
							<p className="mt-2 text-xs text-muted-foreground">No payment method on file · Stripe placeholder</p>
						</div>
						<div className="mt-3 grid gap-2">
							<Button size="sm" variant="outline" onClick={() => notifyBillingPlaceholder('Add Card')}>Add Card</Button>
							<Button size="sm" variant="outline" onClick={() => notifyBillingPlaceholder('Change Card')}>Change Card</Button>
							<Button size="sm" variant="ghost" onClick={() => notifyBillingPlaceholder('Remove Card')}>Remove Card</Button>
						</div>
					</section>

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
		</div>
	);
}
