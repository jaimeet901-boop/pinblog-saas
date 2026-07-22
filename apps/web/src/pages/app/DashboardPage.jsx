import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Globe, FileText, Image as ImageIcon, CalendarClock, Activity, Gauge,
	PenLine, Sparkles, Pin, LayoutTemplate, Palette, ListOrdered,
	Settings, Wand2, Clock, ArrowUpRight, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import './DashboardPage.css';

const QUICK_ACTIONS = [
	{ label: 'Write Article', to: '/app/writer', icon: PenLine },
	{ label: 'Generate Image', to: '/app/images', icon: ImageIcon },
	{ label: 'Create Pins', to: '/app/ai-pins', icon: Wand2 },
	{ label: 'Open Templates', to: '/app/ai-pins/templates', icon: LayoutTemplate },
	{ label: 'Brand Kit', to: '/app/ai-pins/brand-kit', icon: Palette },
	{ label: 'Pinterest Hub', to: '/app/pinterest', icon: Pin },
	{ label: 'Publishing Center', to: '/app/pinterest-history', icon: ListOrdered },
	{ label: 'Calendar', to: '/app/calendar', icon: CalendarClock },
	{ label: 'Settings', to: '/app/settings', icon: Settings },
];

function greetingForHour(hour) {
	if (hour < 12) return 'Good morning';
	if (hour < 18) return 'Good afternoon';
	return 'Good evening';
}

function sameDay(dateA, dateB) {
	return dateA.getFullYear() === dateB.getFullYear()
		&& dateA.getMonth() === dateB.getMonth()
		&& dateA.getDate() === dateB.getDate();
}

function statusTone(status) {
	if (status === 'published' || status === 'connected' || status === 'healthy' || status === 'operational') return 'green';
	if (status === 'failed' || status === 'error' || status === 'down') return 'red';
	if (status === 'scheduled' || status === 'queued' || status === 'degraded') return 'amber';
	return 'default';
}

export default function DashboardPage() {
	const { user } = useAuth();
	const { toast } = useToast();
	const [dashboard, setDashboard] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		(async () => {
			setLoading(true);
			setError('');
			try {
				const response = await apiServerClient.fetch('/workspace/v1/dashboard', { method: 'GET' });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(payload.message || 'Failed to load dashboard');
				}
				setDashboard(payload);
			} catch (err) {
				setError(err?.message || 'Failed to load dashboard');
				setDashboard(null);
				toast({ variant: 'destructive', title: 'Dashboard error', description: err?.message || 'Could not load workspace data.' });
			} finally {
				setLoading(false);
			}
		})();
	}, [toast]);

	const stats = dashboard?.statistics || {};
	const credits = dashboard?.credits || {};
	const plan = dashboard?.plan || {};
	const websites = dashboard?.websites || [];
	const calendarJobs = dashboard?.calendarJobs || [];
	const recent = dashboard?.recentArticles || [];
	const recentImages = (dashboard?.recentImages || []).map((item) => ({
		...item,
		image_url: item.imageUrl || item.image_url,
	}));
	const recentPins = recentImages;
	const activityTimeline = dashboard?.recentActivity || [];
	const quota = Number(credits.quota) || Number(plan.credits) || 0;
	const creditsRemaining = Number(credits.remaining ?? credits.balance) || 0;
	const usageCount = Number(credits.used) || Number(stats.monthArticles) || 0;
	const firstName = user?.name?.split(' ')[0] || 'Chef';
	const now = new Date();
	const greeting = greetingForHour(now.getHours());
	const planLabel = plan.slug || plan.name || user?.plan || 'free';

	const primaryWebsite = useMemo(() => {
		const connected = websites.find((site) => site.status === 'connected');
		return connected || websites[0] || null;
	}, [websites]);

	const todaysSchedule = useMemo(() => {
		const today = new Date();
		return calendarJobs
			.filter((job) => job.scheduledAt && sameDay(new Date(job.scheduledAt), today))
			.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
	}, [calendarJobs]);

	const publishedPins = stats.publishedPins || 0;
	const failedJobs = stats.failedJobs || 0;
	const scheduledJobs = stats.scheduledJobs || 0;
	const connectedPinterest = stats.pinterestAccounts || 0;
	const successRate = stats.successRate;

	const systemStatus = useMemo(() => {
		const providers = dashboard?.providerStatus || [];
		const healthyProviders = providers.filter((item) => item.status === 'healthy' || item.enabled).length;
		const wpConnected = websites.some((site) => site.status === 'connected');
		return [
			{ label: 'Workspace', status: dashboard?.workspace?.status || 'active', tone: 'green' },
			{ label: 'WordPress', status: wpConnected ? 'connected' : websites.length ? 'ready' : 'no sites', tone: wpConnected ? 'green' : 'default' },
			{ label: 'Pinterest', status: connectedPinterest ? 'connected' : 'not linked', tone: connectedPinterest ? 'green' : 'amber' },
			{ label: 'AI Providers', status: providers.length ? `${healthyProviders}/${providers.length} ready` : 'checking', tone: healthyProviders ? 'green' : 'amber' },
			{ label: 'Publishing', status: dashboard?.publishingStatus?.queue ? `${dashboard.publishingStatus.queue} queued` : 'idle', tone: scheduledJobs ? 'amber' : 'green' },
			{ label: 'Queue', status: scheduledJobs ? `${scheduledJobs} pending` : 'idle', tone: scheduledJobs ? 'amber' : 'green' },
		];
	}, [dashboard, websites, connectedPinterest, scheduledJobs]);

	const statCards = [
		{ label: 'Articles Created', value: stats.articles, to: '/app/writer', hint: null },
		{ label: 'Pins Generated', value: stats.pins, to: '/app/ai-pins', hint: null },
		{ label: 'Images Generated', value: stats.images || recentImages.length, to: '/app/images', hint: 'From pin library' },
		{ label: 'Published Pins', value: publishedPins, to: '/app/pinterest-history', hint: null },
		{ label: 'Scheduled Jobs', value: scheduledJobs, to: '/app/calendar', hint: null },
		{ label: 'Failed Jobs', value: failedJobs, to: '/app/pinterest-history', hint: null },
		{ label: 'Connected Websites', value: stats.websites, to: '/app/websites', hint: null },
		{ label: 'Pinterest Accounts', value: connectedPinterest || '—', to: '/app/pinterest', hint: connectedPinterest ? null : 'Connect in Hub' },
		{ label: 'Credits Remaining', value: creditsRemaining, to: '/app/subscription', hint: `${usageCount}/${quota || '—'} used` },
		{ label: 'Success Rate', value: successRate == null ? '—' : `${successRate}%`, to: '/app/analytics', hint: successRate == null ? 'Needs publish history' : null },
	];

	return (
		<div className="dash-atelier">
			<section className="dash-hero">
				<p className="dash-hero__eyebrow">Chef IA Command Center</p>
				<h1 className="dash-hero__title">{greeting}, {firstName}</h1>
				<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
					Here&apos;s what&apos;s cooking across writing, imagery, and Pinterest publishing in your workspace.
				</p>
				{error ? (
					<p className="mt-2 text-sm text-destructive">{error}</p>
				) : null}
				<div className="dash-hero__meta">
					<span className="dash-pill"><Sparkles size={12} /> {dashboard?.workspace?.name || user?.name || 'Chef IA'} workspace</span>
					<span className="dash-pill"><Globe size={12} /> {primaryWebsite?.name || primaryWebsite?.domain || 'No website yet'}</span>
					<span className="dash-pill"><Gauge size={12} /> {planLabel} plan</span>
					<span className="dash-pill"><CheckCircle2 size={12} /> {creditsRemaining} credits left</span>
					<span className="dash-pill"><Clock size={12} /> {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
				</div>
				<div className="mt-4 flex flex-wrap gap-2">
					<Link to="/app/writer"><Button className="shadow-md shadow-primary/20"><PenLine size={16} /> New article</Button></Link>
					<Link to="/app/ai-pins"><Button variant="outline"><Wand2 size={16} /> Open AI Pins</Button></Link>
				</div>
			</section>

			<div className="dash-stats">
				{statCards.map((card) => (
					<Link key={card.label} to={card.to} className="dash-stat">
						<p className="dash-stat__label">{card.label}</p>
						{loading ? (
							<div className="mt-3 h-7 w-12 animate-pulse rounded-md bg-secondary" />
						) : (
							<p className="dash-stat__value">{card.value ?? 0}</p>
						)}
						{card.hint ? <p className="dash-stat__hint">{card.hint}</p> : null}
					</Link>
				))}
			</div>

			<div className="dash-shell">
				<div className="dash-main">
					<section className="dash-panel">
						<div className="dash-panel__head">
							<div className="dash-panel__title">
								<span className="dash-panel__icon"><Activity size={14} /></span>
								Activity Workspace
							</div>
							<span className="text-[11px] text-muted-foreground">Live snapshot</span>
						</div>

						<div className="mb-4">
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Today&apos;s Schedule</p>
							{loading ? (
								<div className="space-y-2">{[0, 1].map((i) => <div key={i} className="dash-skeleton" style={{ height: '3.25rem' }} />)}</div>
							) : todaysSchedule.length === 0 ? (
								<div className="dash-empty">
									<p>No scheduled content today</p>
									<p>Schedule pins from AI Pins to fill this widget.</p>
									<Link to="/app/calendar" className="mt-3 inline-block"><Button size="sm" variant="outline">Open Calendar</Button></Link>
								</div>
							) : (
								<div className="dash-list">
									{todaysSchedule.map((job) => (
										<div key={job.id} className="dash-row">
											<span className="dash-thumb flex items-center justify-center text-muted-foreground"><Pin size={12} /></span>
											<div className="min-w-0 flex-1">
												<p className="truncate text-sm font-medium">{job.title || 'Scheduled pin'}</p>
												<p className="text-xs text-muted-foreground">
													{new Date(job.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
													{' · '}
													{job.eventType || 'schedule'}
												</p>
											</div>
											<Badge tone={statusTone(job.status)}>{job.status || 'scheduled'}</Badge>
										</div>
									))}
								</div>
							)}
						</div>

						<div className="mb-4">
							<div className="dash-panel__head">
								<p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recent Articles</p>
								<Link to="/app/writer" className="text-xs font-medium text-primary hover:underline">Open writer</Link>
							</div>
							{loading ? (
								<div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="dash-skeleton" style={{ height: '3.25rem' }} />)}</div>
							) : recent.length === 0 ? (
								<div className="dash-empty">
									<p>No articles yet</p>
									<p>Generate your first SEO recipe article.</p>
								</div>
							) : (
								<div className="dash-list">
									{recent.map((article) => (
										<div key={article.id} className="dash-row">
											<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
												<FileText size={15} />
											</span>
											<div className="min-w-0 flex-1">
												<p className="truncate text-sm font-medium">{article.title || 'Untitled'}</p>
												<p className="text-xs text-muted-foreground">
													{article.created ? new Date(article.created).toLocaleDateString() : '—'}
												</p>
											</div>
											<Badge tone={statusTone(article.status)}>{article.status || 'draft'}</Badge>
											<Link to="/app/writer"><Button size="sm" variant="ghost"><ArrowUpRight size={14} /> Open</Button></Link>
										</div>
									))}
								</div>
							)}
						</div>

						<div className="mb-4">
							<div className="dash-panel__head">
								<p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recent AI Images</p>
								<Link to="/app/images" className="text-xs font-medium text-primary hover:underline">Image studio</Link>
							</div>
							{loading ? (
								<div className="dash-gallery">{[0, 1, 2].map((i) => <div key={i} className="dash-skeleton" style={{ height: '6rem' }} />)}</div>
							) : recentImages.length === 0 ? (
								<div className="dash-empty">
									<p>No images yet</p>
									<p>Generate visuals in the AI Image Studio.</p>
								</div>
							) : (
								<div className="dash-gallery">
									{recentImages.map((pin) => (
										<div key={pin.id} className="dash-gallery__item">
											<img src={pin.image_url} alt={pin.title || 'Generated'} loading="lazy" decoding="async" />
											<p>
												{pin.created ? new Date(pin.created).toLocaleString() : '—'}
											</p>
										</div>
									))}
								</div>
							)}
						</div>

						<div>
							<div className="dash-panel__head">
								<p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recent Pins</p>
								<Link to="/app/ai-pins" className="text-xs font-medium text-primary hover:underline">AI Pins</Link>
							</div>
							{loading ? (
								<div className="space-y-2">{[0, 1].map((i) => <div key={i} className="dash-skeleton" style={{ height: '3.25rem' }} />)}</div>
							) : recentPins.length === 0 ? (
								<div className="dash-empty">
									<p>No pins yet</p>
									<p>Create pins from articles in AI Pins.</p>
								</div>
							) : (
								<div className="dash-list">
									{recentPins.map((pin) => (
										<div key={pin.id} className="dash-row">
											{pin.image_url ? (
												<img className="dash-thumb" src={pin.image_url} alt="" loading="lazy" decoding="async" />
											) : (
												<span className="dash-thumb flex items-center justify-center text-muted-foreground"><Pin size={12} /></span>
											)}
											<div className="min-w-0 flex-1">
												<p className="truncate text-sm font-medium">{pin.title || 'Untitled pin'}</p>
												<p className="text-xs text-muted-foreground">
													{pin.created ? new Date(pin.created).toLocaleDateString() : '—'}
												</p>
											</div>
											<Badge tone="default">image</Badge>
											<Link to="/app/ai-pins"><Button size="sm" variant="ghost">View</Button></Link>
										</div>
									))}
								</div>
							)}
						</div>
					</section>

					<section className="dash-panel">
						<div className="dash-panel__head">
							<div className="dash-panel__title">
								<span className="dash-panel__icon"><Clock size={14} /></span>
								Activity Timeline
							</div>
						</div>
						{loading ? (
							<div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="dash-skeleton" style={{ height: '2.75rem' }} />)}</div>
						) : activityTimeline.length === 0 ? (
							<div className="dash-empty">
								<p>No recent activity</p>
								<p>Your generation and publishing events will appear here.</p>
							</div>
						) : (
							<div className="dash-timeline">
								{activityTimeline.map((event) => (
									<div key={event.id} className="dash-timeline__item">
										<span className="dash-timeline__dot" />
										<div className="rounded-xl border border-border/80 bg-background/45 px-3 py-2">
											<div className="flex items-center justify-between gap-2">
												<p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{event.type}</p>
												<span className="text-[11px] text-muted-foreground">{event.at ? new Date(event.at).toLocaleString() : '—'}</span>
											</div>
											<p className="mt-1 truncate text-sm font-medium">{event.title}</p>
										</div>
									</div>
								))}
							</div>
						)}
					</section>
				</div>

				<aside className="dash-side">
					<section className="dash-panel">
						<div className="dash-panel__head">
							<div className="dash-panel__title">
								<span className="dash-panel__icon"><Sparkles size={14} /></span>
								Quick Actions
							</div>
						</div>
						<div className="dash-actions">
							{QUICK_ACTIONS.map((action) => {
								const Icon = action.icon;
								return (
									<Link key={action.to} to={action.to} className="dash-action">
										<span><Icon size={14} /></span>
										{action.label}
									</Link>
								);
							})}
						</div>
					</section>

					<section className="dash-panel">
						<div className="dash-panel__head">
							<div className="dash-panel__title">
								<span className="dash-panel__icon"><Gauge size={14} /></span>
								Monthly usage
							</div>
						</div>
						<div className="flex items-baseline justify-between">
							<p className="text-sm text-muted-foreground">{usageCount} / {quota || '—'} credits</p>
							<span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{creditsRemaining} left</span>
						</div>
						<div className="dash-meter mt-2">
							<span style={{ width: `${Math.min(100, quota ? (usageCount / quota) * 100 : 0)}%` }} />
						</div>
						<Link to="/app/subscription" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">Upgrade plan</Link>
					</section>

					<section className="dash-panel">
						<div className="dash-panel__head">
							<div className="dash-panel__title">
								<span className="dash-panel__icon"><CheckCircle2 size={14} /></span>
								System Status
							</div>
						</div>
						<div className="dash-status">
							{systemStatus.map((row) => (
								<div key={row.label} className="dash-status__row">
									<span className="inline-flex items-center gap-1.5">
										{row.tone === 'amber' ? <AlertTriangle size={13} className="text-amber-600" /> : <CheckCircle2 size={13} className="text-emerald-600" />}
										{row.label}
									</span>
									<Badge tone={row.tone}>{row.status}</Badge>
								</div>
							))}
						</div>
					</section>

					<section className="dash-panel">
						<div className="dash-panel__head">
							<div className="dash-panel__title">
								<span className="dash-panel__icon"><Activity size={14} /></span>
								Recent Activity
							</div>
						</div>
						{loading ? (
							<div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="dash-skeleton" style={{ height: '2.75rem' }} />)}</div>
						) : activityTimeline.length === 0 ? (
							<div className="dash-empty">
								<p>Quiet so far</p>
								<p>Start creating to see updates here.</p>
							</div>
						) : (
							<div className="dash-list">
								{activityTimeline.slice(0, 5).map((event) => (
									<div key={`side-${event.id}`} className="dash-row">
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">{event.title}</p>
											<p className="text-xs text-muted-foreground">{event.type} · {event.at ? new Date(event.at).toLocaleDateString() : '—'}</p>
										</div>
									</div>
								))}
							</div>
						)}
					</section>
				</aside>
			</div>
		</div>
	);
}
