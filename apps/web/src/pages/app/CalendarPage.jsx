import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarClock, Pin } from 'lucide-react';
import apiServerClient from '@/lib/apiServerClient';
import { Badge, Card, Empty, PageHeader, Spinner } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';

function sameDay(dateA, dateB) {
	return dateA.getFullYear() === dateB.getFullYear()
		&& dateA.getMonth() === dateB.getMonth()
		&& dateA.getDate() === dateB.getDate();
}

export default function CalendarPage() {
	const { toast } = useToast();
	const [cursor, setCursor] = useState(() => new Date());
	const [jobs, setJobs] = useState([]);
	const [loading, setLoading] = useState(true);
	const [draggingJobId, setDraggingJobId] = useState('');
	const [selectedJob, setSelectedJob] = useState(null);

	const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;

	const loadCalendar = async () => {
		setLoading(true);
		try {
			const response = await apiServerClient.fetch(`/pinterest/calendar?month=${monthKey}`, { method: 'GET' });
			const payload = await response.json().catch(() => []);
			if (!response.ok) {
				throw new Error(payload?.message || `Failed to load calendar (${response.status})`);
			}
			setJobs(Array.isArray(payload) ? payload : []);
		} catch (error) {
			toast({ variant: 'destructive', title: 'Error', description: error.message });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		loadCalendar();
	}, [monthKey]);

	const { days, month, year } = useMemo(() => {
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
		return { days: cells, month: m, year: y };
	}, [cursor]);

	const jobsForDay = (date) => jobs.filter((job) => sameDay(new Date(job.scheduledAt), date));

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
					timezone: dragged.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
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

	const label = cursor.toLocaleString('default', { month: 'long', year: 'numeric' });
	const today = new Date();

	return (
		<div>
			<PageHeader title="Pinterest Calendar" subtitle="Drag and drop scheduled pins to change their publication date." />

			<Card>
				<div className="mb-4 flex items-center justify-between">
					<h3 className="font-display text-lg font-600">{label}</h3>
					<div className="flex gap-1">
						<button className="rounded-lg border border-border p-1.5 hover:bg-secondary" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={16} /></button>
						<button className="rounded-lg border border-border p-1.5 hover:bg-secondary" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight size={16} /></button>
					</div>
				</div>

				{loading ? (
					<div className="flex items-center justify-center py-10 text-muted-foreground"><Spinner className="mr-2 h-4 w-4" /> Loading scheduled pins...</div>
				) : jobs.length === 0 ? (
					<Empty icon={CalendarClock} title="No scheduled pins" subtitle="Schedule pins from the AI Pins page to display them in calendar." />
				) : (
					<>
						<div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
							{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1">{d}</div>)}
						</div>
						<div className="mt-1 grid grid-cols-7 gap-1">
							{days.map((date, i) => {
								if (!date) {
									return <div key={i} className="min-h-24 rounded-lg" />;
								}

								const dayJobs = jobsForDay(date);
								const isToday = sameDay(date, today);

								return (
									<div
										key={i}
										className={`min-h-24 rounded-lg border p-1.5 ${isToday ? 'border-primary bg-primary/5' : 'border-border'} ${draggingJobId ? 'transition-colors hover:border-primary/60' : ''}`}
										onDragOver={(e) => e.preventDefault()}
										onDrop={() => handleDropToDay(date)}
									>
										<span className={`text-xs ${isToday ? 'font-bold text-primary' : 'text-muted-foreground'}`}>{date.getDate()}</span>
										<div className="mt-1 space-y-1">
											{dayJobs.slice(0, 3).map((job) => (
												<button
													key={job.id}
													type="button"
													draggable
													onDragStart={() => setDraggingJobId(job.id)}
													onClick={() => setSelectedJob(job)}
													className="flex w-full items-center gap-1 truncate rounded bg-red-500/15 px-1 py-0.5 text-[10px] text-left text-red-600 dark:text-red-400"
												>
													<Pin size={9} />
													<span className="truncate">{job.pin?.title || 'Scheduled Pin'}</span>
												</button>
											))}
											{dayJobs.length > 3 ? <span className="text-[10px] text-muted-foreground">+{dayJobs.length - 3} more</span> : null}
										</div>
									</div>
								);
							})}
						</div>
					</>
				)}
			</Card>

			{selectedJob ? (
				<Card className="mt-4">
					<div className="flex items-center justify-between">
						<h3 className="font-semibold">Pin Details</h3>
						<Badge tone={selectedJob.status === 'scheduled' ? 'amber' : 'default'}>{selectedJob.status}</Badge>
					</div>
					<div className="mt-3 space-y-1 text-sm text-muted-foreground">
						<p><span className="font-medium text-foreground">Title:</span> {selectedJob.pin?.title || '—'}</p>
						<p><span className="font-medium text-foreground">Board:</span> {selectedJob.boardName || selectedJob.boardId}</p>
						<p><span className="font-medium text-foreground">Scheduled:</span> {new Date(selectedJob.scheduledAt).toLocaleString()} ({selectedJob.timezone || 'UTC'})</p>
						<p><span className="font-medium text-foreground">Pin ID:</span> {selectedJob.aiPinId}</p>
					</div>
				</Card>
			) : null}
		</div>
	);
}
