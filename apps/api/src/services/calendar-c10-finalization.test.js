import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CALENDAR_CONSOLIDATION_PHASE,
	CHANNEL_JOB_REF_TYPES,
	getCalendarArchitectureSnapshot,
	isOrphanChannelJobMirrorEvent,
} from './calendar/calendar-architecture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('unified calendar finalization (C10)', () => {
	it('locks phase C10 and single publish source of truth', () => {
		assert.equal(CALENDAR_CONSOLIDATION_PHASE, 'C10');
		const snapshot = getCalendarArchitectureSnapshot();
		assert.equal(snapshot.channelAgnostic, true);
		assert.equal(snapshot.writeSourceOfTruth, 'channel_job_collections');
		assert.equal(snapshot.productApi, 'unified_calendar_facade');
		assert.equal(snapshot.productReadPath, '/workspace/v1/calendar/events');
		assert.ok(CHANNEL_JOB_REF_TYPES.includes('pinterest_publish_jobs'));
		assert.ok(CHANNEL_JOB_REF_TYPES.includes('publish_jobs'));
		assert.ok(CHANNEL_JOB_REF_TYPES.includes('facebook_publish_jobs'));
		assert.match(
			snapshot.systems.workspaceCalendarEvents.notes,
			/PPJ interim merge retired|manual\/planned CE only/i,
		);
	});

	it('retires PPJ→CE publish merge from legacy listCalendarEvents', () => {
		const source = readFileSync(path.join(__dirname, 'workspace-calendar.js'), 'utf8');
		assert.doesNotMatch(source, /Interim dual-read merge/);
		assert.doesNotMatch(source, /fromJobs/);
		assert.doesNotMatch(source, /collection\(\s*['"]pinterest_publish_jobs['"]\s*\)/);
		assert.match(source, /channelJobMerge:\s*false/);
		assert.match(source, /isOrphanChannelJobMirrorEvent/);
	});

	it('excludes orphan channel-job mirror CE rows from legacy CE surface', () => {
		assert.equal(isOrphanChannelJobMirrorEvent({ refType: 'pinterest_publish_jobs' }), true);
		assert.equal(isOrphanChannelJobMirrorEvent({ refType: 'publish_jobs' }), true);
		assert.equal(isOrphanChannelJobMirrorEvent({ refType: 'facebook_publish_jobs' }), true);
		assert.equal(isOrphanChannelJobMirrorEvent({ refType: 'manual_plan' }), false);
		assert.equal(isOrphanChannelJobMirrorEvent({ refType: '' }), false);
	});

	it('keeps provider and mutation registries complete for all channels', () => {
		const providerRegistry = readFileSync(
			path.join(__dirname, 'calendar/providers/registry.js'),
			'utf8',
		);
		assert.match(providerRegistry, /createPinterestCalendarProvider/);
		assert.match(providerRegistry, /createWordpressCalendarProvider/);
		assert.match(providerRegistry, /createFacebookCalendarProvider/);
		assert.match(providerRegistry, /createStudioCalendarProvider/);
		assert.match(providerRegistry, /createDraftOverlayProvider/);
		assert.match(providerRegistry, /createManualOverlayProvider/);

		const mutationRegistry = readFileSync(
			path.join(__dirname, 'calendar/mutations/registry.js'),
			'utf8',
		);
		assert.match(mutationRegistry, /createLivePinterestMutationAdapter/);
		assert.match(mutationRegistry, /createLiveWordpressMutationAdapter/);
		assert.match(mutationRegistry, /createLiveFacebookMutationAdapter/);
	});

	it('keeps facade and mutation router free of channel write / merge logic', () => {
		const facade = readFileSync(path.join(__dirname, 'calendar/facade.js'), 'utf8');
		assert.doesNotMatch(facade, /pinterest_publish_jobs|fromJobs|Interim dual-read/);
		assert.match(facade, /no PPJ merge/i);

		const router = readFileSync(path.join(__dirname, 'calendar/mutations/router.js'), 'utf8');
		assert.doesNotMatch(router, /facebook_publish_jobs|pinterest_publish_jobs|publish_jobs/);
		assert.doesNotMatch(router, /createFacebookMutationAdapter|createPinterestMutationAdapter/);
	});
});
