/**
 * READ-ONLY C0 inventory: calendar_events vs channel job schedules.
 *
 * Always prints the static architecture snapshot.
 * When PocketBase credentials are present, also prints live row counts.
 *
 * Usage:
 *   node --env-file=.env scripts/inventory-calendar-sources.mjs
 *   npm run inventory:calendar
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CALENDAR_EVENTS_READERS,
	CALENDAR_EVENTS_WRITE_ALLOWLIST,
	CHANNEL_JOB_REF_TYPES,
	getCalendarArchitectureSnapshot,
} from '../src/services/calendar/calendar-architecture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadPocketBase() {
	const packageJsonCandidates = [
		'/app/apps/api/package.json',
		'/app/package.json',
		path.join(process.cwd(), 'package.json'),
		path.join(process.cwd(), 'apps/api/package.json'),
		path.join(__dirname, '../package.json'),
	];

	const errors = [];
	for (const packageJsonPath of packageJsonCandidates) {
		if (!existsSync(packageJsonPath)) continue;
		try {
			const require = createRequire(packageJsonPath);
			const mod = require('pocketbase');
			return mod?.default || mod;
		} catch (error) {
			errors.push(`${packageJsonPath}: ${error?.message || error}`);
		}
	}

	throw new Error(`Cannot resolve package "pocketbase". Tried:\n${errors.join('\n')}`);
}

function summarizeBy(rows, keyFn) {
	const counts = {};
	for (const row of rows) {
		const key = keyFn(row) || '(empty)';
		counts[key] = (counts[key] || 0) + 1;
	}
	return counts;
}

async function fetchAll(pb, collection, options = {}) {
	const items = [];
	let page = 1;
	const perPage = 200;
	for (;;) {
		const result = await pb.collection(collection).getList(page, perPage, {
			...options,
			requestKey: null,
		});
		items.push(...(result.items || []));
		if (page >= (result.totalPages || 1)) break;
		page += 1;
	}
	return items;
}

function printSection(title) {
	console.log(`\n=== ${title} ===`);
}

printSection('Static architecture (C0)');
const snapshot = getCalendarArchitectureSnapshot();
console.log(JSON.stringify({
	phase: snapshot.phase,
	channelAgnostic: snapshot.channelAgnostic,
	productApi: snapshot.productApi,
	writeSourceOfTruth: snapshot.writeSourceOfTruth,
	calendarEventsRole: snapshot.calendarEventsRole,
	channelJobRefTypes: snapshot.channelJobRefTypes,
	systems: snapshot.systems,
	writeAllowlist: CALENDAR_EVENTS_WRITE_ALLOWLIST,
	readers: CALENDAR_EVENTS_READERS,
	docs: snapshot.docs,
}, null, 2));

const PB_BASE_URL = String(process.env.PB_BASE_URL || '').trim();
const PB_SUPERUSER_EMAIL = String(process.env.PB_SUPERUSER_EMAIL || '').trim();
const PB_SUPERUSER_PASSWORD = String(process.env.PB_SUPERUSER_PASSWORD || '').trim();

if (!PB_BASE_URL || !PB_SUPERUSER_EMAIL || !PB_SUPERUSER_PASSWORD) {
	printSection('Live inventory');
	console.log('Skipped: set PB_BASE_URL / PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD to count live rows.');
	console.log('\nC0 static inventory complete.');
	process.exit(0);
}

const PocketBase = loadPocketBase();
const pb = new PocketBase(PB_BASE_URL);
pb.autoCancellation(false);

try {
	await pb.collection('_superusers').authWithPassword(PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD);
} catch (error) {
	printSection('Live inventory');
	console.error('PocketBase auth failed:', error?.message || error);
	console.log('Static inventory above remains valid for C0.');
	process.exit(0);
}

printSection('Live calendar_events');
const calendarEvents = await fetchAll(pb, 'calendar_events', { sort: 'scheduled_at' }).catch((error) => {
	console.error('Failed to list calendar_events:', error?.message || error);
	return null;
});

if (calendarEvents) {
	const byStatus = summarizeBy(calendarEvents, (row) => row.status);
	const byEventType = summarizeBy(calendarEvents, (row) => row.event_type);
	const byRefType = summarizeBy(calendarEvents, (row) => row.ref_type);
	const channelMirrors = calendarEvents.filter((row) => (
		CHANNEL_JOB_REF_TYPES.includes(String(row.ref_type || '').toLowerCase())
	));
	const manualLike = calendarEvents.filter((row) => !String(row.ref_type || '').trim());

	console.log(JSON.stringify({
		total: calendarEvents.length,
		byStatus,
		byEventType,
		byRefType,
		channelJobMirrors: channelMirrors.length,
		manualOrUnreferenced: manualLike.length,
		sample: calendarEvents.slice(0, 10).map((row) => ({
			id: row.id,
			workspace: row.workspace,
			title: row.title,
			status: row.status,
			event_type: row.event_type,
			ref_type: row.ref_type || '',
			ref_id: row.ref_id || '',
			scheduled_at: row.scheduled_at,
		})),
	}, null, 2));
}

printSection('Live pinterest_publish_jobs (schedule-relevant)');
const publishJobs = await fetchAll(pb, 'pinterest_publish_jobs', { sort: '-scheduled_at' }).catch((error) => {
	console.error('Failed to list pinterest_publish_jobs:', error?.message || error);
	return null;
});

if (publishJobs) {
	const withSchedule = publishJobs.filter((row) => row.scheduled_at);
	const byStatus = summarizeBy(publishJobs, (row) => row.status);
	const scheduled = publishJobs.filter((row) => String(row.status || '') === 'scheduled');
	const scheduledWithAt = scheduled.filter((row) => row.scheduled_at);

	console.log(JSON.stringify({
		total: publishJobs.length,
		withScheduledAt: withSchedule.length,
		byStatus,
		statusScheduled: scheduled.length,
		statusScheduledWithScheduledAt: scheduledWithAt.length,
		sampleScheduled: scheduledWithAt.slice(0, 10).map((row) => ({
			id: row.id,
			owner: row.owner,
			workspace: row.workspace || null,
			title: row.title,
			status: row.status,
			scheduled_at: row.scheduled_at,
			websiteId: row.websiteId || row.website_id || null,
		})),
	}, null, 2));
}

printSection('C0 comparison');
if (calendarEvents && publishJobs) {
	const ceTotal = calendarEvents.length;
	const ppjScheduled = publishJobs.filter((row) => String(row.status || '') === 'scheduled' && row.scheduled_at).length;
	const ceChannelMirrors = calendarEvents.filter((row) => (
		CHANNEL_JOB_REF_TYPES.includes(String(row.ref_type || '').toLowerCase())
	)).length;

	console.log(JSON.stringify({
		calendar_events_total: ceTotal,
		pinterest_publish_jobs_scheduled_with_at: ppjScheduled,
		calendar_events_channel_job_mirrors: ceChannelMirrors,
		divergenceHint: ceTotal === 0 && ppjScheduled > 0
			? 'Product Calendar uses Unified Facade (channel jobs). Empty CE is fine for publishes (C10).'
			: ceChannelMirrors > 0
				? 'Orphan CE channel-job mirrors remain in storage; legacy GET /calendar excludes them (C10). Optional DB archive.'
				: 'CE is manual/planned overlay only; publish SoT is channel job collections (C10).',
	}, null, 2));
}

console.log('\nC10 inventory note: PPJ→CE list merge retired. Dual-write freeze remains in workspace-calendar.js.');
process.exit(0);
