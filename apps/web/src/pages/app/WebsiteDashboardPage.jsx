import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Globe, Newspaper, RefreshCw, ScanSearch } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Card, Empty, PageHeader, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';

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
	const navigate = useNavigate();
	const { toast } = useToast();
	const [website, setWebsite] = useState(null);
	const [dashboard, setDashboard] = useState(null);
	const [loading, setLoading] = useState(true);
	const [scanning, setScanning] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [scanMessages, setScanMessages] = useState([]);
	const [scanSummary, setScanSummary] = useState(null);

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
				return;
			}

			setWebsite(data.website);
			setDashboard(data.dashboard || null);
			setScanSummary(data.website?.last_scan_summary || null);
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
			toast({
				title: 'Scan complete',
				description: typeof persisted === 'number'
					? `PocketBase now has ${persisted} articles for this website (${discovered} discovered).`
					: savedCount > 0
						? `Saved ${savedCount} articles (${discovered} discovered).`
						: `Scan finished. Discovered ${discovered} articles.`,
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
			toast({ title: 'Sync complete', description: 'WordPress site link and credentials were refreshed.' });
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
				description: `${jobCount} pin${jobCount === 1 ? '' : 's'} queued for Pinterest.`,
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
	const quickActions = dashboard?.quickActions || [
		{ id: 'scan', label: 'Scan Website', action: 'scan' },
		{ id: 'sync', label: 'Sync Articles', action: 'sync' },
		{ id: 'generate_pins', label: 'Generate AI Pins', href: `/app/ai-pins?websiteId=${website.id}`, action: 'generate_pins' },
		{ id: 'publish_ready', label: 'Publish Ready Pins', action: 'publish_ready' },
		{ id: 'refresh', label: 'Refresh Dashboard', action: 'refresh' },
		{ id: 'analytics', label: 'Open Analytics', href: '/app/analytics', action: 'analytics' },
	];

	return (
		<div>
			<PageHeader
				title={website.name}
				subtitle="Website dashboard, scanning progress, and article discovery overview."
				action={(
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={() => navigate('/app/websites')}><ArrowLeft size={16} /> Websites</Button>
						<Button variant="outline" onClick={() => navigate(`/app/websites/${website.id}/articles`)}><Newspaper size={16} /> Articles</Button>
						<Button onClick={handleScan} disabled={scanning}><ScanSearch size={16} /> {scanning ? 'Scanning...' : 'Scan Website'}</Button>
					</div>
				)}
			/>

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

			{dashboard && (
				<div className="mt-4 grid gap-4 lg:grid-cols-5">
					{[
						{ label: 'Ready Articles', value: formatStatValue(controlStats.readyArticles) },
						{ label: 'Published Pins', value: formatStatValue(controlStats.publishedPins) },
						{ label: 'Pending Jobs', value: formatStatValue(controlStats.pendingJobs) },
						{ label: 'Failed Jobs', value: formatStatValue(controlStats.failedJobs) },
						{ label: 'AI Pins', value: formatStatValue(aiGeneration.totalPins) },
					].map((item) => (
						<Card key={item.label}>
							<p className="text-sm text-muted-foreground">{item.label}</p>
							<p className="mt-2 text-2xl font-semibold">{item.value}</p>
						</Card>
					))}
				</div>
			)}

			<div className="mt-4">
				<Card>
					<SectionTitle>Quick Actions</SectionTitle>
					<div className="mt-3 flex flex-wrap gap-2">
						{quickActions.map((action) => (
							<Button
								key={action.id}
								size="sm"
								variant={action.action === 'scan' ? 'default' : 'outline'}
								disabled={
									(scanning && (action.action === 'scan' || action.action === 'sync'))
									|| (publishing && action.action === 'publish_ready')
								}
								onClick={() => runQuickAction(action)}
							>
								{action.action === 'publish_ready' && publishing ? 'Publishing...' : action.label}
							</Button>
						))}
					</div>
				</Card>
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

					{scanSummary?.errors?.length > 0 && (
						<div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
							<h4 className="font-medium text-amber-700 dark:text-amber-400">Scan notes</h4>
							<ul className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-400">
								{scanSummary.errors.map((error, index) => <li key={`${error}-${index}`}>• {error}</li>)}
							</ul>
						</div>
					)}
				</Card>
			</div>

			{dashboard && (
				<>
					<div className="mt-4 grid gap-4 lg:grid-cols-2">
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
						) : null}
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-2">
						<Card>
							<SectionTitle>Website Performance</SectionTitle>
							<div className="mt-3 space-y-2">
								<MetaLine label="AI pins generated">{formatStatValue(performance.totalAiPinsGenerated)}</MetaLine>
								<MetaLine label="Published pins">{formatStatValue(performance.totalPublishedPins)}</MetaLine>
								<MetaLine label="Success rate">{performance.successRate != null ? `${performance.successRate}%` : '—'}</MetaLine>
								<MetaLine label="Last publish">{formatDateTime(performance.lastPublishAt)}</MetaLine>
								<MetaLine label="Last publish title">{performance.lastPublishTitle || '—'}</MetaLine>
								<MetaLine label="Last generated">{formatDateTime(performance.lastGeneratedAt || performance.lastGeneratedImageAt)}</MetaLine>
								<MetaLine label="Last generated title">{performance.lastGeneratedTitle || '—'}</MetaLine>
							</div>
						</Card>

						<Card>
							<SectionTitle>Content Overview</SectionTitle>
							<div className="mt-3 space-y-2">
								<MetaLine label="Total articles">{formatStatValue(contentOverview.totalArticles)}</MetaLine>
								<MetaLine label="Ready for pins">{formatStatValue(contentOverview.readyForPins)}</MetaLine>
								<MetaLine label="Already published">{formatStatValue(contentOverview.alreadyPublished)}</MetaLine>
								<MetaLine label="Missing featured image">{formatStatValue(contentOverview.missingFeaturedImage)}</MetaLine>
								<MetaLine label="Missing SEO title">{formatStatValue(contentOverview.missingSeoTitle)}</MetaLine>
							</div>
						</Card>
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-2">
						<Card>
							<SectionTitle>System Health</SectionTitle>
							<div className="mt-3 space-y-2">
								{systemHealth.score ? (
									<MetaLine label="Score">
										<span className="inline-flex items-center gap-2">
											{formatStatValue(systemHealth.score.score)}/100
											<Badge tone={systemHealth.score.tone || statusTone(systemHealth.score.label)}>{systemHealth.score.label || '—'}</Badge>
										</span>
									</MetaLine>
								) : null}
								<MetaLine label="WordPress"><Badge tone={systemHealth.wordpress?.tone || health.wordpressConnection?.tone || statusTone(systemHealth.wordpress?.status || health.wordpressConnection?.status)}>{systemHealth.wordpress?.status || health.wordpressConnection?.status || '—'}</Badge></MetaLine>
								<MetaLine label="REST API"><Badge tone={systemHealth.restApi?.tone || health.restApi?.tone || statusTone(systemHealth.restApi?.status || health.restApi?.status)}>{systemHealth.restApi?.status || health.restApi?.status || '—'}</Badge></MetaLine>
								<MetaLine label="Pinterest"><Badge tone={systemHealth.pinterest?.tone || statusTone(systemHealth.pinterest?.status)}>{systemHealth.pinterest?.status || '—'}</Badge></MetaLine>
								<MetaLine label="AI provider"><Badge tone={systemHealth.aiProvider?.tone || statusTone(systemHealth.aiProvider?.status)}>{systemHealth.aiProvider?.status || '—'}</Badge></MetaLine>
								<MetaLine label="Queue"><Badge tone={systemHealth.queue?.tone || statusTone(systemHealth.queue?.status)}>{systemHealth.queue?.status || '—'}</Badge></MetaLine>
								<MetaLine label="Scheduler"><Badge tone={systemHealth.scheduler?.tone || statusTone(systemHealth.scheduler?.status)}>{systemHealth.scheduler?.status || '—'}</Badge></MetaLine>
							</div>
						</Card>

						<Card>
							<SectionTitle>Content Pipeline</SectionTitle>
							<div className="mt-3 space-y-2">
								<MetaLine label="Total articles">{formatStatValue(contentPipeline.totalArticles)}</MetaLine>
								<MetaLine label="Ready for pins">{formatStatValue(contentPipeline.readyForPins)}</MetaLine>
								<MetaLine label="Already published">{formatStatValue(contentPipeline.alreadyPublished)}</MetaLine>
								<MetaLine label="Missing featured image">{formatStatValue(contentPipeline.missingFeaturedImage)}</MetaLine>
								<MetaLine label="Missing SEO title">{formatStatValue(contentPipeline.missingSeoTitle)}</MetaLine>
							</div>
						</Card>
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-2">
						<Card>
							<SectionTitle>Pinterest Performance</SectionTitle>
							<div className="mt-3 space-y-2">
								<MetaLine label="Connection"><Badge tone={pinterestPerformance.connection?.tone || pinterest.connection?.tone || statusTone(pinterestPerformance.connection?.status || pinterest.connection?.status)}>{pinterestPerformance.connection?.status || pinterest.connection?.status || '—'}</Badge></MetaLine>
								<MetaLine label="AI pins generated">{formatStatValue(pinterestPerformance.totalAiPinsGenerated ?? performance.totalAiPinsGenerated)}</MetaLine>
								<MetaLine label="Published pins">{formatStatValue(pinterestPerformance.totalPublishedPins ?? pinterest.published)}</MetaLine>
								<MetaLine label="Pending">{formatStatValue(pinterestPerformance.pending ?? pinterest.pending)}</MetaLine>
								<MetaLine label="Failed">{formatStatValue(pinterestPerformance.failed ?? pinterest.failed)}</MetaLine>
								<MetaLine label="Success rate">{(pinterestPerformance.successRate ?? performance.successRate) != null ? `${pinterestPerformance.successRate ?? performance.successRate}%` : '—'}</MetaLine>
								<MetaLine label="Last publish">{formatDateTime(pinterestPerformance.lastPublishAt || performance.lastPublishAt)}</MetaLine>
							</div>
						</Card>

						<Card>
							<SectionTitle>AI Usage</SectionTitle>
							<div className="mt-3 space-y-2">
								<MetaLine label="AI pins">{formatStatValue(aiUsage.totalPins ?? aiGeneration.totalPins)}</MetaLine>
								<MetaLine label="Generation events">{formatStatValue(aiUsage.generationCount ?? aiGeneration.generationCount)}</MetaLine>
								{aiUsage.credits || creditsUsage ? (
									<>
										<MetaLine label="Plan">{(aiUsage.credits || creditsUsage)?.plan || '—'}</MetaLine>
										<MetaLine label="AI credits">{(aiUsage.credits || creditsUsage)?.ai ? `${(aiUsage.credits || creditsUsage).ai.used}/${(aiUsage.credits || creditsUsage).ai.limit} (remaining ${(aiUsage.credits || creditsUsage).ai.remaining})` : '—'}</MetaLine>
										<MetaLine label="Image credits">{(aiUsage.credits || creditsUsage)?.image ? `${(aiUsage.credits || creditsUsage).image.used}/${(aiUsage.credits || creditsUsage).image.limit} (remaining ${(aiUsage.credits || creditsUsage).image.remaining})` : '—'}</MetaLine>
									</>
								) : null}
							</div>
							{(aiUsage.lastOperations || lastAiOperations).length > 0 ? (
								<ul className="mt-3 space-y-2 text-sm text-muted-foreground">
									{(aiUsage.lastOperations || lastAiOperations).slice(0, 5).map((row) => (
										<li key={row.id}>• {row.title} — {row.eventType || row.status || '—'} ({formatDateTime(row.at)})</li>
									))}
								</ul>
							) : (
								<EmptyLines text="No recent AI operations." />
							)}
						</Card>
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-2">
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
							<SectionTitle>Upcoming Scheduled Posts</SectionTitle>
							{upcomingScheduled.length > 0 ? (
								<ul className="mt-3 space-y-2 text-sm text-muted-foreground">
									{upcomingScheduled.slice(0, 10).map((row) => (
										<li key={`${row.channel}-${row.id}`}>
											• [{row.channel}] {row.title || 'Untitled'} — {row.status || '—'} ({formatDateTime(row.at)})
										</li>
									))}
								</ul>
							) : (
								<EmptyLines text="No upcoming scheduled posts." />
							)}
						</Card>
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-2">
						<Card>
							<SectionTitle>Website Resources</SectionTitle>
							<div className="mt-3 space-y-2">
								<MetaLine label="Discovered articles">{formatStatValue(websiteResources.discoveredArticles)}</MetaLine>
								<MetaLine label="AI pins">{formatStatValue(websiteResources.aiPins)}</MetaLine>
								<MetaLine label="Generation history">{formatStatValue(websiteResources.generationHistory)}</MetaLine>
								<MetaLine label="Publish jobs">{formatStatValue(websiteResources.publishJobs)}</MetaLine>
								<MetaLine label="WordPress API logs">{formatStatValue(websiteResources.wordpressApiLogs)}</MetaLine>
							</div>
						</Card>

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
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-2">
						<Card>
							<SectionTitle>Overview</SectionTitle>
							<div className="mt-3 space-y-2">
								<MetaLine label="Website">{dashboard.overview?.name || website.name}</MetaLine>
								<MetaLine label="Domain">{dashboard.overview?.domain || website.domain || '—'}</MetaLine>
								<MetaLine label="Status"><Badge tone={statusTone(dashboard.overview?.status || website.status)}>{dashboard.overview?.status || website.status || '—'}</Badge></MetaLine>
								<MetaLine label="Discovery"><Badge tone={statusTone(dashboard.overview?.discoveryStatus || website.discovery_status)}>{dashboard.overview?.discoveryStatus || website.discovery_status || '—'}</Badge></MetaLine>
								<MetaLine label="Updated">{formatDateTime(dashboard.overview?.updated || website.updated)}</MetaLine>
							</div>
						</Card>

						<Card>
							<SectionTitle>Website Health</SectionTitle>
							<div className="mt-3 space-y-2">
								<MetaLine label="WordPress"><Badge tone={health.wordpressConnection?.tone || statusTone(health.wordpressConnection?.status)}>{health.wordpressConnection?.status || '—'}</Badge></MetaLine>
								<MetaLine label="REST API"><Badge tone={health.restApi?.tone || statusTone(health.restApi?.status)}>{health.restApi?.status || '—'}</Badge></MetaLine>
								<MetaLine label="Last successful scan">{formatDateTime(health.lastSuccessfulScan)}</MetaLine>
								<MetaLine label="Discovered articles">{formatStatValue(health.discoveredArticles)}</MetaLine>
								<MetaLine label="Last synchronization">{formatDateTime(health.lastSynchronization)}</MetaLine>
								{health.wordpressConnection?.detail ? <p className="text-xs text-muted-foreground">{health.wordpressConnection.detail}</p> : null}
								{health.restApi?.detail ? <p className="text-xs text-muted-foreground">{health.restApi.detail}</p> : null}
							</div>
						</Card>
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-2">
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
									{wordpress.analytics ? (
										<>
											<MetaLine label="Published">{formatStatValue(wordpress.analytics.published)}</MetaLine>
											<MetaLine label="Failed">{formatStatValue(wordpress.analytics.failed)}</MetaLine>
											<MetaLine label="Success rate">{wordpress.analytics.successRate != null ? `${wordpress.analytics.successRate}%` : '—'}</MetaLine>
										</>
									) : null}
								</div>
							) : (
								<EmptyLines text="No linked WordPress site yet. Add credentials and use Test." />
							)}
						</Card>

						<Card>
							<SectionTitle>Status Indicators</SectionTitle>
							<div className="mt-3 space-y-2">
								{[
									indicators.aiImageProvider,
									indicators.pinterestConnection,
									indicators.brandKitAssigned,
									indicators.publishingQueue,
									indicators.scheduler,
								].filter(Boolean).map((item) => (
									<div key={item.label} className="flex items-start justify-between gap-2 text-sm">
										<span className="text-muted-foreground">{item.label}</span>
										<span className="text-right">
											<Badge tone={item.tone || statusTone(item.status)}>{item.status || '—'}</Badge>
											{item.detail ? <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p> : null}
										</span>
									</div>
								))}
							</div>
						</Card>
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-2">
						<Card>
							<SectionTitle>AI Generation Statistics</SectionTitle>
							<div className="mt-3 space-y-2">
								<MetaLine label="AI pins">{formatStatValue(aiGeneration.totalPins)}</MetaLine>
								<MetaLine label="Generation events">{formatStatValue(aiGeneration.generationCount)}</MetaLine>
							</div>
							{(aiGeneration.recentPins || []).length > 0 ? (
								<ul className="mt-3 space-y-2 text-sm text-muted-foreground">
									{aiGeneration.recentPins.slice(0, 6).map((pin) => (
										<li key={pin.id}>• {pin.title || 'Untitled pin'} — {pin.status || '—'} ({formatDateTime(pin.created)})</li>
									))}
								</ul>
							) : (
								<EmptyLines text="No AI pins generated for this website yet." />
							)}
						</Card>

						<Card>
							<SectionTitle>Queue Status</SectionTitle>
							<div className="mt-3 space-y-2">
								<MetaLine label="Pending jobs">{formatStatValue(queue.pendingJobs)}</MetaLine>
								<MetaLine label="Failed jobs">{formatStatValue(queue.failedJobs)}</MetaLine>
								<MetaLine label="Queue"><Badge tone={queue.indicator?.tone || statusTone(queue.indicator?.status)}>{queue.indicator?.status || '—'}</Badge></MetaLine>
								{queue.wordpress ? (
									<>
										<MetaLine label="WP worker running">{String(Boolean(queue.wordpress.running ?? queue.wordpress.isRunning ?? queue.wordpress.active))}</MetaLine>
										<MetaLine label="WP queued">{formatStatValue(queue.wordpress.queued ?? queue.wordpress.pending ?? queue.wordpress.depth)}</MetaLine>
									</>
								) : null}
							</div>
						</Card>
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-2">
						<Card>
							<SectionTitle>Publishing History</SectionTitle>
							{publishingHistory.length > 0 ? (
								<ul className="mt-3 space-y-2 text-sm text-muted-foreground">
									{publishingHistory.slice(0, 10).map((row) => (
										<li key={`${row.channel}-${row.id}`}>
											• [{row.channel}] {row.title || 'Untitled'} — {row.status || '—'} ({formatDateTime(row.at)})
											{row.error ? <span className="block text-xs text-destructive">{row.error}</span> : null}
										</li>
									))}
								</ul>
							) : (
								<EmptyLines text="No publishing history for this website yet." />
							)}
						</Card>

						<Card>
							<SectionTitle>Recent Activity</SectionTitle>
							{recentActivity.length > 0 ? (
								<ul className="mt-3 space-y-2 text-sm text-muted-foreground">
									{recentActivity.map((item) => (
										<li key={item.id} className="flex items-start gap-2">
											<Badge tone={timelineTone(item)}>{timelineTypeLabel(item.type)}</Badge>
											<span>
												{item.title} — {item.status || '—'} ({formatDateTime(item.at)})
												{item.detail ? <span className="mt-1 block text-xs">{item.detail}</span> : null}
											</span>
										</li>
									))}
								</ul>
							) : (
								<EmptyLines />
							)}
						</Card>
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-2">
						<Card>
							<SectionTitle>Last AI Operations</SectionTitle>
							{lastAiOperations.length > 0 ? (
								<ul className="mt-3 space-y-2 text-sm text-muted-foreground">
									{lastAiOperations.slice(0, 10).map((row) => (
										<li key={row.id}>
											• {row.title} — {row.eventType || row.status || '—'} ({formatDateTime(row.at)})
										</li>
									))}
								</ul>
							) : (
								<EmptyLines text="No AI operations recorded for this website." />
							)}
						</Card>

						<Card>
							<SectionTitle>Website Activity Timeline</SectionTitle>
							{activityTimeline.length > 0 ? (
								<ul className="mt-3 space-y-2 text-sm text-muted-foreground">
									{activityTimeline.slice(0, 20).map((item) => (
										<li key={item.id} className="flex items-start gap-2">
											<Badge tone={timelineTone(item)}>{timelineTypeLabel(item.type)}</Badge>
											<span>
												{item.title} — {item.status || '—'} ({formatDateTime(item.at)})
												{item.detail ? <span className="mt-1 block text-xs">{item.detail}</span> : null}
											</span>
										</li>
									))}
								</ul>
							) : (
								<EmptyLines text="No scan, sync, generation, publish, or error events yet." />
							)}
						</Card>
					</div>
				</>
			)}

			{stats.totalArticles === 0 && !scanning && (
				<div className="mt-4">
					<Empty icon={RefreshCw} title="No discovered articles yet" subtitle="Run a scan to detect articles from sitemaps, RSS, robots.txt, or the internal crawler." action={<Button onClick={handleScan}><ScanSearch size={16} /> Scan Website</Button>} />
				</div>
			)}
		</div>
	);
}
