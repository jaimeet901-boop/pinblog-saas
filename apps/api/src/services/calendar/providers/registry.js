/**
 * Default provider registry for the Unified Calendar Facade.
 * Add future channels / projection hooks here without changing facade.js.
 */

import { createDraftOverlayProvider } from './draft-overlay.js';
import { fetchStudioDraftsForCalendar } from './draft-overlay-source.js';
import { createFacebookCalendarProvider } from './facebook.js';
import { fetchFacebookPublishJobsForCalendar } from './facebook-source.js';
import { createManualOverlayProvider } from './manual-overlay.js';
import { fetchCalendarEventsForOverlay } from './manual-overlay-source.js';
import { createPinterestCalendarProvider } from './pinterest.js';
import { fetchPinterestPublishJobsForCalendar } from './pinterest-source.js';
import { createStudioCalendarProvider } from './studio.js';
import { fetchStudioPinsForCalendar } from './studio-source.js';
import { createWordpressCalendarProvider } from './wordpress.js';
import { fetchWordpressPublishJobsForCalendar } from './wordpress-source.js';
import { resolveQueueMirrorForSource } from '../projections/queue-mirror-source.js';

export function createDefaultCalendarProviders() {
	return [
		createPinterestCalendarProvider({
			fetchJobs: fetchPinterestPublishJobsForCalendar,
			resolveQueueMirror: resolveQueueMirrorForSource,
		}),
		createWordpressCalendarProvider({
			fetchJobs: fetchWordpressPublishJobsForCalendar,
			resolveQueueMirror: resolveQueueMirrorForSource,
		}),
		createFacebookCalendarProvider({
			fetchJobs: fetchFacebookPublishJobsForCalendar,
			resolveQueueMirror: resolveQueueMirrorForSource,
		}),
		createStudioCalendarProvider({
			fetchPins: fetchStudioPinsForCalendar,
		}),
		createDraftOverlayProvider({
			fetchDrafts: fetchStudioDraftsForCalendar,
		}),
		createManualOverlayProvider({
			fetchEvents: fetchCalendarEventsForOverlay,
		}),
	];
}
