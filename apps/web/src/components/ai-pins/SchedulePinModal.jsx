import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Card, Input, Select, Spinner } from '@/components/kit';
import {
	RECURRENCE_MODES,
	datetimeLocalToIso,
	isoToDatetimeLocal,
} from '@/services/ai-pins';

const COMMON_TIMEZONES = [
	'UTC',
	'America/New_York',
	'America/Chicago',
	'America/Denver',
	'America/Los_Angeles',
	'Europe/London',
	'Europe/Paris',
	'Europe/Berlin',
	'Asia/Dubai',
	'Asia/Tokyo',
	'Australia/Sydney',
];

export default function SchedulePinModal({
	open,
	onClose,
	onSubmit,
	submitting = false,
	accounts = [],
	boards = [],
	defaultAccountId = '',
	defaultBoardId = '',
	defaultTimezone = 'UTC',
	defaultScheduledAt = '',
	pinCount = 1,
}) {
	const [mode, setMode] = useState('once');
	const [dateTime, setDateTime] = useState('');
	const [timezone, setTimezone] = useState(defaultTimezone);
	const [endDate, setEndDate] = useState('');
	const [customIntervalDays, setCustomIntervalDays] = useState(3);
	const [accountId, setAccountId] = useState(defaultAccountId);
	const [boardId, setBoardId] = useState(defaultBoardId);
	const [error, setError] = useState('');

	useEffect(() => {
		if (!open) return;
		setMode('once');
		setDateTime(defaultScheduledAt ? isoToDatetimeLocal(defaultScheduledAt) : '');
		setTimezone(defaultTimezone || 'UTC');
		setEndDate('');
		setCustomIntervalDays(3);
		setAccountId(defaultAccountId || '');
		setBoardId(defaultBoardId || '');
		setError('');
	}, [open, defaultAccountId, defaultBoardId, defaultTimezone, defaultScheduledAt]);

	const timezoneOptions = useMemo(() => {
		const set = new Set([...COMMON_TIMEZONES, timezone].filter(Boolean));
		return [...set];
	}, [timezone]);

	if (!open) return null;

	const handleSubmit = async (event) => {
		event.preventDefault();
		setError('');
		try {
			if (!dateTime) throw new Error('Pick a date and time');
			if (!accountId) throw new Error('Select a Pinterest account');
			if (!boardId) throw new Error('Select a Pinterest board');
			await onSubmit?.({
				mode,
				scheduledAt: datetimeLocalToIso(dateTime),
				timezone,
				endAt: endDate ? datetimeLocalToIso(`${endDate}T23:59`) : '',
				customIntervalDays: Number(customIntervalDays) || 1,
				accountId,
				boardId,
			});
		} catch (err) {
			setError(err?.message || 'Failed to schedule');
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
			<Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<div>
						<h3 className="font-semibold">Schedule pin{pinCount > 1 ? 's' : ''}</h3>
						<p className="text-xs text-muted-foreground">
							{pinCount} pin{pinCount === 1 ? '' : 's'} · appears on Calendar when scheduled
						</p>
					</div>
					<button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
				</div>

				<form onSubmit={handleSubmit} className="space-y-3">
					<div>
						<p className="mb-1.5 text-xs font-medium text-muted-foreground">Recurrence</p>
						<div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
							{RECURRENCE_MODES.map((item) => (
								<button
									key={item.id}
									type="button"
									className={`rounded-xl border px-2 py-2 text-xs font-medium transition ${
										mode === item.id
											? 'border-primary bg-primary/10 text-foreground'
											: 'border-border bg-background text-muted-foreground hover:bg-secondary'
									}`}
									onClick={() => setMode(item.id)}
								>
									{item.label}
								</button>
							))}
						</div>
					</div>

					<Input
						label="Date & time"
						type="datetime-local"
						required
						value={dateTime}
						onChange={(e) => setDateTime(e.target.value)}
					/>

					<Select label="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
						{timezoneOptions.map((tz) => (
							<option key={tz} value={tz}>{tz}</option>
						))}
					</Select>

					{mode !== 'once' ? (
						<Input
							label="End date (optional)"
							type="date"
							value={endDate}
							onChange={(e) => setEndDate(e.target.value)}
						/>
					) : null}

					{mode === 'custom' ? (
						<Input
							label="Repeat every (days)"
							type="number"
							min={1}
							max={365}
							value={customIntervalDays}
							onChange={(e) => setCustomIntervalDays(e.target.value)}
						/>
					) : null}

					<Select label="Pinterest account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
						<option value="">Select account</option>
						{accounts.map((account) => (
							<option key={account.id} value={account.id}>
								{account.label || account.accountName || account.username}
							</option>
						))}
					</Select>

					<Select label="Pinterest board" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
						<option value="">Select board</option>
						{boards.map((board) => (
							<option key={board.id} value={board.boardId}>{board.name}</option>
						))}
					</Select>

					{error ? <p className="text-sm text-destructive">{error}</p> : null}

					<div className="flex gap-2 pt-2">
						<Button type="submit" className="flex-1" disabled={submitting}>
							{submitting ? <Spinner className="h-4 w-4" /> : null}
							Schedule
						</Button>
						<Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
					</div>
				</form>
			</Card>
		</div>
	);
}
