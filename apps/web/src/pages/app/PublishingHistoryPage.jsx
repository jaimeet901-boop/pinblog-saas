import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	RefreshCw, Search, Download, ExternalLink, Copy, Eye, XCircle,
	Send, Pin, History, Loader2,
} from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Select, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import './PublishingHistoryPage.css';

const QUICK_FILTERS = [
	{ id: 'all', label: 'All' },
	{ id: 'today', label: 'Today' },
	{ id: 'week', label: 'This Week' },
	{ id: 'scheduled', label: 'Scheduled' },
	{ id: 'failed', label: 'Failed' },
	{ id: 'published', label: 'Published' },
];

function startOfDay(date = new Date()) {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

function statusTone(status) {
	if (status === 'published') return 'green';
	if (status === 'failed') return 'red';
	if (status === 'scheduled' || status === 'queued' || status === 'publishing') return 'amber';
	return 'default';
}

function formatStatus(status) {
	if (!status) return 'Unknown';
	return String(status).charAt(0).toUpperCase() + String(status).slice(1);
}

function accountLabel(item) {
	return item.accountLabel || item.accountUsername || item.accountId || '—';
}

function boardLabel(item) {
	return item.boardName || item.boardId || '—';
}

function publishStamp(item) {
	return item.publishedAt || item.scheduledAt || item.updatedAt || item.createdAt || '';
}

function downloadBlob(filename, content, type) {
	const blob = new Blob([content], { type });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

function toCsv(rows) {
	const headers = [
		'id', 'title', 'status', 'account', 'board', 'websiteId',
		'scheduledAt', 'publishedAt', 'pinterestPinUrl', 'lastError',
	];
	const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
	const lines = [headers.join(',')];
	for (const item of rows) {
		lines.push([
			item.id,
			item.pin?.title || '',
			item.status,
			accountLabel(item),
			boardLabel(item),
			item.websiteId || '',
			item.scheduledAt || '',
			item.publishedAt || '',
			item.pinterestPinUrl || '',
			item.lastError || '',
		].map(escape).join(','));
	}
	return `${lines.join('\n')}\n`;
}

export default function PublishingHistoryPage() {
	const { toast } = useToast();
	const searchRef = useRef(null);

	const [loading, setLoading] = useState(true);
	const [retryingId, setRetryingId] = useState('');
	const [publishingNowId, setPublishingNowId] = useState('');
	const [cancellingId, setCancellingId] = useState('');
	const [bulkRetrying, setBulkRetrying] = useState(false);
	const [statusFilter, setStatusFilter] = useState('');
	const [items, setItems] = useState([]);
	const [selectedId, setSelectedId] = useState('');
	const [searchQuery, setSearchQuery] = useState('');
	const [dateFilter, setDateFilter] = useState('');
	const [accountFilter, setAccountFilter] = useState('');
	const [boardFilter, setBoardFilter] = useState('');
	const [websiteFilter, setWebsiteFilter] = useState('');
	const [quickFilter, setQuickFilter] = useState('all');
	const [exportFormat, setExportFormat] = useState('csv');

	const load = async () => {
		setLoading(true);
		try {
			const query = new URLSearchParams({ page: '1', perPage: '100' });
			if (statusFilter) {
				query.set('status', statusFilter);
			}
			const response = await apiServerClient.fetch(`/pinterest/history?${query.toString()}`, { method: 'GET' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to load publishing history (${response.status})`);
			}
			const next = Array.isArray(payload.items) ? payload.items : [];
			setItems(next);
			setSelectedId((prev) => (next.some((item) => item.id === prev) ? prev : next[0]?.id || ''));
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, [statusFilter]);

	const retryFailed = async (jobId) => {
		setRetryingId(jobId);
		try {
			const response = await apiServerClient.fetch(`/pinterest/jobs/${jobId}/retry`, { method: 'POST' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to retry job (${response.status})`);
			}
			toast({ title: 'Retry queued', description: 'Failed pin was moved back to publishing queue.' });
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Retry failed', description: error.message });
		} finally {
			setRetryingId('');
		}
	};

	const cancelScheduled = async (jobId) => {
		setCancellingId(jobId);
		try {
			const response = await apiServerClient.fetch(`/pinterest/jobs/${jobId}/cancel`, { method: 'POST' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to cancel schedule (${response.status})`);
			}
			toast({ title: 'Schedule cancelled', description: 'Scheduled pin was moved back to draft.' });
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Cancel failed', description: error.message });
		} finally {
			setCancellingId('');
		}
	};

	const publishNow = async (jobId) => {
		setPublishingNowId(jobId);
		try {
			const response = await apiServerClient.fetch(`/pinterest/jobs/${jobId}/publish-now`, { method: 'POST' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to publish now (${response.status})`);
			}
			toast({ title: 'Publish queued', description: 'Job was moved to the immediate publish queue.' });
			await load();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Publish now failed', description: error.message });
		} finally {
			setPublishingNowId('');
		}
	};

	const accountOptions = useMemo(() => {
		const map = new Map();
		for (const item of items) {
			const key = item.accountId || accountLabel(item);
			if (!key || key === '—') continue;
			map.set(key, accountLabel(item));
		}
		return [...map.entries()];
	}, [items]);

	const boardOptions = useMemo(() => {
		const map = new Map();
		for (const item of items) {
			const key = item.boardId || boardLabel(item);
			if (!key || key === '—') continue;
			map.set(key, boardLabel(item));
		}
		return [...map.entries()];
	}, [items]);

	const websiteOptions = useMemo(() => {
		const set = new Set();
		for (const item of items) {
			if (item.websiteId) set.add(item.websiteId);
		}
		return [...set];
	}, [items]);

	const filteredItems = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		const todayStart = startOfDay().getTime();
		const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

		return items.filter((item) => {
			if (accountFilter) {
				const key = item.accountId || accountLabel(item);
				if (key !== accountFilter) return false;
			}
			if (boardFilter) {
				const key = item.boardId || boardLabel(item);
				if (key !== boardFilter) return false;
			}
			if (websiteFilter && item.websiteId !== websiteFilter) return false;

			const stamp = publishStamp(item);
			const time = stamp ? new Date(stamp).getTime() : 0;

			if (quickFilter === 'today' && time < todayStart) return false;
			if (quickFilter === 'week' && time < weekStart) return false;
			if (quickFilter === 'scheduled' && item.status !== 'scheduled') return false;
			if (quickFilter === 'failed' && item.status !== 'failed') return false;
			if (quickFilter === 'published' && item.status !== 'published') return false;

			if (dateFilter === 'today' && time < todayStart) return false;
			if (dateFilter === 'week' && time < weekStart) return false;
			if (dateFilter === 'month') {
				const monthStart = new Date();
				monthStart.setDate(1);
				monthStart.setHours(0, 0, 0, 0);
				if (time < monthStart.getTime()) return false;
			}

			if (!query) return true;
			const haystack = [
				item.pin?.title,
				item.pin?.description,
				accountLabel(item),
				boardLabel(item),
				item.websiteId,
				item.status,
				item.pinterestPinUrl,
				item.lastError,
			].join(' ').toLowerCase();
			return haystack.includes(query);
		});
	}, [items, searchQuery, accountFilter, boardFilter, websiteFilter, quickFilter, dateFilter]);

	const selected = useMemo(
		() => filteredItems.find((item) => item.id === selectedId) || items.find((item) => item.id === selectedId) || null,
		[filteredItems, items, selectedId],
	);

	const stats = useMemo(() => {
		const todayStart = startOfDay().getTime();
		const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
		let publishedToday = 0;
		let publishedWeek = 0;
		let scheduled = 0;
		let failed = 0;
		let queued = 0;
		let published = 0;
		const durations = [];

		for (const item of items) {
			if (item.status === 'scheduled') scheduled += 1;
			if (item.status === 'failed') failed += 1;
			if (item.status === 'queued' || item.status === 'publishing') queued += 1;
			if (item.status === 'published') {
				published += 1;
				const stamp = item.publishedAt ? new Date(item.publishedAt).getTime() : 0;
				if (stamp >= todayStart) publishedToday += 1;
				if (stamp >= weekStart) publishedWeek += 1;
				if (item.createdAt && item.publishedAt) {
					const ms = new Date(item.publishedAt).getTime() - new Date(item.createdAt).getTime();
					if (ms > 0 && ms < 1000 * 60 * 60 * 24 * 14) durations.push(ms);
				}
			}
		}

		const decided = published + failed;
		const successRate = decided ? Math.round((published / decided) * 100) : null;
		const avgMs = durations.length
			? durations.reduce((sum, value) => sum + value, 0) / durations.length
			: null;
		const avgLabel = avgMs == null
			? '—'
			: avgMs < 60_000
				? `${Math.round(avgMs / 1000)}s`
				: `${Math.round(avgMs / 60_000)}m`;

		return {
			publishedToday,
			publishedWeek,
			scheduled,
			failed,
			queued,
			successRate,
			avgLabel,
		};
	}, [items]);

	const retryAllFailed = async () => {
		const failed = filteredItems.filter((item) => item.status === 'failed');
		if (!failed.length) {
			toast({ variant: 'destructive', title: 'Nothing to retry', description: 'No failed jobs in the current view.' });
			return;
		}
		setBulkRetrying(true);
		try {
			for (const item of failed) {
				await retryFailed(item.id);
			}
		} finally {
			setBulkRetrying(false);
		}
	};

	const exportCurrent = () => {
		if (!filteredItems.length) {
			toast({ variant: 'destructive', title: 'Nothing to export', description: 'No rows match the current filters.' });
			return;
		}
		if (exportFormat === 'json') {
			downloadBlob('publishing-history.json', JSON.stringify(filteredItems, null, 2), 'application/json');
		} else {
			downloadBlob('publishing-history.csv', toCsv(filteredItems), 'text/csv;charset=utf-8');
		}
		toast({ title: 'Exported', description: `${filteredItems.length} rows downloaded as ${exportFormat.toUpperCase()}.` });
	};

	const copyLink = async (item) => {
		const url = item?.pinterestPinUrl;
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
			toast({ title: 'Link copied' });
		} catch {
			toast({ variant: 'destructive', title: 'Copy failed', description: 'Clipboard access was blocked.' });
		}
	};

	const unavailable = (label) => {
		toast({
			title: `${label} unavailable`,
			description: 'This action is not available for the selected job with the current publishing APIs.',
		});
	};

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
	}, [statusFilter]);

	const applyQuick = (id) => {
		setQuickFilter(id);
		if (id === 'scheduled' || id === 'failed' || id === 'published') {
			setStatusFilter(id);
		} else if (id === 'all' || id === 'today' || id === 'week') {
			setStatusFilter('');
		}
		if (id === 'today' || id === 'week') {
			setDateFilter(id);
		} else if (id === 'all' || id === 'scheduled' || id === 'failed' || id === 'published') {
			setDateFilter('');
		}
	};

	const renderRowActions = (item, compact = false) => {
		const canRetry = item.status === 'failed';
		const canCancel = item.status === 'scheduled';
		const canPublishNow = item.status === 'scheduled' || item.status === 'failed';
		const canCopy = Boolean(item.pinterestPinUrl);
		const canOpenPin = Boolean(item.pinterestPinUrl);
		const canOpenArticle = Boolean(item.pin?.destinationUrl || item.destinationUrl);
		const articleUrl = item.pin?.destinationUrl || item.destinationUrl || '';

		return (
			<div className="pub-row-actions" onClick={(e) => e.stopPropagation()}>
				<Button size="sm" variant="ghost" onClick={() => setSelectedId(item.id)}>
					<Eye size={13} /> {!compact ? 'View' : null}
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={!canRetry || retryingId === item.id || bulkRetrying}
					onClick={() => (canRetry ? retryFailed(item.id) : unavailable('Retry'))}
				>
					{retryingId === item.id ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw size={13} />}
					{!compact ? 'Retry' : null}
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={!canPublishNow || publishingNowId === item.id}
					onClick={() => (canPublishNow ? publishNow(item.id) : unavailable('Publish Now'))}
				>
					{publishingNowId === item.id ? <Spinner className="h-3.5 w-3.5" /> : <Send size={13} />}
					{!compact ? 'Publish Now' : null}
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={!canCancel || cancellingId === item.id}
					onClick={() => (canCancel ? cancelScheduled(item.id) : unavailable('Cancel'))}
				>
					{cancellingId === item.id ? <Spinner className="h-3.5 w-3.5" /> : <XCircle size={13} />}
					{!compact ? 'Cancel' : null}
				</Button>
				<Button size="sm" variant="ghost" disabled={!canCopy} onClick={() => copyLink(item)}>
					<Copy size={13} /> {!compact ? 'Copy' : null}
				</Button>
				{canOpenArticle ? (
					<a href={articleUrl} target="_blank" rel="noreferrer">
						<Button size="sm" variant="ghost"><ExternalLink size={13} /> {!compact ? 'Article' : null}</Button>
					</a>
				) : (
					<Button size="sm" variant="ghost" disabled><ExternalLink size={13} /> {!compact ? 'Article' : null}</Button>
				)}
				{canOpenPin ? (
					<a href={item.pinterestPinUrl} target="_blank" rel="noreferrer">
						<Button size="sm" variant="ghost"><Pin size={13} /> {!compact ? 'Pin' : null}</Button>
					</a>
				) : (
					<Button size="sm" variant="ghost" disabled><Pin size={13} /> {!compact ? 'Pin' : null}</Button>
				)}
			</div>
		);
	};

	return (
		<div className="pub-center">
			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Chef IA Studio</p>
					<h1 className="font-display text-3xl font-semibold tracking-tight">Publishing Center</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Track published, scheduled, and failed pins — retry or cancel without leaving the atelier.
					</p>
				</div>
				<Link to="/app/pinterest"><Button variant="outline" size="sm"><Pin size={14} /> Pinterest Hub</Button></Link>
			</div>

			<div className="pub-center__actions">
				<div className="flex flex-wrap items-end gap-2">
					<Button size="sm" variant="outline" onClick={load} disabled={loading}>
						{loading ? <Spinner className="h-4 w-4" /> : <RefreshCw size={14} />}
						Refresh
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={retryAllFailed}
						disabled={bulkRetrying || loading || !filteredItems.some((item) => item.status === 'failed')}
					>
						{bulkRetrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />}
						Retry Failed
					</Button>
					<div className="flex items-end gap-2">
						<Select label="Export" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
							<option value="csv">CSV</option>
							<option value="json">JSON</option>
						</Select>
						<Button size="sm" variant="ghost" onClick={exportCurrent} disabled={!filteredItems.length}>
							<Download size={14} /> Export
						</Button>
					</div>
				</div>
				<div className="flex flex-wrap items-end gap-2">
					<div className="relative min-w-[11rem]">
						<label className="mb-1.5 block text-sm font-medium">Search</label>
						<Search size={14} className="pointer-events-none absolute left-3 top-[2.55rem] text-muted-foreground" />
						<input
							ref={searchRef}
							className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
							placeholder="Search history…"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
						/>
					</div>
					<Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
						<option value="">All statuses</option>
						<option value="published">Published</option>
						<option value="failed">Failed</option>
						<option value="scheduled">Scheduled</option>
					</Select>
					<Select label="Date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
						<option value="">Any time</option>
						<option value="today">Today</option>
						<option value="week">This week</option>
						<option value="month">This month</option>
					</Select>
					<Select label="Account" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
						<option value="">All accounts</option>
						{accountOptions.map(([value, label]) => (
							<option key={value} value={value}>{label}</option>
						))}
					</Select>
					<Select label="Board" value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)}>
						<option value="">All boards</option>
						{boardOptions.map(([value, label]) => (
							<option key={value} value={value}>{label}</option>
						))}
					</Select>
					<Select label="Website" value={websiteFilter} onChange={(e) => setWebsiteFilter(e.target.value)}>
						<option value="">All websites</option>
						{websiteOptions.map((id) => (
							<option key={id} value={id}>{id}</option>
						))}
					</Select>
				</div>
			</div>

			<div className="pub-center__stats">
				<div className="pub-stat">
					<p className="pub-stat__label">Published Today</p>
					<p className="pub-stat__value">{stats.publishedToday}</p>
				</div>
				<div className="pub-stat">
					<p className="pub-stat__label">Published This Week</p>
					<p className="pub-stat__value">{stats.publishedWeek}</p>
				</div>
				<div className="pub-stat">
					<p className="pub-stat__label">Scheduled Pins</p>
					<p className="pub-stat__value">{stats.scheduled}</p>
				</div>
				<div className="pub-stat">
					<p className="pub-stat__label">Failed Jobs</p>
					<p className="pub-stat__value">{stats.failed}</p>
				</div>
				<div className="pub-stat">
					<p className="pub-stat__label">Queue Jobs</p>
					<p className="pub-stat__value">{stats.queued}</p>
					<p className="pub-stat__hint">{stats.queued ? 'In progress' : 'None queued'}</p>
				</div>
				<div className="pub-stat">
					<p className="pub-stat__label">Success Rate</p>
					<p className="pub-stat__value">{stats.successRate == null ? '—' : `${stats.successRate}%`}</p>
				</div>
				<div className="pub-stat">
					<p className="pub-stat__label">Avg. Publish Time</p>
					<p className="pub-stat__value">{stats.avgLabel}</p>
					{stats.avgLabel === '—' ? <p className="pub-stat__hint">Needs publish timestamps</p> : null}
				</div>
			</div>

			<div className="pub-center__shell">
				<section className="pub-center__table">
					<div className="pub-quick">
						{QUICK_FILTERS.map((filter) => (
							<button
								key={filter.id}
								type="button"
								className={`pub-chip ${quickFilter === filter.id ? 'is-active' : ''}`}
								onClick={() => applyQuick(filter.id)}
							>
								{filter.label}
							</button>
						))}
						<span className="ml-auto self-center text-[11px] text-muted-foreground">
							{filteredItems.length} of {items.length} jobs · / search · Ctrl+R
						</span>
					</div>

					{loading ? (
						<div className="px-4 pb-4 pt-2">
							{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="pub-skeleton-row" />)}
						</div>
					) : null}

					{!loading && filteredItems.length === 0 ? (
						<div className="pub-empty">
							<div className="pub-empty__art" aria-hidden="true" />
							<div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
								<History size={20} />
							</div>
							<p className="font-display text-xl font-semibold">No publishing records yet</p>
							<p className="mt-2 max-w-md text-sm text-muted-foreground">
								Publish or schedule pins from AI Pins to populate this center. History, retries, and cancels will appear here.
							</p>
							<Link to="/app/ai-pins" className="mt-5"><Button size="sm"><Pin size={14} /> Go to AI Pins</Button></Link>
						</div>
					) : null}

					{!loading && filteredItems.length > 0 ? (
						<>
							<div className="pub-table-wrap">
								<table className="pub-table">
									<thead>
										<tr>
											<th>Preview</th>
											<th>Article</th>
											<th>Account</th>
											<th>Board</th>
											<th>Website</th>
											<th>Publish Date</th>
											<th>Status</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										{filteredItems.map((item) => (
											<tr
												key={item.id}
												className={selectedId === item.id ? 'is-selected' : ''}
												onClick={() => setSelectedId(item.id)}
											>
												<td>
													{item.pin?.imageUrl ? (
														<img className="pub-thumb" src={item.pin.imageUrl} alt="" loading="lazy" decoding="async" />
													) : (
														<span className="pub-thumb-fallback"><Pin size={14} /></span>
													)}
												</td>
												<td>
													<p className="max-w-[12rem] truncate font-medium">{item.pin?.title || 'Untitled pin'}</p>
												</td>
												<td><span className="max-w-[8rem] truncate block">{accountLabel(item)}</span></td>
												<td><span className="max-w-[8rem] truncate block">{boardLabel(item)}</span></td>
												<td><span className="max-w-[7rem] truncate block">{item.websiteId || '—'}</span></td>
												<td className="whitespace-nowrap text-muted-foreground">
													{publishStamp(item) ? new Date(publishStamp(item)).toLocaleString() : '—'}
												</td>
												<td><Badge tone={statusTone(item.status)}>{formatStatus(item.status)}</Badge></td>
												<td>{renderRowActions(item, true)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>

							<div className="pub-card-list">
								{filteredItems.map((item) => (
									<button
										key={item.id}
										type="button"
										className={`pub-card ${selectedId === item.id ? 'is-selected' : ''}`}
										onClick={() => setSelectedId(item.id)}
									>
										<div className="flex gap-3">
											{item.pin?.imageUrl ? (
												<img className="pub-thumb" src={item.pin.imageUrl} alt="" loading="lazy" decoding="async" />
											) : (
												<span className="pub-thumb-fallback"><Pin size={14} /></span>
											)}
											<div className="min-w-0 flex-1 text-left">
												<p className="truncate text-sm font-semibold">{item.pin?.title || 'Untitled pin'}</p>
												<p className="mt-0.5 truncate text-xs text-muted-foreground">{boardLabel(item)} · {accountLabel(item)}</p>
												<div className="mt-2"><Badge tone={statusTone(item.status)}>{formatStatus(item.status)}</Badge></div>
											</div>
										</div>
										<div className="mt-3">{renderRowActions(item)}</div>
									</button>
								))}
							</div>
						</>
					) : null}
				</section>

				<aside className="pub-center__inspector p-4 space-y-3">
					<div>
						<h2 className="font-display text-lg font-semibold">Details Inspector</h2>
						<p className="text-[11px] text-muted-foreground">Select a job to inspect publish details.</p>
					</div>

					{!selected ? (
						<div className="rounded-2xl border border-dashed border-border bg-background/50 px-4 py-12 text-center">
							<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
								<History size={22} />
							</div>
							<p className="font-medium">No job selected</p>
							<p className="mt-1 text-xs text-muted-foreground">Choose a row to view preview, logs, and actions.</p>
						</div>
					) : (
						<>
							<div className="pub-preview">
								{selected.pin?.imageUrl ? (
									<img src={selected.pin.imageUrl} alt={selected.pin?.title || 'Pin preview'} loading="lazy" decoding="async" />
								) : (
									<div className="pub-preview__empty"><Pin size={28} /></div>
								)}
							</div>

							<div>
								<p className="font-display text-lg font-semibold leading-snug">{selected.pin?.title || 'Untitled pin'}</p>
								<div className="mt-2"><Badge tone={statusTone(selected.status)}>{formatStatus(selected.status)}</Badge></div>
							</div>

							<div className="pub-meta">
								<div className="pub-meta__row"><span>Website</span><span>{selected.websiteId || '—'}</span></div>
								<div className="pub-meta__row"><span>Pinterest account</span><span>{accountLabel(selected)}</span></div>
								<div className="pub-meta__row"><span>Board</span><span>{boardLabel(selected)}</span></div>
								<div className="pub-meta__row">
									<span>Publish time</span>
									<span>{selected.publishedAt ? new Date(selected.publishedAt).toLocaleString() : (selected.scheduledAt ? new Date(selected.scheduledAt).toLocaleString() : '—')}</span>
								</div>
								<div className="pub-meta__row">
									<span>Created</span>
									<span>{selected.createdAt ? new Date(selected.createdAt).toLocaleString() : '—'}</span>
								</div>
								<div className="pub-meta__row"><span>Attempts</span><span>{selected.attemptCount || 0}/{selected.maxAttempts || 3}</span></div>
								<div className="pub-meta__row">
									<span>Destination URL</span>
									<span className="truncate max-w-[9rem]">{selected.pinterestPinUrl || '—'}</span>
								</div>
							</div>

							<div>
								<p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Prompt / overlay</p>
								<div className="pub-box">{selected.pin?.overlayText || selected.pin?.description || 'No prompt text on this job.'}</div>
							</div>

							<div>
								<p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Publishing log</p>
								<div className="pub-box">
									{`status: ${selected.status}\nupdated: ${selected.updatedAt || '—'}\nnextRetry: ${selected.nextRetryAt || '—'}\npinterestPinId: ${selected.pinterestPinId || '—'}`}
								</div>
							</div>

							{selected.lastError ? (
								<div>
									<p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Error message</p>
									<div className="pub-box is-error">{selected.lastError}</div>
								</div>
							) : null}

							<div className="grid gap-2">
								{selected.status === 'failed' ? (
									<Button size="sm" onClick={() => retryFailed(selected.id)} disabled={retryingId === selected.id}>
										{retryingId === selected.id ? <Spinner className="h-4 w-4" /> : <RefreshCw size={14} />}
										Retry
									</Button>
								) : null}
								{selected.status === 'scheduled' || selected.status === 'failed' ? (
									<Button size="sm" variant="outline" onClick={() => publishNow(selected.id)} disabled={publishingNowId === selected.id}>
										{publishingNowId === selected.id ? <Spinner className="h-4 w-4" /> : <Send size={14} />}
										Publish Now
									</Button>
								) : null}
								{selected.status === 'scheduled' ? (
									<Button size="sm" variant="outline" onClick={() => cancelScheduled(selected.id)} disabled={cancellingId === selected.id}>
										{cancellingId === selected.id ? <Spinner className="h-4 w-4" /> : <XCircle size={14} />}
										Cancel schedule
									</Button>
								) : null}
								{selected.pinterestPinUrl ? (
									<a href={selected.pinterestPinUrl} target="_blank" rel="noreferrer">
										<Button size="sm" variant="outline" className="w-full"><ExternalLink size={14} /> Open Pinterest Pin</Button>
									</a>
								) : null}
								<Button size="sm" variant="ghost" disabled={!selected.pinterestPinUrl} onClick={() => copyLink(selected)}>
									<Copy size={14} /> Copy Link
								</Button>
							</div>
						</>
					)}
				</aside>
			</div>
		</div>
	);
}
