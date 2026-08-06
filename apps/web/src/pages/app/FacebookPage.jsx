import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
	Facebook,
	Link2,
	Loader2,
	RefreshCw,
	Unplug,
	Star,
	RotateCcw,
	ListOrdered,
	CalendarClock,
	AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/kit';
import { usePersistWebsiteQuery } from '@/hooks/usePersistWebsiteQuery';
import { consumeSetupReturnPath } from '@/lib/websites/websiteLifecycle';
import { useToast } from '@/hooks/use-toast';
import { usePlatformIdentity } from '@/hooks/usePlatformIdentity';
import { FACEBOOK_CHANNEL_CAPABILITIES } from '@/lib/facebook/channelCapabilities.js';
import {
	cancelFacebookJob,
	publishNowFacebookJob,
	retryFacebookJob,
} from '@/services/ai-facebook';
import apiServerClient from '@/lib/apiServerClient';

async function readApiError(response) {
	try {
		const data = await response.json();
		return data?.message || `Request failed (${response.status})`;
	} catch {
		return `Request failed (${response.status})`;
	}
}

/**
 * Facebook Hub — OAuth connect, accounts, Pages sync, and publish queue (F2+).
 */
export default function FacebookPage() {
	const capabilities = FACEBOOK_CHANNEL_CAPABILITIES;
	const { toast } = useToast();
	const { platformName } = usePlatformIdentity();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const websiteId = String(searchParams.get('websiteId') || '').trim();
	const setupMode = searchParams.get('setup') === '1';
	usePersistWebsiteQuery(websiteId);

	const [tab, setTab] = useState('accounts');
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState('');
	const [summary, setSummary] = useState({ totalAccounts: 0, totalPages: 0, connectedAccounts: 0 });
	const [accounts, setAccounts] = useState([]);
	const [pages, setPages] = useState([]);
	const [selectedAccountId, setSelectedAccountId] = useState('');
	const [jobs, setJobs] = useState([]);
	const [selectedJobId, setSelectedJobId] = useState('');
	const [jobActionId, setJobActionId] = useState('');

	const hubTabs = useMemo(() => {
		const tabs = [
			{ id: 'accounts', label: 'Accounts' },
			{ id: 'pages', label: 'Pages' },
		];
		if (capabilities.queueImplemented) {
			tabs.push({ id: 'queue', label: 'Publishing Queue', icon: ListOrdered });
		}
		if (capabilities.schedule) {
			tabs.push({ id: 'scheduled', label: 'Scheduled', icon: CalendarClock });
		}
		if (capabilities.queueImplemented) {
			tabs.push({ id: 'failed', label: 'Failed Jobs', icon: AlertTriangle });
		}
		return tabs;
	}, [capabilities.queueImplemented, capabilities.schedule]);

	const queueJobs = useMemo(
		() => jobs.filter((job) => job.status === 'scheduled' || job.status === 'publishing'),
		[jobs],
	);
	const scheduledJobs = useMemo(
		() => jobs.filter((job) => job.status === 'scheduled'),
		[jobs],
	);
	const failedJobs = useMemo(
		() => jobs.filter((job) => job.status === 'failed'),
		[jobs],
	);
	const selectedJob = useMemo(
		() => jobs.find((job) => job.id === selectedJobId) || queueJobs[0] || scheduledJobs[0] || failedJobs[0] || null,
		[jobs, selectedJobId, queueJobs, scheduledJobs, failedJobs],
	);

	const returnToStudio = () => {
		const returnTo = consumeSetupReturnPath()
			|| (websiteId
				? `/app/ai-facebook-pages?websiteId=${encodeURIComponent(websiteId)}&setup=publish`
				: '/app/ai-facebook-pages');
		navigate(returnTo);
	};

	const loadAccounts = useCallback(async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch('/facebook/accounts', { method: 'GET' });
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			const items = Array.isArray(payload.items) ? payload.items : [];
			setAccounts(items);
			setSummary(payload.summary || {
				totalAccounts: items.length,
				totalPages: items.reduce((n, a) => n + (a.pageCount || 0), 0),
				connectedAccounts: items.filter((a) => a.status === 'connected').length,
			});
			if (!selectedAccountId && items[0]?.id) {
				setSelectedAccountId(items[0].id);
			}
		} catch (error) {
			toast({ variant: 'destructive', title: 'Failed to load Facebook accounts', description: error.message });
		} finally {
			setLoading(false);
		}
	}, [selectedAccountId, toast]);

	const loadPages = useCallback(async (accountId) => {
		if (!accountId) {
			setPages([]);
			return;
		}
		try {
			const response = await apiServerClient.fetch(
				`/facebook/pages?accountId=${encodeURIComponent(accountId)}`,
				{ method: 'GET' },
			);
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			setPages(Array.isArray(payload.items) ? payload.items : []);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Failed to load Pages', description: error.message });
			setPages([]);
		}
	}, [toast]);

	const loadJobs = useCallback(async () => {
		if (!capabilities.schedule && !capabilities.queueImplemented) {
			setJobs([]);
			return;
		}
		try {
			const response = await apiServerClient.fetch('/facebook/jobs?page=1&perPage=100', { method: 'GET' });
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			const items = Array.isArray(payload.items) ? payload.items : [];
			setJobs(items);
			setSelectedJobId((prev) => (items.some((item) => item.id === prev) ? prev : items[0]?.id || ''));
		} catch (error) {
			toast({ variant: 'destructive', title: 'Failed to load publish jobs', description: error.message });
			setJobs([]);
		}
	}, [capabilities.queueImplemented, capabilities.schedule, toast]);

	const runJobAction = async (action, jobId) => {
		const targetId = jobId || selectedJob?.id;
		if (!targetId) {
			toast({ variant: 'destructive', title: 'No job selected', description: 'Select a queue job first.' });
			return;
		}
		setJobActionId(`${action}-${targetId}`);
		try {
			if (action === 'publish') {
				await publishNowFacebookJob(targetId);
			} else if (action === 'retry') {
				await retryFacebookJob(targetId);
			} else {
				await cancelFacebookJob(targetId);
			}
			toast({
				title: action === 'publish' ? 'Publish queued' : action === 'retry' ? 'Retry queued' : 'Job cancelled',
				description: action === 'cancel'
					? 'The scheduled job was cancelled.'
					: 'The Facebook queue will process this job shortly.',
			});
			await loadJobs();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Action failed', description: error.message });
		} finally {
			setJobActionId('');
		}
	};

	useEffect(() => {
		loadAccounts();
	}, [loadAccounts]);

	useEffect(() => {
		loadJobs();
	}, [loadJobs]);

	useEffect(() => {
		if (tab === 'pages' && selectedAccountId) {
			loadPages(selectedAccountId);
		}
	}, [tab, selectedAccountId, loadPages]);

	useEffect(() => {
		const connected = searchParams.get('facebook_connected');
		const err = searchParams.get('facebook_error');
		const warning = searchParams.get('pages_sync_warning');
		if (!connected && !err && !warning) return;

		if (connected === '1') {
			toast({ title: 'Facebook connected', description: warning || 'Account linked successfully.' });
			loadAccounts();
		}
		if (err) {
			toast({ variant: 'destructive', title: 'Facebook connect failed', description: err });
		}

		const next = new URLSearchParams(searchParams);
		next.delete('facebook_connected');
		next.delete('facebook_error');
		next.delete('pages_sync_warning');
		next.delete('account_id');
		setSearchParams(next, { replace: true });
	}, [searchParams, setSearchParams, toast, loadAccounts]);

	const startOAuth = async ({ accountId = '', label = '' } = {}) => {
		setBusy('oauth');
		try {
			const path = accountId
				? `/facebook/accounts/${encodeURIComponent(accountId)}/reconnect`
				: '/facebook/oauth/start';
			const response = await apiServerClient.fetch(path, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					label,
					websiteId: websiteId || undefined,
				}),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			const payload = await response.json();
			if (!payload.authUrl) throw new Error('Missing authUrl');
			window.location.assign(payload.authUrl);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Connect failed', description: error.message });
			setBusy('');
		}
	};

	const syncPages = async (accountId) => {
		setBusy(`sync:${accountId}`);
		try {
			const response = await apiServerClient.fetch('/facebook/pages/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ accountId }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Pages synced' });
			await loadAccounts();
			if (selectedAccountId === accountId) await loadPages(accountId);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Sync failed', description: error.message });
		} finally {
			setBusy('');
		}
	};

	const refreshToken = async (accountId) => {
		setBusy(`refresh:${accountId}`);
		try {
			const response = await apiServerClient.fetch('/facebook/token/refresh', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ accountId }),
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Token refreshed' });
			await loadAccounts();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Refresh failed', description: error.message });
		} finally {
			setBusy('');
		}
	};

	const setDefaultAccount = async (accountId) => {
		setBusy(`default-account:${accountId}`);
		try {
			const response = await apiServerClient.fetch(`/facebook/accounts/${encodeURIComponent(accountId)}/default`, {
				method: 'POST',
			});
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Default account updated' });
			await loadAccounts();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Update failed', description: error.message });
		} finally {
			setBusy('');
		}
	};

	const setDefaultPage = async (accountId, pageRecordId) => {
		setBusy(`default-page:${pageRecordId}`);
		try {
			const response = await apiServerClient.fetch(
				`/facebook/accounts/${encodeURIComponent(accountId)}/pages/${encodeURIComponent(pageRecordId)}/default`,
				{ method: 'POST' },
			);
			if (!response.ok) throw new Error(await readApiError(response));
			toast({ title: 'Default Page updated' });
			await loadPages(accountId);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Update failed', description: error.message });
		} finally {
			setBusy('');
		}
	};

	const disconnect = async (accountId) => {
		if (!window.confirm('Disconnect this Facebook account and remove synced Pages?')) return;
		setBusy(`disconnect:${accountId}`);
		try {
			const response = await apiServerClient.fetch(`/facebook/accounts/${encodeURIComponent(accountId)}/disconnect`, {
				method: 'POST',
			});
			if (!response.ok && response.status !== 204) throw new Error(await readApiError(response));
			toast({ title: 'Facebook account disconnected' });
			if (selectedAccountId === accountId) setSelectedAccountId('');
			await loadAccounts();
			setPages([]);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Disconnect failed', description: error.message });
		} finally {
			setBusy('');
		}
	};

	const statusTone = (status) => {
		const value = String(status || '').toLowerCase();
		if (value === 'connected') return 'text-emerald-700';
		if (value === 'expired') return 'text-amber-700';
		if (value === 'error' || value === 'disconnected') return 'text-red-700';
		return 'text-muted-foreground';
	};

	const connectedCount = useMemo(
		() => accounts.filter((a) => a.status === 'connected').length,
		[accounts],
	);

	return (
		<div className="ai-pins-atelier">
			<div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{platformName} Studio</p>
					<h1 className="font-display text-3xl font-semibold tracking-tight">Facebook Hub</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						{setupMode
							? 'Connect Facebook to publish your first post. You will return to AI Facebook Pages after connecting.'
							: capabilities.schedule
								? 'Connect Facebook accounts, sync Pages, and manage scheduled publishing from AI Facebook Pages or this hub.'
								: 'Connect Facebook accounts, sync Pages, and manage defaults.'}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{capabilities.publishingHistory ? (
						<Link to={websiteId ? `/app/facebook-history?websiteId=${encodeURIComponent(websiteId)}` : '/app/facebook-history'}>
							<Button variant="outline" size="sm"><ListOrdered size={14} /> Publishing History</Button>
						</Link>
					) : null}
					<Link to={websiteId ? `/app/ai-facebook-pages?websiteId=${encodeURIComponent(websiteId)}` : '/app/ai-facebook-pages'}>
						<Button variant="outline" size="sm"><Facebook size={14} /> AI Facebook Pages</Button>
					</Link>
				</div>
			</div>

			{(setupMode || connectedCount === 0) && (
				<div className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p className="text-sm font-medium">Why connect Facebook?</p>
						<p className="text-xs text-muted-foreground">
							Publishing Facebook Posts requires a connected Facebook account and Facebook Page.
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button size="sm" disabled={Boolean(busy)} onClick={() => startOAuth()}>
							{busy === 'oauth' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
							Connect Facebook
						</Button>
						{setupMode ? (
							<Button size="sm" variant="outline" onClick={returnToStudio}>Back to studio</Button>
						) : null}
					</div>
				</div>
			)}

			<div className="mb-4 flex flex-wrap items-center gap-2">
				<Button size="sm" disabled={Boolean(busy)} onClick={() => startOAuth()}>
					<Link2 size={14} /> Connect Account
				</Button>
				{selectedAccountId ? (
					<Button
						size="sm"
						variant="outline"
						disabled={Boolean(busy)}
						onClick={() => syncPages(selectedAccountId)}
					>
						<RefreshCw size={14} /> Sync Pages
					</Button>
				) : null}
				<span className="text-xs text-muted-foreground">
					{summary.connectedAccounts || 0} connected · {summary.totalPages || 0} pages
				</span>
			</div>

			<div className="mb-4 flex gap-2 border-b border-border pb-2">
				{hubTabs.map((item) => (
					<button
						key={item.id}
						type="button"
						className={`text-sm px-3 py-1.5 rounded-md ${tab === item.id ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground'}`}
						onClick={() => setTab(item.id)}
					>
						{item.label}
					</button>
				))}
			</div>

			{loading ? (
				<p className="text-sm text-muted-foreground flex items-center gap-2">
					<Loader2 className="h-4 w-4 animate-spin" /> Loading…
				</p>
			) : tab === 'accounts' ? (
				accounts.length === 0 ? (
					<div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-8 text-center">
						<p className="text-sm font-medium">No Facebook accounts connected</p>
						<p className="mt-1 text-xs text-muted-foreground">Connect an account to sync Pages.</p>
					</div>
				) : (
					<div className="grid gap-3 md:grid-cols-2">
						{accounts.map((account) => (
							<article key={account.id} className="rounded-2xl border border-border bg-card p-4">
								<div className="flex items-start justify-between gap-2">
									<div>
										<p className="font-medium">{account.label || account.accountName || account.username}</p>
										<p className={`text-xs ${statusTone(account.status)}`}>
											{account.status || 'unknown'}
											{account.isDefault ? ' · default' : ''}
										</p>
										{account.statusError ? (
											<p className="mt-1 text-xs text-red-600">{account.statusError}</p>
										) : null}
										<p className="mt-1 text-xs text-muted-foreground">
											Pages · {account.pageCount || 0}
											{account.lastSyncAt ? ` · synced ${new Date(account.lastSyncAt).toLocaleString()}` : ''}
										</p>
										{account.tokenExpiresAt ? (
											<p className="text-xs text-muted-foreground">
												Token expires {new Date(account.tokenExpiresAt).toLocaleString()}
											</p>
										) : null}
									</div>
								</div>
								<div className="mt-3 flex flex-wrap gap-2">
									<Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => { setSelectedAccountId(account.id); setTab('pages'); }}>
										View Pages
									</Button>
									<Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => syncPages(account.id)}>
										<RefreshCw size={14} /> Sync
									</Button>
									<Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => refreshToken(account.id)}>
										<RotateCcw size={14} /> Refresh token
									</Button>
									{!account.isDefault ? (
										<Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => setDefaultAccount(account.id)}>
											<Star size={14} /> Default
										</Button>
									) : null}
									<Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => startOAuth({ accountId: account.id })}>
										Reconnect
									</Button>
									<Button size="sm" variant="destructive" disabled={Boolean(busy)} onClick={() => disconnect(account.id)}>
										<Unplug size={14} /> Disconnect
									</Button>
								</div>
							</article>
						))}
					</div>
				)
			) : tab === 'pages' ? (
				<div className="space-y-3">
					<label className="block text-sm">
						<span className="text-muted-foreground">Account</span>
						<select
							className="mt-1 w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm"
							value={selectedAccountId}
							onChange={(e) => setSelectedAccountId(e.target.value)}
						>
							<option value="">Select account</option>
							{accounts.map((account) => (
								<option key={account.id} value={account.id}>
									{account.label || account.accountName || account.username}
								</option>
							))}
						</select>
					</label>
					{!selectedAccountId ? (
						<p className="text-sm text-muted-foreground">Select an account to view Pages.</p>
					) : pages.length === 0 ? (
						<div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
							No Pages yet. Sync Pages from this account.
						</div>
					) : (
						<div className="grid gap-3 md:grid-cols-2">
							{pages.map((page) => (
								<article key={page.id} className="rounded-2xl border border-border bg-card p-4">
									<p className="font-medium">{page.name}</p>
									<p className="text-xs text-muted-foreground">
										{page.category || 'Page'}
										{page.isDefault ? ' · default' : ''}
										{page.connected === false ? ' · stale' : ''}
									</p>
									{!page.isDefault ? (
										<Button
											className="mt-3"
											size="sm"
											variant="outline"
											disabled={Boolean(busy)}
											onClick={() => setDefaultPage(selectedAccountId, page.id)}
										>
											<Star size={14} /> Set default Page
										</Button>
									) : null}
								</article>
							))}
						</div>
					)}
				</div>
			) : tab === 'queue' ? (
				<div className="space-y-3">
					{queueJobs.length === 0 ? (
						<div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
							No queue jobs yet. Publish or schedule posts from AI Facebook Pages.
						</div>
					) : (
						<div className="grid gap-3">
							{queueJobs.map((job) => (
								<article key={job.id} className="rounded-2xl border border-border bg-card p-4">
									<p className="font-medium">{job.title || job.message || 'Facebook Post'}</p>
									<p className="text-xs text-muted-foreground">
										{job.status} · {job.scheduledAt ? new Date(job.scheduledAt).toLocaleString() : '—'} · {job.pageName || 'Page'}
									</p>
									<div className="mt-3 flex flex-wrap gap-2">
										{capabilities.publishNow ? (
											<Button size="sm" variant="outline" disabled={job.status !== 'scheduled' || jobActionId.startsWith('publish')} onClick={() => runJobAction('publish', job.id)}>Publish now</Button>
										) : null}
										<Button size="sm" variant="ghost" disabled={job.status !== 'scheduled' || jobActionId.startsWith('cancel')} onClick={() => runJobAction('cancel', job.id)}>Cancel</Button>
									</div>
								</article>
							))}
						</div>
					)}
				</div>
			) : tab === 'scheduled' ? (
				<div className="space-y-3">
					{scheduledJobs.length === 0 ? (
						<div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
							No scheduled posts yet. Schedule from AI Facebook Pages.
						</div>
					) : (
						<div className="grid gap-3 md:grid-cols-2">
							{scheduledJobs.map((job) => (
								<article key={job.id} className="rounded-2xl border border-border bg-card p-4">
									<p className="font-medium">{job.title || job.message || 'Facebook Post'}</p>
									<p className="text-xs text-muted-foreground">
										{job.scheduledAt ? new Date(job.scheduledAt).toLocaleString() : '—'} · {job.pageName || 'Page'}
									</p>
									<div className="mt-3 flex flex-wrap gap-2">
										<Button size="sm" variant="ghost" onClick={() => runJobAction('cancel', job.id)}>Cancel</Button>
									</div>
								</article>
							))}
						</div>
					)}
				</div>
			) : tab === 'failed' ? (
				<div className="space-y-3">
					{failedJobs.length === 0 ? (
						<div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
							Failed publish jobs will appear here with retry support.
						</div>
					) : (
						<div className="grid gap-3 md:grid-cols-2">
							{failedJobs.map((job) => (
								<article key={job.id} className="rounded-2xl border border-border bg-card p-4">
									<p className="font-medium">{job.title || job.message || 'Facebook Post'}</p>
									<p className="text-xs text-red-600">{job.lastError || 'Publish failed'}</p>
									<Button className="mt-3" size="sm" variant="outline" disabled={jobActionId === `retry-${job.id}`} onClick={() => runJobAction('retry', job.id)}>
										{jobActionId === `retry-${job.id}` ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Retry
									</Button>
								</article>
							))}
						</div>
					)}
				</div>
			) : null}
		</div>
	);
}
