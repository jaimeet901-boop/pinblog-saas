import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Card, Input, Select, Spinner, Textarea } from '@/components/kit';

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

function detectTimezone() {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}

function pad(n) {
	return String(n).padStart(2, '0');
}

function defaultDateParts(hoursAhead = 1) {
	const date = new Date(Date.now() + hoursAhead * 3600000);
	return {
		date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
		time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
	};
}

/**
 * Convert wall-clock date + time in `timeZone` to a UTC ISO string.
 * Keeps the existing /wordpress/schedule contract (scheduledAt ISO).
 */
export function scheduleWallTimeToIso(dateStr, timeStr, timeZone) {
	const tz = String(timeZone || '').trim() || detectTimezone();
	const dateParts = String(dateStr || '').trim().split('-').map(Number);
	const timeParts = String(timeStr || '').trim().split(':').map(Number);
	const [year, month, day] = dateParts;
	const [hour, minute] = timeParts;
	if (
		dateParts.length !== 3
		|| timeParts.length < 2
		|| ![year, month, day, hour, minute].every((n) => Number.isFinite(n))
	) {
		throw new Error('Enter a valid date and time.');
	}

	let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
	for (let i = 0; i < 3; i += 1) {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
		}).formatToParts(new Date(utcMs));
		const read = (type) => Number(parts.find((part) => part.type === type)?.value);
		const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), 0);
		const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
		utcMs += wanted - asUtc;
	}

	const result = new Date(utcMs);
	if (Number.isNaN(result.getTime())) {
		throw new Error('Enter a valid date and time.');
	}
	return result.toISOString();
}

function validateScheduleFields({ date, time, timezone }) {
	const errors = {};
	if (!String(date || '').trim()) errors.date = 'Date is required.';
	else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())) errors.date = 'Enter a valid date.';

	if (!String(time || '').trim()) errors.time = 'Time is required.';
	else if (!/^\d{2}:\d{2}(:\d{2})?$/.test(String(time).trim())) errors.time = 'Enter a valid time.';

	if (!String(timezone || '').trim()) errors.timezone = 'Timezone is required.';

	if (!errors.date && !errors.time && !errors.timezone) {
		try {
			const iso = scheduleWallTimeToIso(date, time, timezone);
			if (new Date(iso).getTime() <= Date.now() + 30_000) {
				errors.time = 'Choose a time in the future.';
			}
		} catch (err) {
			errors.date = err?.message || 'Enter a valid date and time.';
		}
	}

	return errors;
}

/**
 * Writer WordPress schedule dialog — UI only.
 * Submits scheduledAt ISO via existing publish/schedule flow.
 */
export default function WriterScheduleModal({
	open,
	onClose,
	onSubmit,
	submitting = false,
	defaultTimezone = '',
}) {
	const detectedTz = useMemo(() => detectTimezone(), []);
	const [date, setDate] = useState('');
	const [time, setTime] = useState('');
	const [timezone, setTimezone] = useState(detectedTz);
	const [note, setNote] = useState('');
	const [fieldErrors, setFieldErrors] = useState({});
	const [formError, setFormError] = useState('');
	const backdropPointerDownRef = useRef(false);
	const submitLockRef = useRef(false);

	useEffect(() => {
		if (!open) return;
		const next = defaultDateParts(1);
		setDate(next.date);
		setTime(next.time);
		setTimezone(defaultTimezone || detectedTz);
		setNote('');
		setFieldErrors({});
		setFormError('');
		submitLockRef.current = false;
		backdropPointerDownRef.current = false;
	}, [open, defaultTimezone, detectedTz]);

	useEffect(() => {
		if (!open) return undefined;
		const onKey = (event) => {
			if (event.key === 'Escape' && !submitting) onClose?.();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, onClose, submitting]);

	const timezoneOptions = useMemo(() => {
		const set = new Set([
			...COMMON_TIMEZONES,
			detectedTz,
			defaultTimezone,
			timezone,
		].filter(Boolean));
		return [...set];
	}, [detectedTz, defaultTimezone, timezone]);

	if (!open) return null;

	const handleBackdropPointerDown = (event) => {
		backdropPointerDownRef.current = event.target === event.currentTarget;
	};

	const handleBackdropClick = (event) => {
		const pressedOnBackdrop = backdropPointerDownRef.current;
		backdropPointerDownRef.current = false;
		if (submitting) return;
		if (event.target !== event.currentTarget) return;
		if (!pressedOnBackdrop) return;
		onClose?.();
	};

	const handleSubmit = async (event) => {
		event.preventDefault();
		if (submitting || submitLockRef.current) return;

		const errors = validateScheduleFields({ date, time, timezone });
		setFieldErrors(errors);
		setFormError('');
		if (Object.keys(errors).length) return;

		submitLockRef.current = true;
		try {
			const scheduledAt = scheduleWallTimeToIso(date, time, timezone);
			await onSubmit?.({
				scheduledAt,
				timezone,
				note: String(note || '').trim(),
				date,
				time,
			});
		} catch (err) {
			setFormError(err?.message || 'Scheduling failed. Please try again.');
		} finally {
			submitLockRef.current = false;
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onPointerDown={handleBackdropPointerDown}
			onClick={handleBackdropClick}
			role="presentation"
		>
			<Card
				className="w-full max-w-md max-h-[90vh] overflow-y-auto"
				onClick={(e) => e.stopPropagation()}
				onPointerDown={(e) => e.stopPropagation()}
			>
				<div className="mb-4 flex items-start justify-between gap-3">
					<div>
						<h3 className="font-semibold">Schedule WordPress publish</h3>
						<p className="mt-1 text-xs text-muted-foreground">
							Pick when this article should go live. Default timezone is detected from your browser.
						</p>
					</div>
					<button
						type="button"
						onClick={() => !submitting && onClose?.()}
						aria-label="Close"
						disabled={submitting}
						className="rounded-md p-1 text-muted-foreground hover:bg-secondary disabled:opacity-50"
					>
						<X size={18} />
					</button>
				</div>

				<form onSubmit={handleSubmit} className="space-y-3" noValidate>
					<div>
						<Input
							label="Date"
							type="date"
							value={date}
							onChange={(e) => {
								setDate(e.target.value);
								setFieldErrors((prev) => ({ ...prev, date: undefined }));
							}}
							required
							aria-invalid={Boolean(fieldErrors.date)}
						/>
						{fieldErrors.date ? (
							<p className="mt-1 text-[11px] text-destructive">{fieldErrors.date}</p>
						) : null}
					</div>

					<div>
						<Input
							label="Time"
							type="time"
							value={time}
							onChange={(e) => {
								setTime(e.target.value);
								setFieldErrors((prev) => ({ ...prev, time: undefined }));
							}}
							required
							aria-invalid={Boolean(fieldErrors.time)}
						/>
						{fieldErrors.time ? (
							<p className="mt-1 text-[11px] text-destructive">{fieldErrors.time}</p>
						) : null}
					</div>

					<div>
						<Select
							label="Timezone"
							value={timezone}
							onChange={(e) => {
								setTimezone(e.target.value);
								setFieldErrors((prev) => ({ ...prev, timezone: undefined }));
							}}
						>
							{timezoneOptions.map((tz) => (
								<option key={tz} value={tz}>
									{tz === detectedTz ? `${tz} (detected)` : tz}
								</option>
							))}
						</Select>
						{fieldErrors.timezone ? (
							<p className="mt-1 text-[11px] text-destructive">{fieldErrors.timezone}</p>
						) : (
							<p className="mt-1 text-[11px] text-muted-foreground">
								Auto-detected: {detectedTz}. You can change it before scheduling.
							</p>
						)}
					</div>

					<Textarea
						label="Note (optional)"
						rows={2}
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder="Internal reminder — not sent to WordPress"
					/>

					{formError ? (
						<div className="rounded-xl border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
							{formError}
						</div>
					) : null}

					<div className="flex flex-wrap justify-end gap-2 pt-1">
						<Button type="button" variant="outline" onClick={() => onClose?.()} disabled={submitting}>
							Cancel
						</Button>
						<Button type="submit" disabled={submitting}>
							{submitting ? (
								<>
									<Spinner className="h-4 w-4" /> Scheduling…
								</>
							) : (
								'Schedule'
							)}
						</Button>
					</div>
				</form>
			</Card>
		</div>
	);
}
