/**
 * Publishing History service facade for the Publishing Center UI.
 */

export {
	PINTEREST_HISTORY_DEFAULT_STATUSES,
	PUBLISHING_HISTORY_DEFAULT_STATUSES,
	adaptPublishingHistoryResponse,
	buildPublishingHistoryFetchQuery,
	toFacebookPublishingHistoryUiRow,
	toPublishingHistoryUiRow,
} from './uiAdapter.js';
export {
	externalPostUrl,
	getPublishingHistoryViewConfig,
} from './viewConfig.js';
