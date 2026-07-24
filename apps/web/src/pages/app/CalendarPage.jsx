import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	ChevronLeft, ChevronRight, CalendarClock, Pin, RefreshCw, Search,
	ExternalLink, XCircle, Loader2,
} from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Button, Select, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { useWorkspaceConfig } from '@/context/WorkspaceConfigContext';
import { resolvePublishingConfig } from '@/services/ai-pins/publishingConfig.js';
import './CalendarPage.css';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const QUICK_FILTERS = [
	{ id: 'all', label: 'All' },
	{ id: 'today', label: 'Today' },
	{ id: 'tomorrow', label: 'Tomorrow' },
	{ id: 'week', label: 'This Week' },
	{ id: 'scheduled', label: 'Scheduled' },
	{ id: 'published', label: 'Published' },
	{ id: 'failed', label: 'Failed' },
];

function sameDay(dateA, dateB) {
	return dateA.getFullYear() === dateB.getFullYear()
		&& dateA.getMonth() === dateB.getMonth()
		&& dateA.getDate() === dateB.getDate();
}

function startOfDay(date = new Date()) {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

function addDays(date, amount) {
	const d = new Date(date);
	d.setDate(d.getDate() + amount);
	return d;
}

function startOfWeek(date) {
	const d = startOfDay(date);
	d.setDate(d.getDate() - d.getDay());
	return d;
}

function statusTone(status) {
	if (status === 'published') return 'green';
	if (status === 'failed') return 'red';
	if (status === 'scheduled' || status === 'queued' || status === 'publishing') return 'amber';
	return 'default';
}

function statusClass(status) {
	const value = String(status || 'scheduled').toLowerCase();
	if (['published', 'scheduled', 'failed', 'draft', 'queued', 'publishing'].includes(value)) {
		return `is-${value}`;
	}
	return 'is-scheduled';
}

function formatStatus(status) {
	if (!status) return 'Scheduled';
	return String(status).charAt(0).toUpperCase() + String(status).slice(1);
}

function accountLabel(job) {
	return job.accountLabel || job.accountUsername || job.accountId || '—';
}

function boardLabel(job) {
	return job.boardName || job.boardId || '—';
}

export default function CalendarPage() {
	const { toast } = useToast();
	const { config } = useWorkspaceConfig();
	const publishingConfig = useMemo(() => resolvePublishingConfig(config), [config]);
	const workspaceTimezone = publishingConfig.timezone || 'UTC';
	const searchRef = useRef(null);

	const [cursor, setCursor] = useState(() => new Date());
	const [view, setView] = useState('month');
	const [jobs, setJobs] = useState([]);
	const [loading, setLoading] = useState(true);
	const [draggingJobId, setDraggingJobId] = useState('');
	const [selectedJob, setSelectedJob] = useState(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [websiteFilter, setWebsiteFilter] = useState('');
	const [accountFilter, setAccountFilter] = useState('');
	const [boardFilter, setBoardFilter] = useState('');
	const [statusFilter, setStatusFilter] = useState('');
	const [dateFilter, setDateFilter] = useState('');
	const [quickFilter, setQuickFilter] = useState('all');
	const [retryingId, setRetryingId] = useState('');
	const [cancellingId, setCancellingId] = useState('');

	const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;

	const loadCalendar = async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch(`/pinterest/calendar?month=${monthKey}`, { method: 'GET' });
			const payload = await response.json().catch(() => []);
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to load calendar (${response.status})`);
			}
			const next = Array.isArray(payload) ? payload : [];
			setJobs(next);
			setSelectedJob((prev) => {
				if (!prev) return null;
				return next.find((job) => job.id === prev.id) || null;
			});
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		loadCalendar();
	}, [monthKey]);

	const { days, month } = useMemo(() => {
		const y = cursor.getFullYear();
		const m = cursor.getMonth();
		const first = new Date(y, m, 1).getDay();
		const total = new Date(y, m + 1, 0).getDate();
		const cells = [];
		for (let i = 0; i < first; i++) {
			cells.push(null);
		}
		for (let d = 1; d <= total; d++) {
			cells.push(new Date(y, m, d));
		}
		while (cells.length % 7 !== 0) {
			cells.push(null);
		}
		return { days: cells, month: m };
	}, [cursor]);

	const weekDays = useMemo(() => {
		const start = startOfWeek(cursor);
		return Array.from({ length: 7 }, (_, index) => addDays(start, index));
	}, [cursor]);

	const accountOptions = useMemo(() => {
		const map = new Map();
		for (const job of jobs) {
			const key = job.accountId || accountLabel(job);
			if (!key || key === '—') continue;
			map.set(key, accountLabel(job));
		}
		return [...map.entries()];
	}, [jobs]);

	const boardOptions = useMemo(() => {
		const map = new Map();
		for (const job of jobs) {
			const key = job.boardId || boardLabel(job);
			if (!key || key === '—') continue;
			map.set(key, boardLabel(job));
		}
		return [...map.entries()];
	}, [jobs]);

	const websiteOptions = useMemo(() => {
		const set = new Set();
		for (const job of jobs) {
			if (job.websiteId) set.add(job.websiteId);
		}
		return [...set];
	}, [jobs]);

	const filteredJobs = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		const today = startOfDay();
		const tomorrow = addDays(today, 1);
		const weekEnd = addDays(today, 7);

		return jobs.filter((job) => {
			const stamp = job.scheduledAt ? new Date(job.scheduledAt) : null;
			const time = stamp ? stamp.getTime() : 0;

			if (accountFilter) {
				const key = job.accountId || accountLabel(job);
				if (key !== accountFilter) return false;
			}
			if (boardFilter) {
				const key = job.boardId || boardLabel(job);
				if (key !== boardFilter) return false;
			}
			if (websiteFilter && job.websiteId !== websiteFilter) return false;
			if (statusFilter && job.status !== statusFilter) return false;

			if (quickFilter === 'today' && (!stamp || !sameDay(stamp, today))) return false;
			if (quickFilter === 'tomorrow' && (!stamp || !sameDay(stamp, tomorrow))) return false;
			if (quickFilter === 'week' && (!stamp || time < today.getTime() || time >= weekEnd.getTime())) return false;
			if (quickFilter === 'scheduled' && job.status !== 'scheduled') return false;
			if (quickFilter === 'published' && job.status !== 'published') return false;
			if (quickFilter === 'failed' && job.status !== 'failed') return false;

			if (dateFilter === 'today' && (!stamp || !sameDay(stamp, today))) return false;
			if (dateFilter === 'tomorrow' && (!stamp || !sameDay(stamp, tomorrow))) return false;
			if (dateFilter === 'week' && (!stamp || time < today.getTime() || time >= weekEnd.getTime())) return false;

			if (!query) return true;
			const haystack = [
				job.pin?.title,
				job.pin?.description,
				job.pin?.overlayText,
				accountLabel(job),
				boardLabel(job),
				job.websiteId,
				job.status,
			].join(' ').toLowerCase();
			return haystack.includes(query);
		});
	}, [jobs, searchQuery, accountFilter, boardFilter, websiteFilter, statusFilter, quickFilter, dateFilter]);

	const jobsForDay = (date) => filteredJobs.filter((job) => job.scheduledAt && sameDay(new Date(job.scheduledAt), date));

	const stats = useMemo(() => {
		const today = startOfDay();
		const weekEnd = addDays(today, 7);
		let scheduledToday = 0;
		let scheduledWeek = 0;
		let pinterest = jobs.length;
		let pending = 0;
		let failed = 0;

		for (const job of jobs) {
			const stamp = job.scheduledAt ? new Date(job.scheduledAt) : null;
			if (stamp && sameDay(stamp, today) && job.status === 'scheduled') scheduledToday += 1;
			if (stamp && stamp >= today && stamp < weekEnd && job.status === 'scheduled') scheduledWeek += 1;
			if (job.status === 'scheduled' || job.status === 'queued' || job.status === 'publishing') pending += 1;
			if (job.status === 'failed') failed += 1;
		}

		return {
			scheduledToday,
			scheduledWeek,
			pinterest,
			wordpress: '—',
			pending,
			failed,
		};
	}, [jobs]);

	const agenda = useMemo(() => {
		const today = startOfDay();
		const tomorrow = addDays(today, 1);
		const sorted = [...filteredJobs]
			.filter((job) => job.scheduledAt)
			.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

		return {
			today: sorted.filter((job) => sameDay(new Date(job.scheduledAt), today)),
			tomorrow: sorted.filter((job) => sameDay(new Date(job.scheduledAt), tomorrow)),
			upcoming: sorted.filter((job) => {
				const stamp = new Date(job.scheduledAt);
				return stamp >= addDays(tomorrow, 1);
			}).slice(0, 8),
		};
	}, [filteredJobs]);

	const handleDropToDay = async (targetDay) => {
		if (!draggingJobId) {
			return;
		}

		const dragged = jobs.find((job) => job.id === draggingJobId);
		if (!dragged) {
			return;
		}

		const oldDate = new Date(dragged.scheduledAt);
		const movedDate = new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(), oldDate.getHours(), oldDate.getMinutes(), 0);

		try {
			const response = await apiServerClient.fetch(`/pinterest/jobs/${draggingJobId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					scheduledAt: movedDate.toISOString(),
					timezone: dragged.timezone || workspaceTimezone,
				}),
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to update schedule (${response.status})`);
			}

			setJobs((prev) => prev.map((job) => (job.id === draggingJobId ? payload : job)));
			if (selectedJob?.id === draggingJobId) {
				setSelectedJob(payload);
			}
			toast({ title: 'Schedule updated', description: 'Pin date was moved successfully.' });
		} catch (error) {
			toast({ variant: 'destructive', title: 'Failed to move pin', description: error.message });
		} finally {
			setDraggingJobId('');
		}
	};

	const retryFailed = async (jobId) => {
		setRetryingId(jobId);
		try {
			const response = await apiServerClient.fetch(`/pinterest/jobs/${jobId}/retry`, { method: 'POST' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to retry job (${response.status})`);
			}
			toast({ title: 'Retry queued', description: 'Failed pin was moved back to publishing queue.' });
			await loadCalendar();
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
			setSelectedJob(null);
			await loadCalendar();
		} catch (error) {
			toast({ variant: 'destructive', title: 'Cancel failed', description: error.message });
		} finally {
			setCancellingId('');
		}
	};

	const goToday = () => setCursor(new Date());

	const shiftCursor = (direction) => {
		if (view === 'day') {
			setCursor((prev) => addDays(prev, direction));
			return;
		}
		if (view === 'week') {
			setCursor((prev) => addDays(prev, direction * 7));
			return;
		}
		setCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + direction, 1));
	};

	const headerLabel = useMemo(() => {
		if (view === 'day') {
			return cursor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
		}
		if (view === 'week') {
			const start = weekDays[0];
			const end = weekDays[6];
			return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
		}
		return cursor.toLocaleString('default', { month: 'long', year: 'numeric' });
	}, [view, cursor, weekDays]);

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
				loadCalendar();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [monthKey]);

	const today = new Date();
	const showEmptyCalendar = !loading && filteredJobs.length === 0;

	const renderEventChip = (job) => (
		<button
			key={job.id}
			type="button"
			draggable
			onDragStart={() => setDraggingJobId(job.id)}
			onClick={() => setSelectedJob(job)}
			className={`cal-event ${statusClass(job.status)} ${selectedJob?.id === job.id ? 'is-selected' : ''}`}
			title={job.pin?.title || 'Scheduled Pin'}
		>
			{job.pin?.imageUrl ? (
				<img className="cal-event__thumb" src={job.pin.imageUrl} alt="" loading="lazy" decoding="async" />
			) : (
				<Pin size={9} />
			)}
			<span className="truncate">{job.pin?.title || 'Scheduled Pin'}</span>
		</button>
	);

	const renderDayCell = (date, key, { outside = false } = {}) => {
		if (!date) {
			return <div key={key} className="cal-day-cell is-outside" />;
		}
		const dayJobs = jobsForDay(date);
		const isToday = sameDay(date, today);
		return (
			<div
				key={key}
				className={`cal-day-cell ${isToday ? 'is-today' : ''} ${outside ? 'is-outside' : ''} ${draggingJobId ? 'is-drop-target' : ''}`}
				onDragOver={(e) => e.preventDefault()}
				onDrop={() => handleDropToDay(date)}
			>
				<span className="cal-day-cell__num">{date.getDate()}</span>
				<div className="mt-1 space-y-1">
					{dayJobs.slice(0, view === 'week' ? 5 : 3).map(renderEventChip)}
					{dayJobs.length > (view === 'week' ? 5 : 3) ? (
						<span className="text-[10px] text-muted-foreground">+{dayJobs.length - (view === 'week' ? 5 : 3)} more</span>
					) : null}
				</div>
			</div>
		);
	};

	return (
		<div className="cal-atelier">
			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Chef IA Studio</p>
					<h1 className="font-display text-3xl font-semibold tracking-tight">Content Calendar</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Plan, drag, and refine scheduled Pinterest pins across month, week, and day views.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Link to="/app/ai-pins"><Button variant="outline" size="sm"><Pin size={14} /> AI Pins</Button></Link>
					<Link to="/app/pinterest-history"><Button variant="outline" size="sm"><CalendarClock size={14} /> Publishing Center</Button></Link>
				</div>
			</div>

			<div className="cal-atelier__actions">
				<div className="flex flex-wrap items-end gap-2">
					<Button size="sm" variant="outline" onClick={goToday}>Today</Button>
					<div className="cal-view-toggle" role="group" aria-label="Calendar view">
						{['month', 'week', 'day'].map((mode) => (
							<button
								key={mode}
								type="button"
								className={view === mode ? 'is-active' : ''}
								onClick={() => setView(mode)}
							>
								{mode.charAt(0).toUpperCase() + mode.slice(1)}
							</button>
						))}
					</div>
					<Button size="sm" variant="outline" onClick={loadCalendar} disabled={loading}>
						{loading ? <Spinner className="h-4 w-4" /> : <RefreshCw size={14} />}
						Refresh
					</Button>
				</div>
				<div className="flex flex-wrap items-end gap-2">
					<div className="relative min-w-[11rem]">
						<label className="mb-1.5 block text-sm font-medium">Search</label>
						<Search size={14} className="pointer-events-none absolute left-3 top-[2.55rem] text-muted-foreground" />
						<input
							ref={searchRef}
							className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/20"
							placeholder="Search calendar…"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
						/>
					</div>
					<Select label="Website" value={websiteFilter} onChange={(e) => setWebsiteFilter(e.target.value)}>
						<option value="">All websites</option>
						{websiteOptions.map((id) => <option key={id} value={id}>{id}</option>)}
					</Select>
					<Select label="Account" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
						<option value="">All accounts</option>
						{accountOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
					</Select>
					<Select label="Board" value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)}>
						<option value="">All boards</option>
						{boardOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
					</Select>
					<Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
						<option value="">All statuses</option>
						<option value="scheduled">Scheduled</option>
						<option value="published">Published</option>
						<option value="failed">Failed</option>
						<option value="draft">Draft</option>
						<option value="queued">Queued</option>
					</Select>
					<Select label="Date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
						<option value="">Any day</option>
						<option value="today">Today</option>
						<option value="tomorrow">Tomorrow</option>
						<option value="week">This week</option>
					</Select>
				</div>
			</div>

			<div className="cal-atelier__stats">
				<div className="cal-stat">
					<p className="cal-stat__label">Scheduled Today</p>
					<p className="cal-stat__value">{stats.scheduledToday}</p>
				</div>
				<div className="cal-stat">
					<p className="cal-stat__label">Scheduled This Week</p>
					<p className="cal-stat__value">{stats.scheduledWeek}</p>
				</div>
				<div className="cal-stat">
					<p className="cal-stat__label">Pinterest Posts</p>
					<p className="cal-stat__value">{stats.pinterest}</p>
				</div>
				<div className="cal-stat">
					<p className="cal-stat__label">WordPress Posts</p>
					<p className="cal-stat__value">{stats.wordpress}</p>
					<p className="cal-stat__hint">Not on this calendar feed</p>
				</div>
				<div className="cal-stat">
					<p className="cal-stat__label">Pending Jobs</p>
					<p className="cal-stat__value">{stats.pending}</p>
				</div>
				<div className="cal-stat">
					<p className="cal-stat__label">Failed Jobs</p>
					<p className="cal-stat__value">{stats.failed}</p>
				</div>
			</div>

			<div className="cal-atelier__shell">
				<section className="cal-atelier__workspace p-4 sm:p-5">
					<div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex items-center gap-2">
							<button type="button" className="rounded-lg border border-border p-1.5 hover:bg-secondary" onClick={() => shiftCursor(-1)} aria-label="Previous">
								<ChevronLeft size={16} />
							</button>
							<h2 className="font-display text-lg font-semibold">{headerLabel}</h2>
							<button type="button" className="rounded-lg border border-border p-1.5 hover:bg-secondary" onClick={() => shiftCursor(1)} aria-label="Next">
								<ChevronRight size={16} />
							</button>
						</div>
						<div className="cal-quick">
							{QUICK_FILTERS.map((filter) => (
								<button
									key={filter.id}
									type="button"
									className={`cal-chip ${quickFilter === filter.id ? 'is-active' : ''}`}
									onClick={() => {
										setQuickFilter(filter.id);
										if (filter.id === 'today' || filter.id === 'tomorrow' || filter.id === 'week') {
											setDateFilter(filter.id === 'week' ? 'week' : filter.id);
										} else {
											setDateFilter('');
										}
										if (filter.id === 'scheduled' || filter.id === 'published' || filter.id === 'failed') {
											setStatusFilter(filter.id);
										} else if (filter.id === 'all') {
											setStatusFilter('');
										}
									}}
								>
									{filter.label}
								</button>
							))}
						</div>
					</div>

					{loading ? (
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="cal-skeleton" />)}
						</div>
					) : null}

					{!loading && showEmptyCalendar ? (
						<div className="cal-empty">
							<div className="cal-empty__art" aria-hidden="true" />
							<p className="font-display text-xl font-semibold">No scheduled content yet.</p>
							<p className="mt-2 max-w-md text-sm text-muted-foreground">
								Your Chef IA calendar will fill as you schedule Pinterest pins. Drag items between days to reschedule.
							</p>
							<Link to="/app/ai-pins" className="mt-5">
								<Button size="sm"><Pin size={14} /> Schedule your first Pinterest Pin</Button>
							</Link>
						</div>
					) : null}

					{!loading && !showEmptyCalendar && view === 'month' ? (
						<>
							<div className="cal-weekdays">
								{WEEKDAYS.map((day) => <div key={day}>{day}</div>)}
							</div>
							<div className="cal-month-grid">
								{days.map((date, index) => renderDayCell(date, index))}
							</div>
						</>
					) : null}

					{!loading && !showEmptyCalendar && view === 'week' ? (
						<>
							<div className="cal-weekdays">
								{weekDays.map((date) => (
									<div key={date.toISOString()}>
										{WEEKDAYS[date.getDay()]}
										<div className="mt-0.5 text-[11px] font-medium normal-case tracking-normal text-foreground">
											{date.getDate()}
										</div>
									</div>
								))}
							</div>
							<div className="cal-week-grid">
								{weekDays.map((date) => renderDayCell(date, date.toISOString(), {
									outside: date.getMonth() !== month,
								}))}
							</div>
						</>
					) : null}

					{!loading && !showEmptyCalendar && view === 'day' ? (
						<div
							className="cal-day-panel"
							onDragOver={(e) => e.preventDefault()}
							onDrop={() => handleDropToDay(cursor)}
						>
							<p className="text-sm text-muted-foreground">
								{jobsForDay(cursor).length} item{jobsForDay(cursor).length === 1 ? '' : 's'} · drag pins here to reschedule
							</p>
							{jobsForDay(cursor).length === 0 ? (
								<p className="mt-6 text-sm text-muted-foreground">Nothing scheduled for this day.</p>
							) : (
								jobsForDay(cursor).map((job) => (
									<button
										key={job.id}
										type="button"
										draggable
										onDragStart={() => setDraggingJobId(job.id)}
										onClick={() => setSelectedJob(job)}
										className={`cal-day-event ${selectedJob?.id === job.id ? 'is-selected' : ''}`}
									>
										{job.pin?.imageUrl ? (
											<img src={job.pin.imageUrl} alt="" loading="lazy" decoding="async" />
										) : (
											<div className="flex h-[4.25rem] w-[3.25rem] items-center justify-center rounded-[0.55rem] border border-border bg-secondary text-muted-foreground">
												<Pin size={16} />
											</div>
										)}
										<div className="min-w-0">
											<p className="truncate text-sm font-semibold">{job.pin?.title || 'Scheduled Pin'}</p>
											<p className="mt-0.5 truncate text-xs text-muted-foreground">
												{new Date(job.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
												{' · '}
												{boardLabel(job)}
											</p>
											<div className="mt-2"><Badge tone={statusTone(job.status)}>{formatStatus(job.status)}</Badge></div>
										</div>
									</button>
								))
							)}
						</div>
					) : null}
				</section>

				<aside className="cal-atelier__side p-4 space-y-4">
					<div>
						<h2 className="font-display text-lg font-semibold">Agenda & Details</h2>
						<p className="text-[11px] text-muted-foreground">Upcoming posts and selected pin inspector.</p>
					</div>

					<div>
						<div className="cal-agenda-section">
							<h3>Today</h3>
							{agenda.today.length === 0 ? (
								<p className="text-xs text-muted-foreground mb-2">Nothing scheduled today.</p>
							) : agenda.today.map((job) => (
								<button
									key={job.id}
									type="button"
									className={`cal-agenda-item ${selectedJob?.id === job.id ? 'is-selected' : ''}`}
									onClick={() => setSelectedJob(job)}
								>
									<span className="cal-agenda-item__time">
										{new Date(job.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
									</span>
									{job.pin?.imageUrl ? (
										<img src={job.pin.imageUrl} alt="" loading="lazy" decoding="async" />
									) : (
										<span className="flex h-[3.1rem] w-[2.4rem] items-center justify-center rounded-[0.4rem] border border-border bg-secondary text-muted-foreground"><Pin size={12} /></span>
									)}
									<span className="min-w-0">
										<span className="block truncate text-xs font-semibold">{job.pin?.title || 'Scheduled Pin'}</span>
										<span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{boardLabel(job)}</span>
										<span className="mt-1 inline-block"><Badge tone={statusTone(job.status)}>{formatStatus(job.status)}</Badge></span>
									</span>
								</button>
							))}
						</div>

						<div className="cal-agenda-section">
							<h3>Tomorrow</h3>
							{agenda.tomorrow.length === 0 ? (
								<p className="text-xs text-muted-foreground mb-2">Nothing scheduled tomorrow.</p>
							) : agenda.tomorrow.map((job) => (
								<button
									key={job.id}
									type="button"
									className={`cal-agenda-item ${selectedJob?.id === job.id ? 'is-selected' : ''}`}
									onClick={() => setSelectedJob(job)}
								>
									<span className="cal-agenda-item__time">
										{new Date(job.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
									</span>
									{job.pin?.imageUrl ? (
										<img src={job.pin.imageUrl} alt="" loading="lazy" decoding="async" />
									) : (
										<span className="flex h-[3.1rem] w-[2.4rem] items-center justify-center rounded-[0.4rem] border border-border bg-secondary text-muted-foreground"><Pin size={12} /></span>
									)}
									<span className="min-w-0">
										<span className="block truncate text-xs font-semibold">{job.pin?.title || 'Scheduled Pin'}</span>
										<span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{boardLabel(job)}</span>
										<span className="mt-1 inline-block"><Badge tone={statusTone(job.status)}>{formatStatus(job.status)}</Badge></span>
									</span>
								</button>
							))}
						</div>

						<div className="cal-agenda-section">
							<h3>Upcoming</h3>
							{agenda.upcoming.length === 0 ? (
								<p className="text-xs text-muted-foreground">No upcoming items in this month.</p>
							) : agenda.upcoming.map((job) => (
								<button
									key={job.id}
									type="button"
									className={`cal-agenda-item ${selectedJob?.id === job.id ? 'is-selected' : ''}`}
									onClick={() => setSelectedJob(job)}
								>
									<span className="cal-agenda-item__time">
										{new Date(job.scheduledAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
									</span>
									{job.pin?.imageUrl ? (
										<img src={job.pin.imageUrl} alt="" loading="lazy" decoding="async" />
									) : (
										<span className="flex h-[3.1rem] w-[2.4rem] items-center justify-center rounded-[0.4rem] border border-border bg-secondary text-muted-foreground"><Pin size={12} /></span>
									)}
									<span className="min-w-0">
										<span className="block truncate text-xs font-semibold">{job.pin?.title || 'Scheduled Pin'}</span>
										<span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{boardLabel(job)}</span>
										<span className="mt-1 inline-block"><Badge tone={statusTone(job.status)}>{formatStatus(job.status)}</Badge></span>
									</span>
								</button>
							))}
						</div>
					</div>

					<div className="border-t border-border/70 pt-4">
						<h3 className="mb-3 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Details</h3>
						{!selectedJob ? (
							<div className="rounded-2xl border border-dashed border-border bg-background/50 px-4 py-10 text-center">
								<div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
									<CalendarClock size={18} />
								</div>
								<p className="text-sm font-medium">Select a pin</p>
								<p className="mt-1 text-xs text-muted-foreground">Click a calendar card or agenda row to inspect it.</p>
							</div>
						) : (
							<div className="space-y-3">
								<div className="cal-preview">
									{selectedJob.pin?.imageUrl ? (
										<img src={selectedJob.pin.imageUrl} alt={selectedJob.pin?.title || 'Pin'} loading="lazy" decoding="async" />
									) : (
										<div className="cal-preview__empty"><Pin size={28} /></div>
									)}
								</div>
								<div>
									<p className="font-display text-lg font-semibold leading-snug">{selectedJob.pin?.title || 'Scheduled Pin'}</p>
									<div className="mt-2"><Badge tone={statusTone(selectedJob.status)}>{formatStatus(selectedJob.status)}</Badge></div>
								</div>
								<div className="cal-meta">
									<div className="cal-meta__row"><span>Website</span><span>{selectedJob.websiteId || '—'}</span></div>
									<div className="cal-meta__row"><span>Pinterest account</span><span>{accountLabel(selectedJob)}</span></div>
									<div className="cal-meta__row"><span>Board</span><span>{boardLabel(selectedJob)}</span></div>
									<div className="cal-meta__row">
										<span>Publish date</span>
										<span>{selectedJob.scheduledAt ? new Date(selectedJob.scheduledAt).toLocaleString() : '—'}</span>
									</div>
									<div className="cal-meta__row">
										<span>Created</span>
										<span>{selectedJob.createdAt ? new Date(selectedJob.createdAt).toLocaleString() : '—'}</span>
									</div>
									<div className="cal-meta__row"><span>Timezone</span><span>{selectedJob.timezone || 'UTC'}</span></div>
								</div>
								<div>
									<p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Prompt used</p>
									<div className="cal-box">{selectedJob.pin?.overlayText || selectedJob.pin?.description || 'No prompt text on this job.'}</div>
								</div>
								<div className="grid gap-2">
									<Button
										size="sm"
										variant="outline"
										disabled={!selectedJob.pin?.destinationUrl && !selectedJob.destinationUrl}
										onClick={() => {
											const url = selectedJob.pin?.destinationUrl || selectedJob.destinationUrl;
											if (url) window.open(url, '_blank', 'noopener,noreferrer');
										}}
									>
										<ExternalLink size={14} /> Open Article
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={!selectedJob.pinterestPinUrl}
										onClick={() => {
											if (selectedJob.pinterestPinUrl) {
												window.open(selectedJob.pinterestPinUrl, '_blank', 'noopener,noreferrer');
											}
										}}
									>
										<Pin size={14} /> Open Pinterest Pin
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={selectedJob.status !== 'failed' || retryingId === selectedJob.id}
										onClick={() => retryFailed(selectedJob.id)}
									>
										{retryingId === selectedJob.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />}
										Retry
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={selectedJob.status !== 'scheduled' || cancellingId === selectedJob.id}
										onClick={() => cancelScheduled(selectedJob.id)}
									>
										{cancellingId === selectedJob.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle size={14} />}
										Cancel
									</Button>
									<p className="text-[11px] text-muted-foreground">
										Reschedule by dragging the pin onto another day — same schedule PATCH as before.
									</p>
								</div>
							</div>
						)}
					</div>
				</aside>
			</div>
		</div>
	);
}
