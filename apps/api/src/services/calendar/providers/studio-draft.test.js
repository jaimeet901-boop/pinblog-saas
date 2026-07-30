import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectScheduledItems } from '../facade.js';
import { parseCalendarFacadeQuery } from '../query.js';
import { createPinterestCalendarProvider } from './pinterest.js';
import {
	createStudioCalendarProvider,
	isStudioScheduledPin,
	mapStudioPinToScheduledItem,
	STUDIO_CALENDAR_CHANNEL,
	STUDIO_PIN_REF_TYPE,
} from './studio.js';
import {
	createDraftOverlayProvider,
	draftsRequested,
	isStudioDraftPin,
	mapDraftPinToScheduledItem,
	DRAFT_CALENDAR_CHANNEL,
	DRAFT_REF_TYPE,
} from './draft-overlay.js';
import { buildStudioPinHref } from '../studio-links.js';
import { CALENDAR_CONSOLIDATION_PHASE } from '../calendar-architecture.js';
import { PRODUCT_CALENDAR_READ_DEFAULTS } from '../product-calendar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('studio + draft calendar overlays (C7)', () => {
	it('locks phase C10 and registers studio + draft providers', () => {
		assert.equal(CALENDAR_CONSOLIDATION_PHASE, 'C10');
		assert.equal(PRODUCT_CALENDAR_READ_DEFAULTS.includeDrafts, false);

		const registry = readFileSync(path.join(__dirname, 'registry.js'), 'utf8');
		assert.match(registry, /createStudioCalendarProvider/);
		assert.match(registry, /createDraftOverlayProvider/);
		assert.match(registry, /fetchStudioPinsForCalendar/);
		assert.match(registry, /fetchStudioDraftsForCalendar/);

		assert.equal(typeof createStudioCalendarProvider, 'function');
		assert.equal(typeof createDraftOverlayProvider, 'function');
	});

	it('maps scheduled Studio pins with deep links back to Content Studio', () => {
		const item = mapStudioPinToScheduledItem({
			id: 'pin1',
			status: 'scheduled',
			scheduled_at: '2026-07-20T10:00:00.000Z',
			title: 'Studio scheduled',
			websiteId: 'site-1',
			image_url: 'https://cdn/p.png',
		});

		assert.equal(item.channel, STUDIO_CALENDAR_CHANNEL);
		assert.equal(item.refType, STUDIO_PIN_REF_TYPE);
		assert.equal(item.id, 'studio:pin1');
		assert.equal(item.deepLinks.studioPinId, 'pin1');
		assert.equal(item.deepLinks.studioHref, buildStudioPinHref({ pinId: 'pin1', websiteId: 'site-1' }));
		assert.match(item.deepLinks.studioHref, /pinId=pin1/);
		assert.deepEqual(item.actions, []);
		assert.equal(item.readOnly, true);
	});

	it('skips drafts and pins already owned by a publish job', () => {
		assert.equal(isStudioScheduledPin({ id: 'a', status: 'draft', scheduled_at: '2026-07-01T00:00:00.000Z' }), false);
		assert.equal(isStudioScheduledPin({
			id: 'b',
			status: 'scheduled',
			scheduled_at: '2026-07-01T00:00:00.000Z',
			publish_job_id: 'job1',
		}), false);
		assert.equal(isStudioScheduledPin({
			id: 'c',
			status: 'scheduled',
			scheduled_at: '2026-07-01T00:00:00.000Z',
		}), true);
	});

	it('maps drafts as informational overlay items (never publish jobs)', () => {
		const item = mapDraftPinToScheduledItem({
			id: 'd1',
			status: 'draft',
			title: 'WIP',
			websiteId: 'site-1',
			updated: '2026-07-12T08:00:00.000Z',
			created: '2026-07-10T08:00:00.000Z',
		});

		assert.equal(item.channel, DRAFT_CALENDAR_CHANNEL);
		assert.equal(item.refType, DRAFT_REF_TYPE);
		assert.equal(item.status, 'draft');
		assert.equal(item.scheduledAt, '2026-07-12T08:00:00.000Z');
		assert.deepEqual(item.actions, []);
		assert.equal(item.readOnly, true);
		assert.equal(item.deepLinks.informational, true);
		assert.equal(isStudioDraftPin({ status: 'scheduled' }), false);
		assert.equal(isStudioDraftPin({ status: 'draft', publish_job_id: 'x' }), false);
	});

	it('keeps drafts off by default and filterable independently', async () => {
		assert.equal(draftsRequested(parseCalendarFacadeQuery({ month: '2026-07' })), false);
		assert.equal(draftsRequested(parseCalendarFacadeQuery({ month: '2026-07', includeDrafts: 'true' })), true);
		assert.equal(draftsRequested(parseCalendarFacadeQuery({ month: '2026-07', channels: 'draft' })), true);

		const studio = createStudioCalendarProvider({
			fetchPins: async () => [{
				id: 's1',
				status: 'scheduled',
				scheduled_at: '2026-07-15T10:00:00.000Z',
				title: 'Scheduled studio',
				websiteId: 'site-1',
			}],
		});
		const drafts = createDraftOverlayProvider({
			fetchDrafts: async () => [{
				id: 'd1',
				status: 'draft',
				title: 'Draft',
				websiteId: 'site-1',
				updated: '2026-07-16T10:00:00.000Z',
			}],
		});
		const pinterest = createPinterestCalendarProvider({
			fetchJobs: async () => [{
				id: 'p1',
				status: 'scheduled',
				scheduled_at: '2026-07-14T10:00:00.000Z',
				title: 'Pin job',
				websiteId: 'site-1',
				ai_pin: 'pin-from-job',
			}],
		});

		const withoutDrafts = await collectScheduledItems(
			{ req: {} },
			parseCalendarFacadeQuery({ month: '2026-07' }),
			[pinterest, studio, drafts],
		);
		assert.deepEqual(
			withoutDrafts.map((item) => item.id).sort(),
			['pinterest:p1', 'studio:s1'],
		);
		assert.ok(withoutDrafts.every((item) => item.channel !== 'draft'));

		const withDrafts = await collectScheduledItems(
			{ req: {} },
			parseCalendarFacadeQuery({ month: '2026-07', includeDrafts: 'true' }),
			[pinterest, studio, drafts],
		);
		assert.ok(withDrafts.some((item) => item.id === 'draft:d1'));
		assert.ok(withDrafts.some((item) => item.id === 'studio:s1'));

		const draftsOnly = await collectScheduledItems(
			{ req: {} },
			parseCalendarFacadeQuery({ month: '2026-07', channels: 'draft' }),
			[pinterest, studio, drafts],
		);
		assert.deepEqual(draftsOnly.map((item) => item.id), ['draft:d1']);
		assert.ok(draftsOnly.every((item) => item.actions.length === 0));
	});

	it('attaches Studio href on Pinterest projections for Open in Studio', async () => {
		const { mapPinterestJobToScheduledItem } = await import('./pinterest.js');
		const item = mapPinterestJobToScheduledItem({
			id: 'job9',
			status: 'scheduled',
			scheduled_at: '2026-07-18T10:00:00.000Z',
			websiteId: 'site-9',
			ai_pin: 'pin9',
			expand: { ai_pin: { id: 'pin9', title: 'From job' } },
		});
		assert.equal(item.deepLinks.studioPinId, 'pin9');
		assert.equal(
			item.deepLinks.studioHref,
			buildStudioPinHref({ pinId: 'pin9', websiteId: 'site-9' }),
		);
	});
});
