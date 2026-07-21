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

export default function WebsiteDashboardPage() {
	const { websiteId } = useParams();
	const navigate = useNavigate();
	const { toast } = useToast();
	const [website, setWebsite] = useState(null);
	const [loading, setLoading] = useState(true);
	const [scanning, setScanning] = useState(false);
	const [scanMessages, setScanMessages] = useState([]);
	const [scanSummary, setScanSummary] = useState(null);

	const loadWebsite = async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch(`/websites/${websiteId}`, { method: 'GET' });
			const data = await readJson(response);

			if (!response.ok) {
				throw new Error(data?.message || `Failed to load website (${response.status})`);
			}

			setWebsite(data);
			setScanSummary(data.last_scan_summary || null);
		} catch (error) {
			setWebsite(null);
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		loadWebsite();
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

			// Flush trailing UTF-8 + any final SSE frame left in the buffer.
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
			await loadWebsite();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Scan failed', description: error.message });
			await loadWebsite();
		} finally {
			setScanning(false);
		}
	};

	if (loading) {
		return <div className="flex justify-center py-16"><Spinner className="text-primary" /></div>;
	}

	if (!website) {
		return <Empty icon={Globe} title="Website not found" subtitle="This website could not be loaded." action={<Button onClick={() => navigate('/app/websites')}><ArrowLeft size={16} /> Back</Button>} />;
	}

	const stats = website.stats || { totalArticles: 0, newArticles: 0, lastScan: '', nextScheduledScan: '' };

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
					{ label: 'Total Articles', value: formatStatValue(stats.totalArticles) },
					{ label: 'New Articles', value: formatStatValue(stats.newArticles) },
					{ label: 'Last Scan', value: formatDateTime(stats.lastScan) },
					{ label: 'Next Scheduled Scan', value: formatDateTime(stats.nextScheduledScan) },
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

			{stats.totalArticles === 0 && !scanning && (
				<div className="mt-4">
					<Empty icon={RefreshCw} title="No discovered articles yet" subtitle="Run a scan to detect articles from sitemaps, RSS, robots.txt, or the internal crawler." action={<Button onClick={handleScan}><ScanSearch size={16} /> Scan Website</Button>} />
				</div>
			)}
		</div>
	);
}
