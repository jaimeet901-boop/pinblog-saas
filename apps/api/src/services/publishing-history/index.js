/**
 * Publishing History normalization layer (Phase 1).
 * Option B: derive unified model from specialized job collections.
 */

export {
	PUBLISHING_CHANNELS,
	PUBLISHING_CONTENT_TYPES,
	PUBLISHING_DESTINATION_KINDS,
	PUBLISHING_JOB_COLLECTIONS,
	PUBLISHING_SOURCE_MODULES,
	PUBLISHING_STATUSES,
	buildPublishingHistoryId,
	emptyPublishingHistoryItem,
} from './constants.js';

export {
	asIsoOrNull,
	asNumber,
	asText,
	baseItem,
	buildActions,
	normalizePublishingStatus,
} from './helpers.js';

export { normalizePinterestPublishJob } from './normalize-pinterest.js';
export { normalizeWordpressPublishJob } from './normalize-wordpress.js';

export {
	PUBLISHING_HISTORY_API_VERSION,
	MIN_SOURCE_FETCH_CAP,
	MAX_SOURCE_FETCH_CAP,
	assemblePublishingHistoryResponse,
	buildPublishingHistoryCounts,
	computeSourceFetchCap,
	listPublishingHistory,
	matchesPublishingHistoryFilters,
	nativeStatusExtraFilter,
	paginatePublishingHistoryItems,
	parsePublishingHistoryQuery,
	sortPublishingHistoryItems,
} from './list.js';
