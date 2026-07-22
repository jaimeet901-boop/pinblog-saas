import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	History, Search, Download, Copy, RefreshCw, ExternalLink, Pin,
	Sparkles, LayoutGrid, List, Coins, Clock,
} from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Select } from '@/components/kit';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import './AIPinHistoryPage.css';

const QUICK_FILTERS = [
	{ id: 'all', label: 'All' },
	{ id: 'today', label: 'Today' },
	{ id: 'week', label: 'This Week' },
	{ id: 'month', label: 'This Month' },
	{ id: 'failed', label: 'Failed' },
	{ id: 'successful', label: 'Successful' },
];

function formatDate(value) {
	if (!value) return '—';
	try {
		return new Date(value).toLocaleString();
	} catch {
		return '—';
	}
}

function startOfDay(date = new Date()) {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

function metaGet(item, keys, fallback = '') {
	const source = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {};
	for (const key of keys) {
		const value = source[key];
		if (value != null && String(value).trim()) return String(value);
	}
	return fallback;
}

function isFailed(item) {
	const status = String(metaGet(item, ['status', 'result', 'outcome'], item.eventType || '')).toLowerCase();
	return status.includes('fail') || status.includes('error');
}

function isSuccessful(item) {
	if (isFailed(item)) return false;
	return Boolean(item.imageUrl || item.prompt || item.analysis || item.eventType);
}

function creditsTotal(item) {
	return Number(item.aiCreditsUsed || 0) + Number(item.imageCreditsUsed || 0);
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
	const headers = ['id', 'eventType', 'article', 'prompt', 'template', 'model', 'credits', 'created', 'status'];
	const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
	const lines = [headers.join(',')];
	for (const item of rows) {
		lines.push([
			item.id,
			item.eventType,
			item.analysis?.title || '',
			item.prompt || '',
			metaGet(item, ['template', 'templateName', 'template_id']),
			metaGet(item, ['model', 'aiModel', 'provider']),
			creditsTotal(item),
			item.created || '',
			isFailed(item) ? 'failed' : 'successful',
		].map(escape).join(','));
	}
	return `${lines.join('\n')}\n`;
}

export default function AIPinHistoryPage() {
	const { toast } = useToast();
	const { user } = useAuth();
	const searchRef = useRef(null);

	const [items, setItems] = useState([]);
	const [loading, setLoading] = useState(true);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [totalItems, setTotalItems] = useState(0);
	const [selectedId, setSelectedId] = useState('');
	const [view, setView] = useState('table');
	const [searchQuery, setSearchQuery] = useState('');
	const [websiteFilter, setWebsiteFilter] = useState('');
	const [templateFilter, setTemplateFilter] = useState('');
	const [modelFilter, setModelFilter] = useState('');
	const [statusFilter, setStatusFilter] = useState('');
	const [dateRange, setDateRange] = useState('');
	const [quickFilter, setQuickFilter] = useState('all');
	const [exportFormat, setExportFormat] = useState('csv');

	const load = async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch(`/ai-pins/history?page=${page}&perPage=20`, { method: 'GET' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || 'Failed to load history');
			}
			const next = payload.items || [];
			setItems(next);
			setTotalPages(payload.totalPages || 1);
			setTotalItems(payload.totalItems || next.length || 0);
			setSelectedId((prev) => (next.some((item) => item.id === prev) ? prev : next[0]?.id || ''));
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, [page]);

	const websiteOptions = useMemo(() => {
		const set = new Set();
		for (const item of items) {
			if (item.websiteId) set.add(item.websiteId);
		}
		return [...set];
	}, [items]);

	const templateOptions = useMemo(() => {
		const set = new Set();
		for (const item of items) {
			const value = metaGet(item, ['template', 'templateName', 'template_id']);
			if (value) set.add(value);
		}
		return [...set];
	}, [items]);

	const modelOptions = useMemo(() => {
		const set = new Set();
		for (const item of items) {
			const value = metaGet(item, ['model', 'aiModel', 'provider']);
			if (value) set.add(value);
		}
		return [...set];
	}, [items]);

	const filteredItems = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		const today = startOfDay();
		const weekStart = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
		const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

		return items.filter((item) => {
			if (websiteFilter && item.websiteId !== websiteFilter) return false;
			if (templateFilter && metaGet(item, ['template', 'templateName', 'template_id']) !== templateFilter) return false;
			if (modelFilter && metaGet(item, ['model', 'aiModel', 'provider']) !== modelFilter) return false;
			if (statusFilter === 'failed' && !isFailed(item)) return false;
			if (statusFilter === 'successful' && !isSuccessful(item)) return false;

			const created = item.created ? new Date(item.created) : null;
			if (quickFilter === 'today' && (!created || created < today)) return false;
			if (quickFilter === 'week' && (!created || created < weekStart)) return false;
			if (quickFilter === 'month' && (!created || created < monthStart)) return false;
			if (quickFilter === 'failed' && !isFailed(item)) return false;
			if (quickFilter === 'successful' && !isSuccessful(item)) return false;

			if (dateRange === 'today' && (!created || created < today)) return false;
			if (dateRange === 'week' && (!created || created < weekStart)) return false;
			if (dateRange === 'month' && (!created || created < monthStart)) return false;

			if (!query) return true;
			const haystack = [
				item.eventType,
				item.prompt,
				item.analysis?.title,
				item.websiteId,
				metaGet(item, ['template', 'templateName', 'model', 'aiModel', 'provider']),
			].join(' ').toLowerCase();
			return haystack.includes(query);
		});
	}, [items, searchQuery, websiteFilter, templateFilter, modelFilter, statusFilter, dateRange, quickFilter]);

	const selected = useMemo(
		() => filteredItems.find((item) => item.id === selectedId) || items.find((item) => item.id === selectedId) || null,
		[filteredItems, items, selectedId],
	);

	const stats = useMemo(() => {
		const total = totalItems || items.length;
		const pins = items.filter((item) => String(item.eventType || '').toLowerCase().includes('pin') || item.aiPinId).length;
		const images = items.filter((item) => item.imageUrl || String(item.eventType || '').toLowerCase().includes('image')).length;
		const optimizations = items.filter((item) => {
			const type = String(item.eventType || '').toLowerCase();
			return type.includes('prompt') || type.includes('optim') || type.includes('analy');
		}).length;
		const credits = items.reduce((sum, item) => sum + creditsTotal(item), 0);
		const failed = items.filter(isFailed).length;
		const successful = items.filter(isSuccessful).length;
		const decided = failed + successful;
		const rate = decided ? Math.round((successful / decided) * 100) : null;

		const templateCounts = new Map();
		for (const item of items) {
			const template = metaGet(item, ['template', 'templateName', 'template_id']);
			if (!template) continue;
			templateCounts.set(template, (templateCounts.get(template) || 0) + 1);
		}
		const favoriteTemplate = [...templateCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

		return {
			total,
			pins: pins || images,
			images,
			optimizations: optimizations || '—',
			credits: Number(credits.toFixed(2)),
			successRate: rate,
			avgDuration: '—',
			favoriteTemplate,
		};
	}, [items, totalItems]);

	const timelineGroups = useMemo(() => {
		const today = startOfDay();
		const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
		const weekStart = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
		const groups = { today: [], yesterday: [], week: [], older: [] };
		for (const item of filteredItems) {
			const created = item.created ? new Date(item.created) : null;
			if (!created) {
				groups.older.push(item);
			} else if (created >= today) {
				groups.today.push(item);
			} else if (created >= yesterday) {
				groups.yesterday.push(item);
			} else if (created >= weekStart) {
				groups.week.push(item);
			} else {
				groups.older.push(item);
			}
		}
		return groups;
	}, [filteredItems]);

	const insights = useMemo(() => {
		const modelCounts = new Map();
		const websiteCounts = new Map();
		const templateCounts = new Map();
		let creditSum = 0;
		for (const item of items) {
			creditSum += creditsTotal(item);
			const model = metaGet(item, ['model', 'aiModel', 'provider']);
			const template = metaGet(item, ['template', 'templateName', 'template_id']);
			if (model) modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
			if (template) templateCounts.set(template, (templateCounts.get(template) || 0) + 1);
			if (item.websiteId) websiteCounts.set(item.websiteId, (websiteCounts.get(item.websiteId) || 0) + 1);
		}
		const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
		return [
			{ title: 'Most used template', body: top(templateCounts) || 'No template metadata on this page yet.' },
			{ title: 'Most used AI model', body: top(modelCounts) || 'Model fields appear when metadata includes a provider.' },
			{ title: 'Most active website', body: top(websiteCounts) || 'Website IDs will show once generations are tagged.' },
			{
				title: 'Average credits per generation',
				body: items.length ? `${(creditSum / items.length).toFixed(2)} credits` : 'Unavailable until generations exist.',
			},
		];
	}, [items]);

	const exportCurrent = () => {
		if (!filteredItems.length) {
			toast({ variant: 'destructive', title: 'Nothing to export', description: 'No rows match the current filters.' });
			return;
		}
		if (exportFormat === 'json') {
			downloadBlob('ai-pin-history.json', JSON.stringify(filteredItems, null, 2), 'application/json');
		} else {
			downloadBlob('ai-pin-history.csv', toCsv(filteredItems), 'text/csv;charset=utf-8');
		}
		toast({ title: 'Exported', description: `${filteredItems.length} rows downloaded as ${exportFormat.toUpperCase()}.` });
	};

	const copyPrompt = async (value) => {
		if (!value?.trim()) return;
		try {
			await navigator.clipboard.writeText(value);
			toast({ title: 'Prompt copied' });
		} catch {
			toast({ variant: 'destructive', title: 'Copy failed', description: 'Clipboard access was blocked.' });
		}
	};

	const downloadImage = (url) => {
		if (!url) return;
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'chef-ia-generation';
		anchor.target = '_blank';
		anchor.rel = 'noreferrer';
		anchor.click();
	};

	useEffect(() => {
		const onKeyDown = (event) => {
			if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
				const tag = document.activeElement?.tagName?.toLowerCase();
				if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
				event.preventDefault();
				searchRef.current?.focus();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	const renderStatus = (item) => (
		<Badge tone={isFailed(item) ? 'red' : 'green'}>{isFailed(item) ? 'Failed' : 'Successful'}</Badge>
	);

	return (
		<div className="hist-atelier">
			<section className="hist-hero">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<p className="hist-hero__eyebrow">Chef IA Generation History</p>
						<h1 className="hist-hero__title">AI Generation History</h1>
						<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
							Every analysis, prompt, image, and edit is tracked here with credits used.
						</p>
						<div className="hist-hero__meta">
							<span className="hist-pill"><Sparkles size={12} /> {user?.name || 'Chef IA'} workspace</span>
							<span className="hist-pill"><Coins size={12} /> {stats.credits} credits used</span>
							<span className="hist-pill"><History size={12} /> {stats.total} generations</span>
						</div>
					</div>
					<div className="flex flex-wrap gap-2">
						<Link to="/app/ai-pins"><Button variant="outline">Back to AI Pins</Button></Link>
						<div className="flex items-end gap-2">
							<Select label="Export" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
								<option value="csv">CSV</option>
								<option value="json">JSON</option>
							</Select>
							<Button variant="ghost" onClick={exportCurrent} disabled={!filteredItems.length}>
								<Download size={14} /> Export
							</Button>
						</div>
					</div>
				</div>
			</section>

			<div className="hist-stats">
				{[
					{ label: 'Total Generations', value: stats.total, hint: null },
					{ label: 'AI Pins Generated', value: stats.pins, hint: null },
					{ label: 'Images Generated', value: stats.images, hint: null },
					{ label: 'Prompt Optimizations', value: stats.optimizations, hint: stats.optimizations === '—' ? 'Placeholder' : null },
					{ label: 'Credits Used', value: stats.credits, hint: 'This page' },
					{ label: 'Success Rate', value: stats.successRate == null ? '—' : `${stats.successRate}%`, hint: null },
					{ label: 'Avg. Generation Time', value: stats.avgDuration, hint: 'Not in history feed' },
					{ label: 'Favorite Template', value: stats.favoriteTemplate, hint: stats.favoriteTemplate === '—' ? 'No metadata yet' : null },
				].map((card) => (
					<div key={card.label} className="hist-stat">
						<p className="hist-stat__label">{card.label}</p>
						{loading ? (
							<div className="mt-3 h-7 w-12 animate-pulse rounded-md bg-secondary" />
						) : (
							<p className="hist-stat__value">{card.value}</p>
						)}
						{card.hint ? <p className="hist-stat__hint">{card.hint}</p> : null}
					</div>
				))}
			</div>

			<div className="hist-toolbar">
				<div className="flex flex-wrap items-end gap-2">
					<div className="hist-view-toggle" role="group" aria-label="History view">
						<button type="button" className={view === 'table' ? 'is-active' : ''} onClick={() => setView('table')}>
							<List size={12} className="inline" /> Table
						</button>
						<button type="button" className={view === 'gallery' ? 'is-active' : ''} onClick={() => setView('gallery')}>
							<LayoutGrid size={12} className="inline" /> Gallery
						</button>
					</div>
					<div className="hist-quick">
						{QUICK_FILTERS.map((filter) => (
							<button
								key={filter.id}
								type="button"
								className={`hist-chip ${quickFilter === filter.id ? 'is-active' : ''}`}
								onClick={() => {
									setQuickFilter(filter.id);
									if (filter.id === 'failed' || filter.id === 'successful') setStatusFilter(filter.id);
									else setStatusFilter('');
									if (filter.id === 'today' || filter.id === 'week' || filter.id === 'month') setDateRange(filter.id);
									else setDateRange('');
								}}
							>
								{filter.label}
							</button>
						))}
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
					<Select label="Website" value={websiteFilter} onChange={(e) => setWebsiteFilter(e.target.value)}>
						<option value="">All websites</option>
						{websiteOptions.map((id) => <option key={id} value={id}>{id}</option>)}
					</Select>
					<Select label="Template" value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)}>
						<option value="">All templates</option>
						{templateOptions.map((name) => <option key={name} value={name}>{name}</option>)}
					</Select>
					<Select label="AI model" value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
						<option value="">All models</option>
						{modelOptions.map((name) => <option key={name} value={name}>{name}</option>)}
					</Select>
					<Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
						<option value="">All statuses</option>
						<option value="successful">Successful</option>
						<option value="failed">Failed</option>
					</Select>
					<Select label="Date range" value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
						<option value="">Any time</option>
						<option value="today">Today</option>
						<option value="week">This week</option>
						<option value="month">This month</option>
					</Select>
				</div>
			</div>

			<div className="hist-shell">
				<section className="hist-main space-y-4">
					<div className="flex items-center justify-between gap-2">
						<div>
							<h2 className="font-display text-lg font-semibold">History Workspace</h2>
							<p className="text-[11px] text-muted-foreground">{filteredItems.length} on this page · page {page} of {totalPages}</p>
						</div>
						{totalPages > 1 ? (
							<div className="flex items-center gap-2">
								<Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>Previous</Button>
								<Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>Next</Button>
							</div>
						) : null}
					</div>

					{loading ? (
						<div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="hist-skeleton" />)}</div>
					) : null}

					{!loading && filteredItems.length === 0 ? (
						<div className="hist-empty">
							<div className="hist-empty__art" aria-hidden="true" />
							<p className="font-display text-xl font-semibold">No AI generations yet.</p>
							<p className="mt-2 max-w-md text-sm text-muted-foreground">
								Analyze articles or generate pin images to build your history.
							</p>
							<Link to="/app/ai-pins" className="mt-5"><Button size="sm"><Pin size={14} /> Create your first AI Pin</Button></Link>
						</div>
					) : null}

					{!loading && filteredItems.length > 0 && view === 'table' ? (
						<>
							<div className="hist-table-wrap">
								<table className="hist-table">
									<thead>
										<tr>
											<th>Thumbnail</th>
											<th>Article</th>
											<th>Prompt</th>
											<th>Template</th>
											<th>AI Model</th>
											<th>Credits</th>
											<th>Duration</th>
											<th>Date</th>
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
													{item.imageUrl ? (
														<img className="hist-thumb" src={item.imageUrl} alt="" loading="lazy" decoding="async" />
													) : (
														<span className="hist-thumb-fallback"><History size={12} /></span>
													)}
												</td>
												<td><p className="max-w-[9rem] truncate font-medium">{item.analysis?.title || item.eventType || 'Generation'}</p></td>
												<td><p className="max-w-[12rem] truncate text-muted-foreground">{item.prompt || '—'}</p></td>
												<td className="text-muted-foreground">{metaGet(item, ['template', 'templateName', 'template_id'], '—')}</td>
												<td className="text-muted-foreground">{metaGet(item, ['model', 'aiModel', 'provider'], '—')}</td>
												<td>{creditsTotal(item)}</td>
												<td className="text-muted-foreground">—</td>
												<td className="whitespace-nowrap text-muted-foreground">{formatDate(item.created)}</td>
												<td>{renderStatus(item)}</td>
												<td>
													<div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
														<Button size="sm" variant="ghost" onClick={() => setSelectedId(item.id)}>View</Button>
														<Button size="sm" variant="ghost" disabled={!item.prompt} onClick={() => copyPrompt(item.prompt)}><Copy size={12} /></Button>
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>

							<div className="hist-card-list">
								{filteredItems.map((item) => (
									<button
										key={item.id}
										type="button"
										className={`hist-card ${selectedId === item.id ? 'is-selected' : ''}`}
										onClick={() => setSelectedId(item.id)}
									>
										<div className="flex gap-3">
											{item.imageUrl ? (
												<img className="hist-thumb" src={item.imageUrl} alt="" loading="lazy" decoding="async" />
											) : (
												<span className="hist-thumb-fallback"><History size={12} /></span>
											)}
											<div className="min-w-0 flex-1 text-left">
												<p className="truncate text-sm font-semibold">{item.analysis?.title || item.eventType || 'Generation'}</p>
												<p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.prompt || 'No prompt'}</p>
												<div className="mt-2 flex flex-wrap items-center gap-2">
													{renderStatus(item)}
													<span className="text-[11px] text-muted-foreground">{formatDate(item.created)}</span>
												</div>
											</div>
										</div>
									</button>
								))}
							</div>
						</>
					) : null}

					{!loading && filteredItems.length > 0 && view === 'gallery' ? (
						<div className="hist-gallery">
							{filteredItems.map((item) => (
								<button
									key={item.id}
									type="button"
									className={`hist-gallery__card ${selectedId === item.id ? 'is-selected' : ''}`}
									onClick={() => setSelectedId(item.id)}
								>
									{item.imageUrl ? (
										<img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
									) : (
										<div className="flex aspect-square items-center justify-center bg-secondary text-muted-foreground"><History size={22} /></div>
									)}
									<div className="body">
										<p className="truncate text-sm font-semibold">{item.analysis?.title || item.eventType || 'Generation'}</p>
										<p className="mt-1 text-[11px] text-muted-foreground">{creditsTotal(item)} credits · {formatDate(item.created)}</p>
									</div>
								</button>
							))}
						</div>
					) : null}

					{!loading && filteredItems.length > 0 ? (
						<div className="hist-timeline border-t border-border/70 pt-4">
							{[
								{ key: 'today', label: 'Today', rows: timelineGroups.today },
								{ key: 'yesterday', label: 'Yesterday', rows: timelineGroups.yesterday },
								{ key: 'week', label: 'This Week', rows: timelineGroups.week },
								{ key: 'older', label: 'Older', rows: timelineGroups.older },
							].filter((group) => group.rows.length).map((group) => (
								<div key={group.key}>
									<h3>{group.label}</h3>
									<div className="space-y-2">
										{group.rows.slice(0, 6).map((item) => (
											<button
												key={`tl-${item.id}`}
												type="button"
												className={`hist-card w-full ${selectedId === item.id ? 'is-selected' : ''}`}
												onClick={() => setSelectedId(item.id)}
											>
												<div className="flex items-center justify-between gap-2">
													<p className="truncate text-sm font-medium">{item.analysis?.title || item.eventType || 'Generation'}</p>
													<span className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><Clock size={11} /> {formatDate(item.created)}</span>
												</div>
											</button>
										))}
									</div>
								</div>
							))}
						</div>
					) : null}
				</section>

				<aside className="hist-side space-y-4">
					<div>
						<h2 className="font-display text-lg font-semibold">Details Inspector</h2>
						<p className="text-[11px] text-muted-foreground">Inspect prompts, images, and credits.</p>
					</div>

					{!selected ? (
						<div className="rounded-2xl border border-dashed border-border bg-background/50 px-4 py-12 text-center">
							<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
								<History size={22} />
							</div>
							<p className="font-medium">No generation selected</p>
							<p className="mt-1 text-xs text-muted-foreground">Choose a row to inspect details.</p>
						</div>
					) : (
						<>
							<div className="hist-preview">
								{selected.imageUrl ? (
									<img src={selected.imageUrl} alt={selected.analysis?.title || 'Generated'} loading="lazy" decoding="async" />
								) : (
									<div className="hist-preview__empty"><Pin size={28} /></div>
								)}
							</div>
							<div>
								<p className="font-display text-lg font-semibold leading-snug">{selected.analysis?.title || selected.eventType || 'Generation'}</p>
								<div className="mt-2">{renderStatus(selected)}</div>
							</div>
							<div className="hist-meta">
								<div className="hist-meta__row"><span>Credits used</span><span>{creditsTotal(selected)}</span></div>
								<div className="hist-meta__row"><span>Generation time</span><span>{formatDate(selected.created)}</span></div>
								<div className="hist-meta__row"><span>AI model</span><span>{metaGet(selected, ['model', 'aiModel', 'provider'], '—')}</span></div>
								<div className="hist-meta__row"><span>Quality</span><span>{metaGet(selected, ['quality', 'imageQuality'], '—')}</span></div>
								<div className="hist-meta__row"><span>Template</span><span>{metaGet(selected, ['template', 'templateName', 'template_id'], '—')}</span></div>
								<div className="hist-meta__row"><span>Website</span><span>{selected.websiteId || '—'}</span></div>
							</div>
							<div>
								<p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Original prompt</p>
								<div className="hist-box">{selected.prompt || 'No prompt stored for this event.'}</div>
							</div>
							<div>
								<p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Enhanced prompt</p>
								<div className="hist-box">
									{metaGet(selected, ['enhancedPrompt', 'optimizedPrompt', 'finalPrompt'], selected.analysis?.description || 'No enhanced prompt on this record.')}
								</div>
							</div>
							<div className="grid gap-2">
								<Button size="sm" variant="outline" disabled={!selected.imageUrl} onClick={() => downloadImage(selected.imageUrl)}>
									<Download size={14} /> Download
								</Button>
								<Button size="sm" variant="outline" disabled={!selected.prompt} onClick={() => copyPrompt(selected.prompt)}>
									<Copy size={14} /> Copy Prompt
								</Button>
								<Link to="/app/ai-pins">
									<Button size="sm" variant="outline" className="w-full"><RefreshCw size={14} /> Regenerate in AI Pins</Button>
								</Link>
								<Button
									size="sm"
									variant="ghost"
									disabled={!selected.articleId}
									onClick={() => {
										if (selected.articleId) {
											toast({ title: 'Article linked', description: `Article ID ${selected.articleId} — open from AI Pins article picker.` });
										}
									}}
								>
									<ExternalLink size={14} /> View Article
								</Button>
							</div>
						</>
					)}

					<div className="border-t border-border/70 pt-4">
						<h3 className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">AI Insights</h3>
						<div className="space-y-2">
							{insights.map((tip) => (
								<div key={tip.title} className="hist-insight">
									<strong>{tip.title}</strong>
									{tip.body}
								</div>
							))}
						</div>
					</div>
				</aside>
			</div>
		</div>
	);
}
