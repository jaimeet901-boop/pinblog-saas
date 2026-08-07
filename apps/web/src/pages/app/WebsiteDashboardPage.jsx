import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Globe, Newspaper, RefreshCw, ScanSearch } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Card, Empty, PageHeader, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { writeStoredActiveWebsiteId } from '@/lib/websites/activeWebsite';
import {
	deriveWebsiteLifecycle,
	setWordPressSkipped,
	setupStepMessage,
} from '@/lib/websites/websiteLifecycle';
import {
	buildFacebookStudioHref,
	fetchFacebookStudioProgress,
} from '@/lib/websites/facebookDashboardProgress';
import { usePinterestConnected } from '@/hooks/usePinterestConnected';
import SetupProgressCard from '@/components/websites/SetupProgressCard';
import OperateStatusStrip from '@/components/websites/OperateStatusStrip';
import OperateQuickActions from '@/components/websites/OperateQuickActions';
import OperateContentProduction from '@/components/websites/OperateContentProduction';
import OperatePublishingPipeline from '@/components/websites/OperatePublishingPipeline';
import OperateAnalyticsSnapshot from '@/components/websites/OperateAnalyticsSnapshot';
import OperateAdvancedPanel, { OperateActivityFeed, OperateScanProgress } from '@/components/websites/OperateAdvancedPanel';
import { useAuth } from '@/context/AuthContext';

function formatDateTime(value) {
	if (!value) {
		return '—';
	}

	try {
		return new Date(value).toLocaleString();
	} catch {
		return '—';
	}
}

function formatStatValue(value) {
	if (value === 0) {
		return '0';
	}
	if (value == null || value === '') {
		return '—';
	}
	return value;
}

function statusTone(status) {
	const value = String(status || '').toLowerCase();
	if (['connected', 'active', 'ready', 'healthy', 'operational', 'ok', 'published', 'completed', 'configured', 'green'].includes(value)) {
		return 'green';
	}
	if (['failed', 'error', 'down', 'disconnected', 'not_configured', 'red'].includes(value)) {
		return 'red';
	}
	if (['running', 'scanning', 'queued', 'pending', 'degraded', 'scheduled', 'paused', 'untested', 'idle', 'amber', 'blue'].includes(value)) {
		return 'amber';
	}
	return 'default';
}

function timelineTone(item) {
	const tone = String(item?.tone || item?.color || '').toLowerCase();
	if (['green', 'red', 'amber', 'blue', 'default'].includes(tone)) {
		return tone;
	}
	return statusTone(item?.status || item?.type);
}

function timelineTypeLabel(type) {
	const value = String(type || '').toLowerCase();
	if (value === 'scan') return 'Scan';
	if (value === 'synchronization' || value === 'sync') return 'Sync';
	if (value === 'ai_generation') return 'AI Generation';
	if (value === 'publishing' || value === 'publish') return 'Publish';
	if (value === 'error') return 'Error';
	if (value === 'retry') return 'Retry';
	return type || 'Activity';
}

async function readJson(response) {
	return response.json().catch(() => ({}));
}

function consumeSseChunk(chunk, handlers) {
	if (!chunk?.trim()) {
		return;
	}

	const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
	if (!dataLine) {
		return;
	}

	let payload;
	try {
		payload = JSON.parse(dataLine.slice(6));
	} catch {
		return;
	}

	handlers(payload);
}

function SectionTitle({ children }) {
	return <h3 className="font-semibold">{children}</h3>;
}

function MetaLine({ label, children }) {
	return (
		<p className="text-sm">
			<span className="text-muted-foreground">{label}:</span> {children}
		</p>
	);
}

function EmptyLines({ text = 'No data available yet.' }) {
	return <p className="mt-3 text-sm text-muted-foreground">{text}</p>;
}

function SkeletonBlock({ className = '' }) {
	return <div className={`animate-pulse rounded-md bg-secondary ${className}`} />;
}

function augmentLifecycleWithFacebook(lifecycle, hasFacebookPost) {
	return {
		...lifecycle,
		facebookSetupEnabled: true,
		hasFacebookPost,
	};
}

function DashboardLoadingSkeleton() {
	return (
		<div>
			<div className="grid gap-4 lg:grid-cols-4">
				{[0, 1, 2, 3].map((item) => (
					<Card key={item}>
						<SkeletonBlock className="h-4 w-24" />
						<SkeletonBlock className="mt-3 h-8 w-16" />
					</Card>
				))}
			</div>
			<div className="mt-4">
				<Card>
					<SkeletonBlock className="h-5 w-32" />
					<div className="mt-3 flex flex-wrap gap-2">
						{[0, 1, 2, 3].map((item) => <SkeletonBlock key={item} className="h-8 w-28" />)}
					</div>
				</Card>
			</div>
			<div className="mt-4 grid gap-4 lg:grid-cols-3">
				<Card className="lg:col-span-1">
					<div className="flex items-center gap-3">
						<SkeletonBlock className="h-12 w-12 rounded-xl" />
						<div className="flex-1">
							<SkeletonBlock className="h-5 w-32" />
							<SkeletonBlock className="mt-2 h-4 w-40" />
						</div>
					</div>
					<div className="mt-4 space-y-2">
						<SkeletonBlock className="h-4 w-full" />
						<SkeletonBlock className="h-4 w-5/6" />
						<SkeletonBlock className="h-4 w-4/6" />
					</div>
				</Card>
				<Card className="lg:col-span-2">
					<SkeletonBlock className="h-5 w-28" />
					<SkeletonBlock className="mt-4 h-28 w-full rounded-xl" />
				</Card>
			</div>
			<div className="mt-4 grid gap-4 lg:grid-cols-2">
				{[0, 1, 2, 3].map((item) => (
					<Card key={item}>
						<SkeletonBlock className="h-5 w-36" />
						<div className="mt-3 space-y-2">
							<SkeletonBlock className="h-4 w-full" />
							<SkeletonBlock className="h-4 w-5/6" />
							<SkeletonBlock className="h-4 w-4/6" />
						</div>
					</Card>
				))}
			</div>
		</div>
	);
}

export default function WebsiteDashboardPage() {
	const { websiteId } = useParams();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const { toast } = useToast();
	const { user } = useAuth();
	const { pinterestConnected } = usePinterestConnected();
	const [lifecycleTick, setLifecycleTick] = useState(0);
	const [website, setWebsite] = useState(null);
	const [dashboard, setDashboard] = useState(null);
	const [loading, setLoading] = useState(true);
	const [scanning, setScanning] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [scanMessages, setScanMessages] = useState([]);
	const [scanSummary, setScanSummary] = useState(null);
	const [hasFacebookPost, setHasFacebookPost] = useState(false);

	const refreshFacebookProgress = async (id = websiteId) => {
		const done = await fetchFacebookStudioProgress(apiServerClient, id);
		setHasFacebookPost(done);
	};

	const loadWebsite = async ({ silent = false } = {}) => {
		if (!silent) {
			setLoading(true);
		}
		try {
			const response = await apiServerClient.fetch(`/websites/${websiteId}/dashboard`, { method: 'GET' });
			const data = await readJson(response);

			if (!response.ok) {
				// Fallback to classic detail endpoint if dashboard is unavailable.
				const fallback = await apiServerClient.fetch(`/websites/${websiteId}`, { method: 'GET' });
				const fallbackData = await readJson(fallback);
				if (!fallback.ok) {
					throw new Error(fallbackData?.message || data?.message || `Failed to load website (${response.status})`);
				}
				setWebsite(fallbackData);
				setDashboard(null);
				setScanSummary(fallbackData.last_scan_summary || null);
				void refreshFacebookProgress(websiteId);
				return;
			}

			setWebsite(data.website);
			setDashboard(data.dashboard || null);
			setScanSummary(data.website?.last_scan_summary || null);
			void refreshFacebookProgress(websiteId);
		} catch (error) {
			if (!silent) {
				setWebsite(null);
				setDashboard(null);
			}
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			if (!silent) {
				setLoading(false);
			}
		}
	};

	useEffect(() => {
		if (websiteId) {
			writeStoredActiveWebsiteId(websiteId, { emit: true });
		}
		loadWebsite({ silent: false });
	}, [websiteId]);

	useEffect(() => {
		if (!websiteId) {
			return undefined;
		}

		const intervalId = setInterval(() => {
			loadWebsite({ silent: true });
		}, 30000);

		return () => clearInterval(intervalId);
	}, [websiteId]);

	const handleScan = async () => {
		setScanning(true);
		setScanMessages(['Starting website scan...']);
		setScanSummary(null);
		let completedSummary = null;
		let failedMessage = '';

		const onPayload = (payload) => {
			if (payload.type === 'progress') {
				setScanMessages((prev) => [...prev.slice(-7), payload.message]);
			}

			if (payload.type === 'summary' || payload.type === 'completed') {
				completedSummary = payload.summary || completedSummary;
				setScanSummary(payload.summary || null);
			}

			if (payload.type === 'error') {
				failedMessage = payload.message || 'Website scan failed';
			}
		};

		try {
			const response = await apiServerClient.fetch(`/websites/${websiteId}/scan`, {
				method: 'POST',
				headers: { Accept: 'text/event-stream' },
			});

			if (!response.ok || !response.body) {
				const data = await readJson(response);
				throw new Error(data?.message || `Failed to scan website (${response.status})`);
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const events = buffer.split('\n\n');
				buffer = events.pop() || '';

				for (const event of events) {
					consumeSseChunk(event, onPayload);
				}
			}

			buffer += decoder.decode();
			if (buffer.trim()) {
				for (const event of buffer.split('\n\n')) {
					consumeSseChunk(event, onPayload);
				}
			}

			if (failedMessage && !completedSummary) {
				throw new Error(failedMessage);
			}

			if (!completedSummary) {
				throw new Error(failedMessage || 'Scan ended without a completion event. Please try again.');
			}

			const persisted = completedSummary.persistedArticles;
			const discovered = completedSummary.found || 0;
			const saveErrors = Array.isArray(completedSummary.errors) ? completedSummary.errors : [];

			if (discovered > 0 && (persisted === 0 || persisted == null) && (completedSummary.newArticles || 0) === 0) {
				throw new Error(failedMessage || saveErrors[0] || 'Scan found articles but none were saved to PocketBase.');
			}

			if (typeof persisted === 'number' && persisted === 0 && discovered > 0) {
				throw new Error(failedMessage || saveErrors[0] || `Scan found ${discovered} articles but PocketBase still has 0 for this website.`);
			}

			const savedCount = (completedSummary.newArticles || 0) + (completedSummary.updatedArticles || 0);
			const persistedLabel = typeof persisted === 'number'
				? `${persisted} articles saved for this website.`
				: savedCount > 0
					? `Saved ${savedCount} articles (${discovered} discovered).`
					: `Scan finished. Discovered ${discovered} articles.`;
			toast({
				title: 'Scan complete',
				description: `${persistedLabel} Next: review Articles, then create AI Pins.`,
			});
			await loadWebsite({ silent: true });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Scan failed', description: error.message });
			await loadWebsite({ silent: true });
		} finally {
			setScanning(false);
		}
	};

	const handleSync = async () => {
		try {
			const response = await apiServerClient.fetch('/wordpress/sites', { method: 'GET' });
			const data = await readJson(response);
			if (!response.ok) {
				throw new Error(data?.message || 'Failed to sync WordPress sites');
			}
			toast({ title: 'Sync complete', description: 'WordPress refreshed. Next: scan articles if content looks stale.' });
			await handleScan();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Sync failed', description: error.message });
		}
	};

	const handlePublishReady = async () => {
		const publishReady = dashboard?.publishReady || {};
		const pinIds = Array.isArray(publishReady.pinIds) ? publishReady.pinIds.filter(Boolean) : [];
		const accountId = publishReady.accountId || '';
		const boardId = publishReady.boardId || '';

		if (!pinIds.length) {
			toast({ variant: 'destructive', title: 'Publish failed', description: 'Missing pinIds — no ready pins found for this website.' });
			return;
		}
		if (!boardId) {
			toast({ variant: 'destructive', title: 'Publish failed', description: 'Missing boardId — select a Pinterest board before publishing.' });
			return;
		}
		if (!accountId) {
			toast({ variant: 'destructive', title: 'Publish failed', description: 'Missing accountId — select a Pinterest account before publishing.' });
			return;
		}

		setPublishing(true);
		try {
			const response = await apiServerClient.fetch('/pinterest/publish', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pinIds, accountId, boardId }),
			});
			const data = await readJson(response);
			if (!response.ok) {
				throw new Error(data?.message || `Publish failed (${response.status})`);
			}
			const jobCount = Array.isArray(data.jobs) ? data.jobs.length : pinIds.length;
			toast({
				title: 'Publish queued',
				description: `${jobCount} pin${jobCount === 1 ? '' : 's'} queued. Next: open Analytics to track results.`,
			});
			await loadWebsite({ silent: true });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Publish failed', description: error.message });
		} finally {
			setPublishing(false);
		}
	};

	const runQuickAction = (action) => {
		if (!action) return;

		if (action.action === 'scan') {
			handleScan();
			return;
		}
		if (action.action === 'sync') {
			handleSync();
			return;
		}
		if (action.action === 'publish_ready') {
			handlePublishReady();
			return;
		}
		if (action.action === 'refresh') {
			loadWebsite({ silent: true });
			return;
		}
		if (action.action === 'generate_pins' || action.action === 'analytics') {
			if (action.href) {
				navigate(action.href);
			}
			return;
		}
		if (action.href) {
			navigate(action.href);
		}
	};

	if (loading) {
		return <DashboardLoadingSkeleton />;
	}

	if (!website) {
		return <Empty icon={Globe} title="Website not found" subtitle="This website could not be loaded." action={<Button onClick={() => navigate('/app/websites')}><ArrowLeft size={16} /> Back</Button>} />;
	}

	const stats = website.stats || { totalArticles: 0, newArticles: 0, lastScan: '', nextScheduledScan: '' };
	const controlStats = dashboard?.stats || {};
	const health = dashboard?.health || {};
	const indicators = dashboard?.indicators || {};
	const wordpress = dashboard?.wordpress || {};
	const aiGeneration = dashboard?.aiGeneration || {};
	const pinterest = dashboard?.pinterest || {};
	const publishingHistory = dashboard?.publishingHistory || [];
	const queue = dashboard?.queue || {};
	const recentActivity = dashboard?.recentActivity || [];
	const activityTimeline = dashboard?.activityTimeline || [];
	const errorLogs = dashboard?.errorLogs || [];
	const storageUsage = dashboard?.storageUsage || {};
	const creditsUsage = dashboard?.creditsUsage || null;
	const lastAiOperations = dashboard?.lastAiOperations || [];
	const score = dashboard?.score || null;
	const problems = dashboard?.problems || [];
	const performance = dashboard?.performance || {};
	const contentOverview = dashboard?.contentOverview || {};
	const widgets = dashboard?.widgets || {};
	const systemHealth = widgets.systemHealth || {};
	const contentPipeline = widgets.contentPipeline || contentOverview;
	const pinterestPerformance = widgets.pinterestPerformance || {};
	const aiUsage = widgets.aiUsage || {};
	const recentErrors = widgets.recentErrors || errorLogs;
	const upcomingScheduled = widgets.upcomingScheduled || [];
	const websiteResources = widgets.websiteResources || storageUsage;
	const lifecycle = augmentLifecycleWithFacebook(deriveWebsiteLifecycle({
		...website,
		control: {
			wordpress: dashboard?.wordpress || website.control?.wordpress,
			siteInfo: { lastScan: controlStats.lastScan || stats.lastScan },
			stats: controlStats,
		},
		stats: { ...stats, ...controlStats, publishedPins: controlStats.publishedPins, aiPins: aiGeneration.totalPins },
		performance,
		dashboard,
	}, { pinterestConnected }), hasFacebookPost);
	void lifecycleTick;
	const isSetup = lifecycle.mode === 'setup';
	const showSetupGuide = isSetup || lifecycle.step === 'analytics';

	const filteredQuickActions = (dashboard?.quickActions || [
		{ id: 'scan', label: 'Scan Website', action: 'scan' },
		{ id: 'sync', label: 'Sync Articles', action: 'sync' },
		{ id: 'generate_pins', label: 'Generate AI Pins', href: `/app/ai-pins?websiteId=${website.id}`, action: 'generate_pins' },
		{ id: 'publish_ready', label: 'Publish Ready Pins', action: 'publish_ready' },
		{ id: 'refresh', label: 'Refresh Dashboard', action: 'refresh' },
		{ id: 'analytics', label: 'Open Analytics', href: `/app/analytics?websiteId=${website.id}`, action: 'analytics' },
	]).filter((action) => {
		if (!isSetup) return true;
		if (action.action === 'scan' || action.action === 'sync' || action.action === 'refresh') return true;
		if (action.action === 'generate_pins') return lifecycle.hasArticles;
		if (action.action === 'publish_ready' || action.action === 'analytics') return lifecycle.hasPublished || lifecycle.pinCount > 0;
		return false;
	}).map((action) => {
		if (action.action === 'analytics') {
			return { ...action, href: `/app/analytics?websiteId=${encodeURIComponent(website.id)}` };
		}
		if (action.action === 'generate_pins') {
			return { ...action, href: `/app/ai-pins?websiteId=${encodeURIComponent(website.id)}` };
		}
		return action;
	});

	const quickActions = filteredQuickActions.length
		? filteredQuickActions
		: [{ id: 'scan', label: 'Scan Website', action: 'scan' }];

	const activityItems = (activityTimeline.length ? activityTimeline : recentActivity);
	const draftCount = Number(controlStats.readyArticles ?? contentOverview.readyForPins ?? contentPipeline.readyForPins ?? 0);
	const scheduledCount = upcomingScheduled.length || Number(pinterestPerformance.pending ?? pinterest.pending ?? 0);
	const publishedCount = Number(controlStats.publishedPins ?? performance.totalPublishedPins ?? pinterestPerformance.totalPublishedPins ?? 0);
	const failedCount = Number(controlStats.failedJobs ?? pinterestPerformance.failed ?? pinterest.failed ?? queue.failedJobs ?? 0);
	const showTemplates = user?.role === 'admin';
	const historyHref = `/app/pinterest-history?websiteId=${encodeURIComponent(website.id)}`;
	const analyticsHref = `/app/analytics?websiteId=${encodeURIComponent(website.id)}`;
	const pinsHref = `/app/ai-pins?websiteId=${encodeURIComponent(website.id)}`;
	const writerHref = `/app/writer?websiteId=${encodeURIComponent(website.id)}`;
	const imagesHref = `/app/images?websiteId=${encodeURIComponent(website.id)}`;

	return (
		<div>
			<PageHeader
				title={website.name}
				subtitle={isSetup ? setupStepMessage(lifecycle.step) : 'Production workspace — status, actions, pipeline, and analytics for this website.'}
				action={(
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={() => navigate('/app/websites')}><ArrowLeft size={16} /> Websites</Button>
						{lifecycle.hasArticles ? (
							<Button variant="outline" onClick={() => navigate(`/app/websites/${website.id}/articles`)}><Newspaper size={16} /> Articles</Button>
						) : null}
						{!isSetup || lifecycle.step === 'scan' ? (
							<Button onClick={handleScan} disabled={scanning}><ScanSearch size={16} /> {scanning ? 'Scanning...' : 'Scan Website'}</Button>
						) : null}
					</div>
				)}
			/>

			{showSetupGuide ? (
				<div className="mb-4">
					<SetupProgressCard
						lifecycle={lifecycle}
						primaryBusy={scanning}
						onFacebookPrimary={() => navigate(buildFacebookStudioHref(website.id))}
						onPrimary={() => {
							if (lifecycle.step === 'wordpress' || searchParams.get('setup') === 'wordpress') {
								navigate('/app/websites', { state: { openWebsiteSettings: website.id } });
								return;
							}
							if (lifecycle.step === 'scan') {
								handleScan();
								return;
							}
							navigate(lifecycle.primaryHref);
						}}
						onSecondary={lifecycle.secondaryLabel ? () => {
							if (lifecycle.secondaryAction === 'skip_wordpress') {
								setWordPressSkipped(website.id, true);
								setLifecycleTick((n) => n + 1);
								toast({
									title: 'WordPress skipped',
									description: 'Next recommended step: scan your website.',
								});
								return;
							}
							if (lifecycle.secondaryAction === 'articles') {
								navigate(`/app/websites/${website.id}/articles`);
							}
						} : undefined}
					/>
				</div>
			) : null}

			{scanSummary && isSetup ? (
				<Card className="mb-4">
					<p className="text-sm font-medium">
						Scan complete — {formatStatValue(scanSummary.found ?? ((scanSummary.newArticles || 0) + (scanSummary.updatedArticles || 0)))} articles found
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Review articles next, then create your first AI Pin.
					</p>
					<div className="mt-3">
						<Button size="sm" onClick={() => navigate(`/app/websites/${website.id}/articles`)}>
							Open Articles
						</Button>
					</div>
				</Card>
			) : null}

			{lifecycle.step === 'analytics' ? (
				<Card className="mb-4 border-green-500/30 bg-green-500/5">
					<p className="text-sm font-medium">✓ First pin published</p>
					<p className="mt-1 text-xs text-muted-foreground">
						This website is now in Operate Mode. Open Analytics to measure performance.
					</p>
					<div className="mt-3">
						<Button size="sm" onClick={() => navigate(analyticsHref)}>
							Open Analytics
						</Button>
					</div>
				</Card>
			) : null}

			{!isSetup ? (
				<>
					<OperateStatusStrip
						website={website}
						lifecycle={lifecycle}
						health={health}
						systemHealth={systemHealth}
						pinterestConnected={pinterestConnected || Boolean(systemHealth.pinterest?.status === 'connected' || pinterest.connection?.status === 'connected')}
						lastScan={controlStats.lastScan || stats.lastScan || health.lastSuccessfulScan}
						score={score || systemHealth.score}
					/>

					<OperateQuickActions
						scanning={scanning}
						onScan={handleScan}
						onArticles={() => navigate(`/app/websites/${website.id}/articles`)}
						onGeneratePin={() => navigate(pinsHref)}
						onPublishingHistory={() => navigate(historyHref)}
					/>

					<OperateScanProgress
						scanning={scanning}
						scanMessages={scanMessages}
						scanSummary={scanSummary}
						formatStatValue={formatStatValue}
					/>

					<OperateActivityFeed
						items={activityItems}
						formatDateTime={formatDateTime}
						timelineTone={timelineTone}
						timelineTypeLabel={timelineTypeLabel}
					/>

					<div className="mb-4 grid gap-4 lg:grid-cols-2">
						<OperateContentProduction
							onWriter={() => navigate(writerHref)}
							onAiPins={() => navigate(pinsHref)}
							onImages={() => navigate(imagesHref)}
							onTemplates={() => navigate('/app/ai-pins/templates')}
							showTemplates={showTemplates}
						/>
						<OperatePublishingPipeline
							drafts={draftCount}
							scheduled={scheduledCount}
							published={publishedCount}
							failed={failedCount}
							onOpenHistory={() => navigate(historyHref)}
						/>
					</div>

					<OperateAnalyticsSnapshot
						publishedPins={publishedCount}
						successRate={performance.successRate ?? pinterestPerformance.successRate}
						lastPublishAt={performance.lastPublishAt || pinterestPerformance.lastPublishAt}
						lastPublishTitle={performance.lastPublishTitle}
						aiPinsGenerated={performance.totalAiPinsGenerated ?? aiGeneration.totalPins}
						onOpenAnalytics={() => navigate(analyticsHref)}
					/>

					{dashboard ? (
						<OperateAdvancedPanel>
							<div className="grid gap-4 lg:grid-cols-2">
								<Card>
									<SectionTitle>Website Score</SectionTitle>
									{score ? (
										<div className="mt-3 space-y-2">
											<div className="flex items-center gap-3">
												<p className="text-3xl font-semibold">{formatStatValue(score.score)}<span className="text-lg text-muted-foreground">/100</span></p>
												<Badge tone={score.tone || statusTone(score.label)}>{score.label || '—'}</Badge>
											</div>
											{(score.breakdown || []).length > 0 ? (
												<ul className="mt-3 space-y-1 text-sm text-muted-foreground">
													{score.breakdown.map((row) => (
														<li key={row.key}>• {row.key}: {formatStatValue(row.points)}/{formatStatValue(row.max)}</li>
													))}
												</ul>
											) : null}
										</div>
									) : (
										<EmptyLines text="Score unavailable." />
									)}
								</Card>

								{problems.length > 0 ? (
									<Card>
										<SectionTitle>Quick Problems</SectionTitle>
										<ul className="mt-3 space-y-2 text-sm">
											{problems.map((problem) => (
												<li key={problem.id || problem.code} className="flex items-start justify-between gap-2">
													<span>
														<span className="font-medium">{problem.label}</span>
														{problem.detail ? <span className="mt-1 block text-xs text-muted-foreground">{problem.detail}</span> : null}
													</span>
													<Badge tone={problem.tone || statusTone(problem.code)}>{problem.code || problem.label}</Badge>
												</li>
											))}
										</ul>
									</Card>
								) : (
									<Card>
										<SectionTitle>Credits Usage</SectionTitle>
										{creditsUsage ? (
											<div className="mt-3 space-y-2">
												<MetaLine label="Plan">{creditsUsage.plan || '—'}</MetaLine>
												<MetaLine label="AI credits">{creditsUsage.ai ? `${creditsUsage.ai.used}/${creditsUsage.ai.limit} (remaining ${creditsUsage.ai.remaining})` : '—'}</MetaLine>
												<MetaLine label="Image credits">{creditsUsage.image ? `${creditsUsage.image.used}/${creditsUsage.image.limit} (remaining ${creditsUsage.image.remaining})` : '—'}</MetaLine>
											</div>
										) : (
											<EmptyLines text="Credits data unavailable." />
										)}
									</Card>
								)}
							</div>

							<div className="grid gap-4 lg:grid-cols-2">
								<Card>
									<SectionTitle>WordPress Information</SectionTitle>
									{wordpress.site ? (
										<div className="mt-3 space-y-2">
											<MetaLine label="Site">{wordpress.site.name || '—'}</MetaLine>
											<MetaLine label="URL">{wordpress.site.url || '—'}</MetaLine>
											<MetaLine label="Status"><Badge tone={statusTone(wordpress.site.status)}>{wordpress.site.status || '—'}</Badge></MetaLine>
											<MetaLine label="Version">{wordpress.site.wpVersion || '—'}</MetaLine>
											<MetaLine label="Auth">{wordpress.site.authType || '—'}</MetaLine>
											<MetaLine label="Last tested">{formatDateTime(wordpress.site.lastTestedAt)}</MetaLine>
										</div>
									) : (
										<EmptyLines text="No linked WordPress site yet. Add credentials and use Test." />
									)}
								</Card>

								<Card>
									<SectionTitle>System Health</SectionTitle>
									<div className="mt-3 space-y-2">
										<MetaLine label="WordPress"><Badge tone={systemHealth.wordpress?.tone || health.wordpressConnection?.tone || statusTone(systemHealth.wordpress?.status || health.wordpressConnection?.status)}>{systemHealth.wordpress?.status || health.wordpressConnection?.status || '—'}</Badge></MetaLine>
										<MetaLine label="REST API"><Badge tone={systemHealth.restApi?.tone || health.restApi?.tone || statusTone(systemHealth.restApi?.status || health.restApi?.status)}>{systemHealth.restApi?.status || health.restApi?.status || '—'}</Badge></MetaLine>
										<MetaLine label="Pinterest"><Badge tone={systemHealth.pinterest?.tone || statusTone(systemHealth.pinterest?.status)}>{systemHealth.pinterest?.status || '—'}</Badge></MetaLine>
										<MetaLine label="AI provider"><Badge tone={systemHealth.aiProvider?.tone || statusTone(systemHealth.aiProvider?.status)}>{systemHealth.aiProvider?.status || '—'}</Badge></MetaLine>
										<MetaLine label="Queue"><Badge tone={systemHealth.queue?.tone || statusTone(systemHealth.queue?.status)}>{systemHealth.queue?.status || '—'}</Badge></MetaLine>
									</div>
								</Card>
							</div>

							<div className="grid gap-4 lg:grid-cols-2">
								<Card>
									<SectionTitle>Recent Errors</SectionTitle>
									{recentErrors.length > 0 ? (
										<ul className="mt-3 space-y-2 text-sm text-muted-foreground">
											{recentErrors.slice(0, 10).map((row) => (
												<li key={`${row.source}-${row.id}`}>
													• [{row.source}] {row.message}
													<span className="block text-xs">{formatDateTime(row.at)}</span>
												</li>
											))}
										</ul>
									) : (
										<EmptyLines text="No recent errors." />
									)}
								</Card>

								<Card>
									<SectionTitle>Queue & resources</SectionTitle>
									<div className="mt-3 space-y-2">
										<MetaLine label="Pending jobs">{formatStatValue(queue.pendingJobs)}</MetaLine>
										<MetaLine label="Failed jobs">{formatStatValue(queue.failedJobs)}</MetaLine>
										<MetaLine label="Discovered articles">{formatStatValue(websiteResources.discoveredArticles)}</MetaLine>
										<MetaLine label="AI pins">{formatStatValue(websiteResources.aiPins)}</MetaLine>
										<MetaLine label="Publish jobs">{formatStatValue(websiteResources.publishJobs)}</MetaLine>
									</div>
								</Card>
							</div>

							{problems.length > 0 && creditsUsage ? (
								<Card>
									<SectionTitle>Credits Usage</SectionTitle>
									<div className="mt-3 space-y-2">
										<MetaLine label="Plan">{creditsUsage.plan || '—'}</MetaLine>
										<MetaLine label="AI credits">{creditsUsage.ai ? `${creditsUsage.ai.used}/${creditsUsage.ai.limit} (remaining ${creditsUsage.ai.remaining})` : '—'}</MetaLine>
										<MetaLine label="Image credits">{creditsUsage.image ? `${creditsUsage.image.used}/${creditsUsage.image.limit} (remaining ${creditsUsage.image.remaining})` : '—'}</MetaLine>
									</div>
								</Card>
							) : null}

							<div className="flex flex-wrap gap-2">
								{quickActions.filter((action) => action.action === 'sync' || action.action === 'refresh' || action.action === 'publish_ready').map((action) => (
									<Button
										key={action.id}
										size="sm"
										variant="outline"
										disabled={(publishing && action.action === 'publish_ready')}
										onClick={() => runQuickAction(action)}
									>
										{action.action === 'publish_ready' && publishing ? 'Publishing...' : action.label}
									</Button>
								))}
							</div>
						</OperateAdvancedPanel>
					) : null}
				</>
			) : (
				<>
					<div className="grid gap-4 lg:grid-cols-4">
						{[
							{ label: 'Total Articles', value: formatStatValue(controlStats.totalArticles ?? stats.totalArticles) },
							{ label: 'New Articles', value: formatStatValue(controlStats.newArticles ?? stats.newArticles) },
							{ label: 'Last Scan', value: formatDateTime(controlStats.lastScan || stats.lastScan) },
							{ label: 'Next Scheduled Scan', value: formatDateTime(controlStats.nextScheduledScan || stats.nextScheduledScan) },
						].map((item) => (
							<Card key={item.label}>
								<p className="text-sm text-muted-foreground">{item.label}</p>
								<p className="mt-2 text-2xl font-semibold">{item.value}</p>
							</Card>
						))}
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-3">
						<Card className="lg:col-span-1">
							<div className="flex items-center gap-3">
								{website.favicon ? <img src={website.favicon} alt={`${website.name} favicon`} loading="lazy" decoding="async" className="h-12 w-12 rounded-xl border border-border object-cover" /> : <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><Globe size={22} /></span>}
								<div>
									<h2 className="font-semibold">{website.name}</h2>
									<p className="text-sm text-muted-foreground">{website.domain}</p>
								</div>
							</div>
							<div className="mt-4 space-y-2 text-sm">
								<p><span className="text-muted-foreground">Status:</span> <Badge tone={website.status === 'active' || website.status === 'connected' ? 'green' : 'default'}>{website.status}</Badge></p>
								<p><span className="text-muted-foreground">Discovery:</span> <Badge tone={website.discovery_status === 'ready' ? 'green' : website.discovery_status === 'running' ? 'blue' : website.discovery_status === 'failed' ? 'red' : 'amber'}>{website.discovery_status}</Badge></p>
								<p><span className="text-muted-foreground">Created:</span> {formatDateTime(website.created)}</p>
								<p><span className="text-muted-foreground">URL:</span> {website.url ? <a href={website.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open website</a> : '—'}</p>
							</div>
						</Card>

						<Card className="lg:col-span-2">
							<div className="flex items-center justify-between gap-2">
								<h3 className="font-semibold">Scan Progress</h3>
								{scanning && <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Running</span>}
							</div>
							<div className="mt-4 rounded-xl border border-border bg-secondary/30 p-4">
								{scanMessages.length > 0 ? (
									<ul className="space-y-2 text-sm text-muted-foreground">
										{scanMessages.map((message, index) => <li key={`${message}-${index}`}>• {message}</li>)}
									</ul>
								) : (
									<p className="text-sm text-muted-foreground">No scan is currently running.</p>
								)}
							</div>
							{scanSummary && (
								<div className="mt-4 grid gap-3 sm:grid-cols-4">
									<Card><p className="text-xs text-muted-foreground">Articles Found</p><p className="mt-2 text-xl font-semibold">{formatStatValue(scanSummary.found || 0)}</p></Card>
									<Card><p className="text-xs text-muted-foreground">New Articles</p><p className="mt-2 text-xl font-semibold">{formatStatValue(scanSummary.newArticles || 0)}</p></Card>
									<Card><p className="text-xs text-muted-foreground">Updated Articles</p><p className="mt-2 text-xl font-semibold">{formatStatValue(scanSummary.updatedArticles || 0)}</p></Card>
									<Card><p className="text-xs text-muted-foreground">Errors</p><p className="mt-2 text-xl font-semibold">{formatStatValue(scanSummary.errors?.length || 0)}</p></Card>
								</div>
							)}
						</Card>
					</div>
				</>
			)}

			{stats.totalArticles === 0 && !scanning && (
				<div className="mt-4">
					<Empty
						icon={RefreshCw}
						title="No articles discovered yet"
						subtitle="Scan this website to find articles. After the scan, review Articles and create AI Pins."
						action={<Button onClick={handleScan}><ScanSearch size={16} /> Scan Website</Button>}
					/>
				</div>
			)}
		</div>
	);
}

