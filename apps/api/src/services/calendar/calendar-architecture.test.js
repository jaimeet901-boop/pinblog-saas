import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	assertCalendarEventsNotChannelJobMirror,
	CALENDAR_CONSOLIDATION_PHASE,
	CALENDAR_EVENTS_WRITE_ALLOWLIST,
	CHANNEL_JOB_REF_TYPES,
	getCalendarArchitectureSnapshot,
	isChannelJobRefType,
	SCHEDULED_ITEM_CONTRACT_FIELDS,
	UNIFIED_CALENDAR_EVENTS_PATH,
} from './calendar-architecture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiSrcRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(apiSrcRoot, '../../..');

function walkJsFiles(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			if (entry === 'node_modules' || entry === 'dist') continue;
			walkJsFiles(full, out);
			continue;
		}
		if (/\.(js|mjs|cjs)$/.test(entry)) out.push(full);
	}
	return out;
}

function toRepoRelative(filePath) {
	return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

describe('calendar-architecture (C0)', () => {
	it('locks phase C10 and channel-agnostic snapshot', () => {
		assert.equal(CALENDAR_CONSOLIDATION_PHASE, 'C10');
		const snapshot = getCalendarArchitectureSnapshot();
		assert.equal(snapshot.channelAgnostic, true);
		assert.equal(snapshot.writeSourceOfTruth, 'channel_job_collections');
		assert.equal(snapshot.productApi, 'unified_calendar_facade');
		assert.equal(snapshot.productReadPath, UNIFIED_CALENDAR_EVENTS_PATH);
		assert.ok(CHANNEL_JOB_REF_TYPES.includes('pinterest_publish_jobs'));
		assert.ok(CHANNEL_JOB_REF_TYPES.includes('publish_jobs'));
		assert.ok(CHANNEL_JOB_REF_TYPES.includes('facebook_publish_jobs'));
		assert.ok(SCHEDULED_ITEM_CONTRACT_FIELDS.includes('channel'));
		assert.ok(SCHEDULED_ITEM_CONTRACT_FIELDS.includes('id'));
		assert.ok(SCHEDULED_ITEM_CONTRACT_FIELDS.includes('website'));
		assert.ok(!snapshot.calendarEventsReaders.includes('apps/api/src/services/workspace-dashboard.js'));
	});

	it('freezes dual-write payloads that mirror channel jobs', () => {
		assert.equal(isChannelJobRefType('pinterest_publish_jobs'), true);
		assert.equal(isChannelJobRefType('manual_plan'), false);

		assert.throws(
			() => assertCalendarEventsNotChannelJobMirror({ refType: 'pinterest_publish_jobs' }),
			(error) => error?.status === 422 && error?.errorCode === 'CALENDAR_DUAL_WRITE_FROZEN',
		);
		assert.throws(
			() => assertCalendarEventsNotChannelJobMirror({
				eventType: 'publish',
				meta: { source: 'pinterest' },
			}),
			(error) => error?.errorCode === 'CALENDAR_DUAL_WRITE_FROZEN',
		);

		assert.doesNotThrow(() => assertCalendarEventsNotChannelJobMirror({
			title: 'Manual plan',
			eventType: 'schedule',
			refType: '',
		}));
		assert.doesNotThrow(() => assertCalendarEventsNotChannelJobMirror({
			title: 'Reminder',
			eventType: 'reminder',
			refType: 'manual_plan',
		}));
	});

	it('keeps calendar_events writers inside the allowlist', () => {
		const writers = [];
		const createOrUpdate = /collection\(\s*['"]calendar_events['"]\s*\)\s*\.\s*(create|update)\s*\(/g;

		for (const file of walkJsFiles(apiSrcRoot)) {
			const source = readFileSync(file, 'utf8');
			if (!createOrUpdate.test(source)) continue;
			createOrUpdate.lastIndex = 0;
			writers.push(toRepoRelative(file));
		}

		const unexpected = writers.filter((file) => !CALENDAR_EVENTS_WRITE_ALLOWLIST.includes(file));
		assert.deepEqual(
			unexpected,
			[],
			`New calendar_events writers require architecture review. Unexpected: ${unexpected.join(', ') || '(none)'}. Allowlist: ${CALENDAR_EVENTS_WRITE_ALLOWLIST.join(', ')}`,
		);
		assert.ok(
			writers.includes('apps/api/src/services/workspace-calendar.js'),
			'Expected workspace-calendar.js to remain the sole CE writer',
		);
	});

	it('requires architecture ADR on disk', () => {
		const adr = path.join(repoRoot, 'docs/calendar-architecture.md');
		const text = readFileSync(adr, 'utf8');
		assert.match(text, /Channel-agnostic Calendar/i);
		assert.match(text, /Unified Calendar Facade/i);
		assert.match(text, /Dual-write freeze/i);
		assert.match(text, /Phase \*\*C10\*\*/);
		assert.match(text, /\/workspace\/v1\/calendar\/events/);
		assert.match(text, /CalendarPage/);
		assert.match(text, /Dashboard/i);
		assert.match(text, /CE-first/i);
		assert.match(text, /status/i);
		assert.match(text, /website/i);
		assert.match(text, /Mutation Router/i);
		assert.match(text, /WordPress/i);
		assert.match(text, /Studio/i);
		assert.match(text, /[Dd]raft/);
		assert.match(text, /Queue/i);
		assert.match(text, /Analytics/i);
		assert.match(text, /Notification/i);
		assert.match(text, /Facebook/i);
		assert.match(text, /PPJ|merge retired|orphan CE/i);
	});

	it('keeps facade and mutation router cores free of channel write logic', () => {
		const facade = readFileSync(path.join(__dirname, 'facade.js'), 'utf8');
		assert.doesNotMatch(facade, /facebook_publish_jobs|pinterest_publish_jobs|publish_jobs/);
		assert.doesNotMatch(facade, /mapFacebookJobToScheduledItem|mapPinterestJobToScheduledItem/);

		const router = readFileSync(path.join(__dirname, 'mutations/router.js'), 'utf8');
		assert.doesNotMatch(router, /facebook_publish_jobs|createFacebookMutationAdapter/);
	});
});
