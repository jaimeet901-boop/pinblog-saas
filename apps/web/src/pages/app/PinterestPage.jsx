import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
	Link2, Loader2, Pin, RefreshCw, Unlink, Pencil, Star, Search,
	Download, LayoutGrid, ListOrdered, CalendarClock, BarChart3, AlertTriangle,
	Eye, Coins,
} from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Input, Select, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import './PinterestPage.css';

const TABS = [
	{ id: 'accounts', label: 'Accounts', icon: Pin },
	{ id: 'boards', label: 'Boards', icon: LayoutGrid },
	{ id: 'queue', label: 'Publishing Queue', icon: ListOrdered },
	{ id: 'scheduled', label: 'Scheduled', icon: CalendarClock },
	{ id: 'analytics', label: 'Analytics', icon: BarChart3 },
	{ id: 'failed', label: 'Failed Jobs', icon: AlertTriangle },
];

function parseErrorMessage(payload, fallback) {
	if (typeof payload === 'string' && payload.trim()) {
		return payload;
	}
	if (payload?.message && typeof payload.message === 'string') {
		return payload.message;
	}
	return fallback;
}

function statusTone(status) {
	if (status === 'connected' || status === 'syncing') return 'green';
	if (status === 'expired') return 'amber';
	return 'red';
}

function formatStatusLabel(status) {
	if (status === 'connected') return 'Connected';
	if (status === 'expired') return 'Expired';
	if (status === 'syncing') return 'Syncing';
	if (status === 'disconnected') return 'Disconnected';
	return status || 'Unknown';
}

function displayAccountStatus(account, processingAccountId) {
	if (processingAccountId === account.id) return 'syncing';
	if (account.status === 'connected') return 'connected';
	if (account.status === 'expired') return 'expired';
	if (account.status === 'disconnected' || account.status === 'error') return account.status === 'error' ? 'disconnected' : account.status;
	return account.status || 'disconnected';
}

export default function PinterestPage() {
	const { toast } = useToast();
	const navigate = useNavigate();
	const location = useLocation();
	const searchRef = useRef(null);

	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState('');
	const [connecting, setConnecting] = useState(false);
	const [processingAccountId, setProcessingAccountId] = useState('');
	const [editingLabelId, setEditingLabelId] = useState('');
	const [labelDraft, setLabelDraft] = useState('');
	const [accounts, setAccounts] = useState([]);
	const [summary, setSummary] = useState({ totalAccounts: 0, totalBoards: 0, totalPublishedPins: 0 });
	const [boardsByAccount, setBoardsByAccount] = useState({});
	const [jobs, setJobs] = useState([]);
	const [analytics, setAnalytics] = useState(null);
	const [selectedJobId, setSelectedJobId] = useState('');
	const [jobActionId, setJobActionId] = useState('');

	const [tab, setTab] = useState('accounts');
	const [searchQuery, setSearchQuery] = useState('');
	const [accountFilter, setAccountFilter] = useState('');
	const [boardFilter, setBoardFilter] = useState('');
	const [dateFilter, setDateFilter] = useState('');
	const [expandedLogId, setExpandedLogId] = useState('');

	const connectedCount = useMemo(
		() => accounts.filter((account) => account.status === 'connected').length,
		[accounts],
	);

	const allBoards = useMemo(() => {
		const rows = [];
		for (const account of accounts) {
			const boards = boardsByAccount[account.id] || [];
			for (const board of boards) {
				rows.push({
					...board,
					accountId: account.id,
					accountLabel: account.label || account.accountName || account.username || 'Account',
				});
			}
		}
		return rows;
	}, [accounts, boardsByAccount]);

	const lastSyncLabel = useMemo(() => {
		const stamps = accounts
			.map((account) => account.connectedAt || account.updated || account.updatedAt)
			.filter(Boolean)
			.map((value) => new Date(value).getTime())
			.filter((value) => !Number.isNaN(value));
		if (!stamps.length) return '—';
		return new Date(Math.max(...stamps)).toLocaleString();
	}, [accounts]);

	const dashboard = useMemo(() => {
		const scheduledPins = jobs.filter((job) => job.status === 'scheduled').length;
		const queueJobs = jobs.filter((job) => job.status === 'scheduled' || job.status === 'publishing').length;
		const failedJobs = jobs.filter((job) => job.status === 'failed').length;
		return {
			connectedAccounts: connectedCount,
			totalBoards: summary.totalBoards || allBoards.length,
			publishedPins: analytics?.summary?.published || summary.totalPublishedPins || 0,
			scheduledPins,
			queueJobs,
			failedJobs,
			lastSync: lastSyncLabel,
		};
	}, [connectedCount, summary, allBoards.length, lastSyncLabel, jobs, analytics]);

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

	const load = async () => {
		setLoading(true);
		try {
			const [accountsRes, jobsRes, analyticsRes] = await Promise.all([
				apiServerClient.fetch(`/pinterest/accounts${filter ? `?filter=${encodeURIComponent(filter)}` : ''}`, { method: 'GET' }),
				apiServerClient.fetch('/pinterest/jobs?page=1&perPage=100', { method: 'GET' }),
				apiServerClient.fetch('/pinterest/analytics', { method: 'GET' }),
			]);

			const accountsPayload = await accountsRes.json().catch(() => ({}));
			if (!accountsRes.ok) {
				throw new Error(parseErrorMessage(accountsPayload, `Failed to load Pinterest accounts (${accountsRes.status})`));
			}

			const accountItems = Array.isArray(accountsPayload.items) ? accountsPayload.items : [];
			setAccounts(accountItems);
			setSummary(accountsPayload.summary || { totalAccounts: 0, totalBoards: 0, totalPublishedPins: 0 });

			const jobsPayload = await jobsRes.json().catch(() => ({}));
			const jobItems = jobsRes.ok && Array.isArray(jobsPayload.items) ? jobsPayload.items : [];
			setJobs(jobItems);
			setSelectedJobId((prev) => (jobItems.some((item) => item.id === prev) ? prev : jobItems[0]?.id || ''));

			const analyticsPayload = await analyticsRes.json().catch(() => ({}));
			setAnalytics(analyticsRes.ok ? analyticsPayload : null);

			const connectedAccounts = accountItems.filter((account) => account.status === 'connected');
			const boardsEntries = await Promise.all(connectedAccounts.map(async (account) => {
				const boardsRes = await apiServerClient.fetch(`/pinterest/boards?accountId=${encodeURIComponent(account.id)}`, { method: 'GET' });
				const boardsPayload = await boardsRes.json().catch(() => []);
				if (!boardsRes.ok) {
					return [account.id, []];
				}
				return [account.id, Array.isArray(boardsPayload) ? boardsPayload : []];
			}));

			setBoardsByAccount(Object.fromEntries(boardsEntries));
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, [filter]);

	useEffect(() => {
		const searchParams = new URLSearchParams(location.search);
		const connectedParam = searchParams.get('pinterest_connected');
		const connectedAccountId = searchParams.get('account_id');
		const errorParam = searchParams.get('pinterest_error');

		if (!connectedParam && !errorParam) {
			return;
		}

		if (connectedParam === '1') {
			toast({
				title: 'Pinterest connected',
				description: connectedAccountId
					? `Account linked successfully.`
					: 'Your Pinterest account is now linked successfully.',
			});
			if (searchParams.get('boards_sync_warning') === '1') {
				toast({
					variant: 'destructive',
					title: 'Boards sync incomplete',
					description: 'Account connected, but boards could not be synced. Use Sync Boards.',
				});
			}
			load();
		}

		if (errorParam) {
			toast({ variant: 'destructive', title: 'Pinterest connection failed', description: decodeURIComponent(errorParam) });
		}

		navigate('/app/pinterest', { replace: true });
	}, [location.search]);

	const connectPinterest = async () => {
		setConnecting(true);
		try {
			const response = await apiServerClient.fetch('/pinterest/oauth/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: '' }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(parseErrorMessage(payload, `Failed to start Pinterest OAuth (${response.status})`));
			}
			if (!payload?.authUrl) {
				throw new Error('Pinterest OAuth URL is missing from server response');
			}
			window.location.assign(payload.authUrl);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
			setConnecting(false);
		}
	};

	const reconnectAccount = async (account) => {
		setProcessingAccountId(account.id);
		try {
			const response = await apiServerClient.fetch(`/pinterest/accounts/${account.id}/reconnect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: account.label || '' }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(parseErrorMessage(payload, `Failed to reconnect account (${response.status})`));
			}
			if (!payload?.authUrl) {
				throw new Error('Reconnect URL was not returned by server');
			}
			window.location.assign(payload.authUrl);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
			setProcessingAccountId('');
		}
	};

	const syncAccountBoards = async (account) => {
		setProcessingAccountId(account.id);
		try {
			const response = await apiServerClient.fetch('/pinterest/boards/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ accountId: account.id }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(parseErrorMessage(payload, `Failed to sync boards (${response.status})`));
			}
			setBoardsByAccount((prev) => ({
				...prev,
				[account.id]: Array.isArray(payload.items) ? payload.items : [],
			}));
			toast({ title: 'Boards synced', description: `Boards refreshed for ${account.label || account.username}` });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setProcessingAccountId('');
		}
	};

	const disconnectAccount = async (account) => {
		const label = account.label || account.username || 'this account';
		const confirmed = window.confirm(
			`Disconnect ${label}?\n\nScheduled and in-progress publish jobs for this account will be cancelled. OAuth credentials will be removed.`,
		);
		if (!confirmed) {
			return;
		}

		setProcessingAccountId(account.id);
		try {
			const response = await apiServerClient.fetch(`/pinterest/accounts/${account.id}/disconnect`, { method: 'POST' });
			if (!response.ok) {
				const payload = await response.json().catch(() => ({}));
				throw new Error(parseErrorMessage(payload, `Failed to disconnect account (${response.status})`));
			}
			toast({ title: 'Account disconnected', description: `${label} was disconnected.` });
			load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setProcessingAccountId('');
		}
	};

	const setDefaultAccount = async (account) => {
		setProcessingAccountId(account.id);
		try {
			const response = await apiServerClient.fetch(`/pinterest/accounts/${account.id}/default`, { method: 'POST' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(parseErrorMessage(payload, `Failed to set default account (${response.status})`));
			}
			toast({ title: 'Default account updated', description: `${account.label || account.username} is now the default.` });
			load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setProcessingAccountId('');
		}
	};

	const setDefaultBoard = async (account, board) => {
		setProcessingAccountId(account.id);
		try {
			const response = await apiServerClient.fetch(
				`/pinterest/accounts/${account.id}/boards/${board.id}/default`,
				{ method: 'POST' },
			);
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(parseErrorMessage(payload, `Failed to set default board (${response.status})`));
			}
			toast({ title: 'Default board updated', description: `${board.name} is now the default for this account.` });
			load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setProcessingAccountId('');
		}
	};

	const renameAccount = async (accountId) => {
		if (!labelDraft.trim()) {
			toast({ variant: 'destructive', title: 'Label required', description: 'Please enter a valid account label.' });
			return;
		}

		setProcessingAccountId(accountId);
		try {
			const response = await apiServerClient.fetch(`/pinterest/accounts/${accountId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: labelDraft.trim() }),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(parseErrorMessage(payload, `Failed to rename account (${response.status})`));
			}
			toast({ title: 'Account renamed', description: 'Custom label updated successfully.' });
			setEditingLabelId('');
			setLabelDraft('');
			load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setProcessingAccountId('');
		}
	};

	const syncAllConnected = async () => {
		const connected = accounts.filter((account) => account.status === 'connected');
		if (!connected.length) {
			toast({ variant: 'destructive', title: 'No connected accounts', description: 'Connect a Pinterest account first.' });
			return;
		}
		for (const account of connected) {
			await syncAccountBoards(account);
		}
	};

	const exportSnapshot = () => {
		const payload = {
			exportedAt: new Date().toISOString(),
			summary,
			accounts,
			boardsByAccount,
		};
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'pinterest-hub-export.json';
		anchor.click();
		URL.revokeObjectURL(url);
		toast({ title: 'Exported', description: 'Local Pinterest hub snapshot downloaded.' });
	};

	const filteredAccounts = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		return accounts.filter((account) => {
			if (accountFilter && account.id !== accountFilter) return false;
			if (dateFilter === 'today') {
				const stamp = account.connectedAt ? new Date(account.connectedAt) : null;
				if (!stamp) return false;
				const start = new Date();
				start.setHours(0, 0, 0, 0);
				if (stamp < start) return false;
			}
			if (dateFilter === 'week') {
				const stamp = account.connectedAt ? new Date(account.connectedAt).getTime() : 0;
				if (stamp < Date.now() - 7 * 24 * 60 * 60 * 1000) return false;
			}
			if (!query) return true;
			const haystack = [
				account.label,
				account.accountName,
				account.username,
				account.status,
			].join(' ').toLowerCase();
			return haystack.includes(query);
		});
	}, [accounts, searchQuery, accountFilter, dateFilter]);

	const filteredBoards = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		return allBoards.filter((board) => {
			if (accountFilter && board.accountId !== accountFilter) return false;
			if (boardFilter && board.id !== boardFilter) return false;
			if (!query) return true;
			return `${board.name} ${board.accountLabel} ${board.boardId || ''}`.toLowerCase().includes(query);
		});
	}, [allBoards, searchQuery, accountFilter, boardFilter]);

	const liveAnalytics = useMemo(() => {
		const summaryStats = analytics?.summary || {};
		return {
			publishedPins: summaryStats.published || summary.totalPublishedPins || 0,
			clicks: summaryStats.clicks ?? 0,
			saves: summaryStats.saves ?? 0,
			impressions: summaryStats.impressions ?? 0,
			bestBoard: summaryStats.bestBoard || filteredBoards[0]?.name || allBoards[0]?.name || '—',
			bestPin: summaryStats.bestPin || '—',
			activity: connectedCount > 0
				? `${summaryStats.scheduled || 0} scheduled · ${summaryStats.failed || 0} failed · live from Pinterest jobs`
				: 'Connect an account to unlock activity.',
		};
	}, [analytics, summary.totalPublishedPins, filteredBoards, allBoards, connectedCount]);

	useEffect(() => {
		const onKeyDown = (event) => {
			if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
				const tag = document.activeElement?.tagName?.toLowerCase();
				if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
				event.preventDefault();
				searchRef.current?.focus();
			}
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
				event.preventDefault();
				load();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [filter]);

	const viewBoardsForAccount = (accountId) => {
		setAccountFilter(accountId);
		setTab('boards');
	};

	const runJobAction = async (action, jobId) => {
		const targetId = jobId || selectedJob?.id;
		if (!targetId) {
			toast({ variant: 'destructive', title: 'No job selected', description: 'Select a queue job first.' });
			return;
		}
		setJobActionId(`${action}-${targetId}`);
		try {
			const path = action === 'publish'
				? `/pinterest/jobs/${targetId}/publish-now`
				: action === 'retry'
					? `/pinterest/jobs/${targetId}/retry`
					: `/pinterest/jobs/${targetId}/cancel`;
			const response = await apiServerClient.fetch(path, { method: 'POST' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(parseErrorMessage(payload, `${action} failed`));
			}
			toast({
				title: action === 'publish' ? 'Publish queued' : action === 'retry' ? 'Retry queued' : 'Job cancelled',
				description: action === 'cancel' ? 'The scheduled job was cancelled.' : 'The Pinterest queue will process this job shortly.',
			});
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Action failed', description: error.message });
		} finally {
			setJobActionId('');
		}
	};

	return (
		<div className="pin-hub">
			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Chef IA Studio</p>
					<h1 className="font-display text-3xl font-semibold tracking-tight">Pinterest Hub</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Connect accounts, sync boards, and manage your Pinterest publishing workspace in one atelier.
					</p>
				</div>
				<Link to="/app/pinterest-history">
					<Button variant="outline" size="sm"><ListOrdered size={14} /> Publishing History</Button>
				</Link>
			</div>

			<div className="pin-hub__actions">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm font-medium">Pinterest management</span>
					<span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground">
						{summary.totalAccounts} accounts
					</span>
					<span className="hidden text-[11px] text-muted-foreground sm:inline">/ search · Ctrl+R refresh</span>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button size="sm" onClick={connectPinterest} disabled={connecting || loading}>
						{connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 size={14} />}
						Connect Account
					</Button>
					<Button size="sm" variant="outline" onClick={syncAllConnected} disabled={loading || !connectedCount}>
						<RefreshCw size={14} /> Sync
					</Button>
					<Button size="sm" variant="outline" onClick={load} disabled={loading}>
						{loading ? <Spinner className="h-4 w-4" /> : <RefreshCw size={14} />}
						Refresh
					</Button>
					<Button size="sm" variant="ghost" onClick={exportSnapshot} disabled={loading}>
						<Download size={14} /> Export
					</Button>
					<div className="relative min-w-[10rem]">
						<Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
						<input
							ref={searchRef}
							className="w-full rounded-xl border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
							placeholder="Search…"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
						/>
					</div>
				</div>
			</div>

			<div className="pin-hub__stats">
				<div className="pin-stat">
					<p className="pin-stat__label">Connected Accounts</p>
					<p className="pin-stat__value">{dashboard.connectedAccounts}</p>
				</div>
				<div className="pin-stat">
					<p className="pin-stat__label">Total Boards</p>
					<p className="pin-stat__value">{dashboard.totalBoards}</p>
				</div>
				<div className="pin-stat">
					<p className="pin-stat__label">Published Pins</p>
					<p className="pin-stat__value">{dashboard.publishedPins}</p>
				</div>
				<div className="pin-stat">
					<p className="pin-stat__label">Scheduled Pins</p>
					<p className="pin-stat__value">{dashboard.scheduledPins}</p>
					<p className="pin-stat__hint">See Publishing History</p>
				</div>
				<div className="pin-stat">
					<p className="pin-stat__label">Queue Jobs</p>
					<p className="pin-stat__value">{dashboard.queueJobs}</p>
					<p className="pin-stat__hint">Scheduled + publishing</p>
				</div>
				<div className="pin-stat">
					<p className="pin-stat__label">Failed Jobs</p>
					<p className="pin-stat__value">{dashboard.failedJobs}</p>
					<p className="pin-stat__hint">Retry from hub or history</p>
				</div>
				<div className="pin-stat">
					<p className="pin-stat__label">Last Sync</p>
					<p className="pin-stat__value" style={{ fontSize: '0.95rem', lineHeight: 1.35 }}>{dashboard.lastSync}</p>
				</div>
			</div>

			<div className="pin-hub__connect">
				<div>
					<p className="font-display text-lg font-semibold">Connect Pinterest Account</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Link another profile for multi-account publishing. OAuth flow is unchanged.
					</p>
				</div>
				<Button size="lg" onClick={connectPinterest} disabled={connecting || loading}>
					{connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 size={16} />}
					Connect Pinterest Account
				</Button>
			</div>

			<div className="pin-hub__workspace">
				<div className="pin-tabs" role="tablist" aria-label="Pinterest hub tabs">
					{TABS.map((item) => {
						const Icon = item.icon;
						return (
							<button
								key={item.id}
								type="button"
								role="tab"
								aria-selected={tab === item.id}
								className={`pin-tab ${tab === item.id ? 'is-active' : ''}`}
								onClick={() => setTab(item.id)}
							>
								<span className="inline-flex items-center gap-1.5">
									<Icon size={13} />
									{item.label}
								</span>
							</button>
						);
					})}
				</div>

				<div className="pin-filters">
					<div className="relative">
						<label className="mb-1.5 block text-sm font-medium">Global search</label>
						<Search size={14} className="pointer-events-none absolute left-3 top-[2.55rem] text-muted-foreground" />
						<input
							className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
							placeholder="Search accounts or boards…"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
						/>
					</div>
					<Select label="Account" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
						<option value="">All accounts</option>
						{accounts.map((account) => (
							<option key={account.id} value={account.id}>
								{account.label || account.accountName || account.username || account.id}
							</option>
						))}
					</Select>
					<Select label="Board" value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)}>
						<option value="">All boards</option>
						{allBoards.map((board) => (
							<option key={board.id} value={board.id}>{board.name}</option>
						))}
					</Select>
					<Select label="Status" value={filter} onChange={(e) => setFilter(e.target.value)}>
						<option value="">All</option>
						<option value="connected">Connected</option>
						<option value="expired">Expired</option>
						<option value="active">Active</option>
						<option value="error">Error</option>
					</Select>
					<Select label="Date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
						<option value="">Any time</option>
						<option value="today">Today</option>
						<option value="week">This week</option>
					</Select>
				</div>

				<div className="pin-panel">
					{loading ? (
						<div className="grid gap-3 md:grid-cols-2">
							{[0, 1, 2, 3].map((i) => <div key={i} className="pin-skeleton" />)}
						</div>
					) : null}

					{!loading && tab === 'accounts' ? (
						filteredAccounts.length === 0 ? (
							<div className="pin-empty">
								<div className="pin-empty__icon"><Pin size={22} /></div>
								<p className="font-display text-xl font-semibold">No connected Pinterest accounts</p>
								<p className="mt-2 max-w-md text-sm text-muted-foreground">
									Connect your first Pinterest account to start publishing and syncing boards.
								</p>
								<Button className="mt-5" onClick={connectPinterest} disabled={connecting}>
									{connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 size={15} />}
									Connect Pinterest Account
								</Button>
							</div>
						) : (
							<div className="pin-account-grid">
								{filteredAccounts.map((account) => {
									const uiStatus = displayAccountStatus(account, processingAccountId);
									const boardsCount = (boardsByAccount[account.id] || []).length || account.boardCount || 0;
									return (
										<div key={account.id} className="pin-account">
											<div className="flex gap-3">
												<div className="pin-account__avatar">
													{account.profileImageUrl ? (
														<img src={account.profileImageUrl} alt={account.accountName || account.username} loading="lazy" decoding="async" />
													) : (
														<div className="flex h-full items-center justify-center text-muted-foreground"><Pin size={20} /></div>
													)}
												</div>
												<div className="min-w-0 flex-1">
													<div className="flex flex-wrap items-center gap-2">
														<p className="truncate font-semibold">
															{account.label || account.accountName || account.username || 'Pinterest account'}
														</p>
														<Badge tone={statusTone(uiStatus)}>{formatStatusLabel(uiStatus)}</Badge>
														{account.isDefault ? <Badge tone="blue">Default</Badge> : null}
													</div>
													<p className="truncate text-sm text-muted-foreground">
														{account.accountName || 'Unnamed account'} · @{account.username || 'unknown'}
													</p>
													<p className="mt-1 text-xs text-muted-foreground">
														Boards: {boardsCount} · Published: {account.publishedPins || 0}
													</p>
													<p className="text-xs text-muted-foreground">
														Last sync: {account.connectedAt ? new Date(account.connectedAt).toLocaleString() : '—'}
													</p>
													{account.statusError ? <p className="mt-1 text-xs text-red-600">{account.statusError}</p> : null}
												</div>
											</div>

											<div className="mt-3 flex flex-wrap gap-2">
												{!account.isDefault ? (
													<Button size="sm" variant="outline" disabled={processingAccountId === account.id} onClick={() => setDefaultAccount(account)}>
														<Star size={14} /> Set Default
													</Button>
												) : null}
												<Button size="sm" variant="outline" disabled={processingAccountId === account.id} onClick={() => reconnectAccount(account)}>
													<Link2 size={14} /> Reconnect
												</Button>
												<Button size="sm" variant="outline" disabled={processingAccountId === account.id} onClick={() => syncAccountBoards(account)}>
													{processingAccountId === account.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />}
													Sync Boards
												</Button>
												<Button size="sm" variant="outline" onClick={() => viewBoardsForAccount(account.id)}>
													<Eye size={14} /> View Boards
												</Button>
												<Button
													size="sm"
													variant="outline"
													disabled={processingAccountId === account.id}
													onClick={() => {
														setEditingLabelId(account.id);
														setLabelDraft(account.label || account.accountName || account.username || '');
													}}
												>
													<Pencil size={14} /> Rename
												</Button>
												<Button size="sm" variant="ghost" disabled={processingAccountId === account.id} onClick={() => disconnectAccount(account)}>
													<Unlink size={14} /> Disconnect
												</Button>
											</div>

											{editingLabelId === account.id ? (
												<div className="mt-3 flex flex-col gap-2 md:flex-row">
													<div className="flex-1">
														<Input label="Custom Label" value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} />
													</div>
													<div className="flex items-end gap-2">
														<Button size="sm" onClick={() => renameAccount(account.id)} disabled={processingAccountId === account.id}>Save Label</Button>
														<Button size="sm" variant="outline" onClick={() => setEditingLabelId('')}>Cancel</Button>
													</div>
												</div>
											) : null}

											<div className="mt-3">
												<p className="mb-2 text-xs font-medium text-muted-foreground">Boards preview</p>
												{(boardsByAccount[account.id] || []).length === 0 ? (
													<p className="text-xs text-muted-foreground">No boards loaded.</p>
												) : (
													<div className="grid gap-2 sm:grid-cols-2">
														{(boardsByAccount[account.id] || []).slice(0, 4).map((board) => (
															<div key={board.id} className="rounded-xl border border-border p-2">
																<div className="flex items-start justify-between gap-2">
																	<div className="min-w-0">
																		<p className="truncate text-sm font-medium">{board.name}</p>
																		<p className="truncate text-xs text-muted-foreground">{board.boardId}</p>
																	</div>
																	{board.isDefault ? (
																		<Badge tone="blue">Default</Badge>
																	) : (
																		<Button
																			size="sm"
																			variant="outline"
																			disabled={processingAccountId === account.id}
																			onClick={() => setDefaultBoard(account, board)}
																		>
																			<Star size={12} /> Default
																		</Button>
																	)}
																</div>
															</div>
														))}
													</div>
												)}
											</div>
										</div>
									);
								})}
							</div>
						)
					) : null}

					{!loading && tab === 'boards' ? (
						filteredBoards.length === 0 ? (
							<div className="pin-empty">
								<div className="pin-empty__icon"><LayoutGrid size={22} /></div>
								<p className="font-display text-xl font-semibold">No boards to show</p>
								<p className="mt-2 max-w-md text-sm text-muted-foreground">
									Connect an account and sync boards, or adjust your filters.
								</p>
							</div>
						) : (
							<div className="pin-board-grid">
								{filteredBoards.map((board) => {
									const account = accounts.find((item) => item.id === board.accountId);
									return (
										<div key={`${board.accountId}-${board.id}`} className="pin-board">
											<div className="pin-board__cover">
												{board.coverImageUrl || board.imageUrl ? (
													<img src={board.coverImageUrl || board.imageUrl} alt="" loading="lazy" decoding="async" />
												) : (
													<LayoutGrid size={22} />
												)}
											</div>
											<div className="pin-board__body">
												<div className="flex items-start justify-between gap-2">
													<p className="truncate text-sm font-semibold">{board.name}</p>
													{board.isDefault ? <Badge tone="blue">Default</Badge> : null}
												</div>
												<p className="mt-1 truncate text-xs text-muted-foreground">{board.accountLabel}</p>
												<p className="mt-2 text-xs text-muted-foreground">
													Pins: {board.pinCount ?? board.pinsCount ?? '—'} · Last published: —
												</p>
												{account && !board.isDefault ? (
													<Button
														size="sm"
														variant="outline"
														className="mt-2"
														disabled={processingAccountId === account.id}
														onClick={() => setDefaultBoard(account, board)}
													>
														<Star size={12} /> Set Default
													</Button>
												) : null}
											</div>
										</div>
									);
								})}
							</div>
						)
					) : null}

					{!loading && tab === 'queue' ? (
						<div className="space-y-3">
							<div className="pin-table-wrap">
								<table className="pin-table">
									<thead>
										<tr>
											<th>Preview</th>
											<th>Article</th>
											<th>Board</th>
											<th>Scheduled</th>
											<th>Status</th>
											<th>Attempts</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										{queueJobs.length === 0 ? (
											<tr>
												<td colSpan={7}>
													<div className="py-8 text-center text-sm text-muted-foreground">
														No queue jobs yet. Publish or schedule pins from AI Pins.
													</div>
												</td>
											</tr>
										) : (
											queueJobs.map((job) => (
												<tr key={job.id} className={selectedJobId === job.id ? 'bg-secondary/40' : ''} onClick={() => setSelectedJobId(job.id)}>
													<td>{job.pin?.imageUrl ? <img src={job.pin.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-secondary"><Pin size={14} /></span>}</td>
													<td className="max-w-[12rem] truncate">{job.pin?.title || 'Untitled pin'}</td>
													<td>{job.boardName || job.boardId || '—'}</td>
													<td>{job.scheduledAt ? new Date(job.scheduledAt).toLocaleString() : '—'}</td>
													<td><Badge tone={job.status === 'publishing' ? 'amber' : 'default'}>{job.status}</Badge></td>
													<td>{job.attemptCount || 0}/{job.maxAttempts || 3}</td>
													<td>
														<div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
															<Button size="sm" variant="outline" disabled={jobActionId.startsWith('publish')} onClick={() => runJobAction('publish', job.id)}>Publish Now</Button>
															<Button size="sm" variant="ghost" disabled={job.status !== 'scheduled' || jobActionId.startsWith('cancel')} onClick={() => runJobAction('cancel', job.id)}>Cancel</Button>
														</div>
													</td>
												</tr>
											))
										)}
									</tbody>
								</table>
							</div>
							<div className="flex flex-wrap gap-2">
								<Button size="sm" variant="outline" disabled={!selectedJob || jobActionId.startsWith('publish')} onClick={() => runJobAction('publish')}>Publish Now</Button>
								<Button size="sm" variant="outline" disabled={!selectedJob || selectedJob.status !== 'failed' || jobActionId.startsWith('retry')} onClick={() => runJobAction('retry')}>Retry</Button>
								<Button size="sm" variant="ghost" disabled={!selectedJob || selectedJob.status !== 'scheduled' || jobActionId.startsWith('cancel')} onClick={() => runJobAction('cancel')}>Cancel</Button>
								<Link to="/app/pinterest-history"><Button size="sm">Open Publishing History</Button></Link>
							</div>
						</div>
					) : null}

					{!loading && tab === 'scheduled' ? (
						<div className="pin-timeline">
							{scheduledJobs.length === 0 ? (
								<div className="pin-empty">
									<div className="pin-empty__icon"><CalendarClock size={22} /></div>
									<p className="font-display text-xl font-semibold">No scheduled pins</p>
									<p className="mt-2 max-w-md text-sm text-muted-foreground">Schedule pins from AI Pins. They appear here and in the Calendar.</p>
									<Link to="/app/calendar" className="mt-5"><Button size="sm">Open Calendar</Button></Link>
								</div>
							) : (
								<div className="space-y-2">
									{scheduledJobs.map((job) => (
										<div key={job.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2">
											<div className="min-w-0">
												<p className="truncate text-sm font-medium">{job.pin?.title || 'Scheduled pin'}</p>
												<p className="text-xs text-muted-foreground">{job.scheduledAt ? new Date(job.scheduledAt).toLocaleString() : '—'} · {job.boardName || 'Board'}</p>
											</div>
											<div className="flex gap-1">
												<Button size="sm" variant="outline" onClick={() => runJobAction('publish', job.id)}>Publish Now</Button>
												<Button size="sm" variant="ghost" onClick={() => runJobAction('cancel', job.id)}>Cancel</Button>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					) : null}

					{!loading && tab === 'analytics' ? (
						<div className="space-y-3">
							<div className="pin-analytics">
								<div className="pin-analytics__card"><p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Published Pins</p><p className="pin-analytics__value">{liveAnalytics.publishedPins}</p></div>
								<div className="pin-analytics__card"><p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Clicks</p><p className="pin-analytics__value">{liveAnalytics.clicks}</p></div>
								<div className="pin-analytics__card"><p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Saves</p><p className="pin-analytics__value">{liveAnalytics.saves}</p></div>
								<div className="pin-analytics__card"><p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Impressions</p><p className="pin-analytics__value">{liveAnalytics.impressions}</p></div>
								<div className="pin-analytics__card"><p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Best Board</p><p className="pin-analytics__value" style={{ fontSize: '1.15rem' }}>{liveAnalytics.bestBoard}</p></div>
								<div className="pin-analytics__card"><p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Best Pin</p><p className="pin-analytics__value" style={{ fontSize: '1.15rem' }}>{liveAnalytics.bestPin}</p></div>
							</div>
							<div className="pin-analytics__card">
								<p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground inline-flex items-center gap-1"><Coins size={12} /> Publishing Activity</p>
								<p className="mt-2 text-sm text-muted-foreground">{liveAnalytics.activity}</p>
							</div>
						</div>
					) : null}

					{!loading && tab === 'failed' ? (
						<div className="space-y-3">
							{failedJobs.length === 0 ? (
								<div className="pin-empty">
									<div className="pin-empty__icon"><AlertTriangle size={22} /></div>
									<p className="font-display text-xl font-semibold">No failed jobs</p>
									<p className="mt-2 max-w-md text-sm text-muted-foreground">Failed publish jobs will appear here with retry support.</p>
								</div>
							) : (
								failedJobs.map((job) => (
									<div key={job.id} className="rounded-xl border border-border/70 px-3 py-3">
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="truncate text-sm font-medium">{job.pin?.title || 'Failed pin'}</p>
												<p className="mt-1 text-xs text-destructive">{job.lastError || 'Publish failed'}</p>
											</div>
											<Button size="sm" variant="outline" onClick={() => runJobAction('retry', job.id)}>
												{jobActionId === `retry-${job.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />} Retry
											</Button>
										</div>
										{expandedLogId === job.id ? <div className="pin-log mt-3 text-left text-xs text-muted-foreground">Attempts {job.attemptCount}/{job.maxAttempts} · Board {job.boardName || job.boardId || '—'}</div> : null}
										<Button size="sm" variant="ghost" className="mt-2" onClick={() => setExpandedLogId(expandedLogId === job.id ? '' : job.id)}>Log Viewer</Button>
									</div>
								))
							)}
							<div className="flex justify-center"><Link to="/app/pinterest-history"><Button size="sm">Open Publishing History</Button></Link></div>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
