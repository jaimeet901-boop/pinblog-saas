/**
 * Publishing History UI adapter.
 *
 * Sole conversion layer: PublishingHistoryItem (normalized API)
 * → legacy Publishing Center row shape (mapJob-compatible).
 *
 * PublishingHistoryPage must not read destination.*, channelPayload.*, or meta.*.
 */

/** Statuses returned by legacy channel history when no status query is set. */
export const PUBLISHING_HISTORY_DEFAULT_STATUSES = Object.freeze([
	'published',
	'failed',
	'scheduled',
	'cancelled',
	'publishing',
]);

/** @deprecated use PUBLISHING_HISTORY_DEFAULT_STATUSES */
export const PINTEREST_HISTORY_DEFAULT_STATUSES = PUBLISHING_HISTORY_DEFAULT_STATUSES;

function asText(value) {
	return String(value ?? '').trim();
}

function defaultPerformance() {
	return {
		impressions: null,
		saves: null,
		outboundClicks: null,
		closeups: null,
		readyForAnalyticsSync: true,
	};
}

function defaultFacebookPerformance() {
	return {
		impressions: null,
		engagedUsers: null,
		clicks: null,
		reactions: null,
		readyForAnalyticsSync: true,
	};
}

/**
 * Convert one normalized Facebook PublishingHistoryItem into the shared UI row model.
 *
 * @param {object} item - PublishingHistoryItem
 * @returns {object|null}
 */
export function toFacebookPublishingHistoryUiRow(item) {
	if (!item || typeof item !== 'object') return null;

	const destination = item.destination && typeof item.destination === 'object'
		? item.destination
		: {};
	const payload = item.channelPayload && typeof item.channelPayload === 'object'
		? item.channelPayload
		: {};
	const pinPayload = payload.post && typeof payload.post === 'object' ? payload.post : null;

	const jobId = asText(item.jobId) || asText(String(item.id || '').split(':').pop());
	if (!jobId) return null;

	const title = asText(pinPayload?.title) || asText(item.title);
	const description = asText(pinPayload?.description) || asText(item.description) || asText(payload.message);
	const imageUrl = asText(pinPayload?.imageUrl) || asText(item.imageUrl);

	const pin = pinPayload
		? {
			id: asText(pinPayload.id) || asText(item.contentId),
			title: title || 'Untitled post',
			description,
			overlayText: asText(pinPayload.overlayText),
			imageUrl,
			status: asText(pinPayload.status),
		}
		: null;

	const externalPostUrl = asText(destination.externalUrl) || asText(payload.facebookPostUrl);
	const pageId = asText(destination.targetId) || asText(payload.pageId);
	const pageName = asText(destination.targetLabel) || asText(payload.pageName);

	return {
		id: jobId,
		aiPinId: asText(item.contentId) || asText(pinPayload?.id),
		accountId: asText(destination.accountId),
		accountLabel: asText(destination.accountLabel) || asText(payload.accountLabel),
		accountUsername: asText(payload.accountUsername),
		websiteId: asText(item.websiteId),
		articleId: asText(payload.articleId),
		boardId: pageId,
		boardName: pageName,
		pageId,
		pageName,
		scheduledAt: item.scheduledAt || '',
		timezone: asText(item.timezone),
		status: asText(item.status) || asText(item.nativeStatus),
		attemptCount: Number(item.attemptCount) || 0,
		maxAttempts: Number(item.maxAttempts) || 3,
		nextRetryAt: item.nextRetryAt || '',
		lastError: asText(item.lastError),
		facebookPostId: asText(destination.externalId) || asText(payload.facebookPostId),
		facebookPostUrl: externalPostUrl,
		externalPostUrl,
		publishedAt: item.publishedAt || '',
		performance: payload.performance && typeof payload.performance === 'object'
			? payload.performance
			: defaultFacebookPerformance(),
		createdAt: item.createdAt || '',
		updatedAt: item.updatedAt || '',
		pin,
	};
}

/**
 * Convert one normalized PublishingHistoryItem into the UI row model
 * expected by PublishingHistoryPage (identical to historical mapJob shape).
 *
 * @param {object} item - PublishingHistoryItem
 * @param {{ channel?: string }} [options]
 * @returns {object|null}
 */
export function toPublishingHistoryUiRow(item, options = {}) {
	const channel = asText(options.channel) || asText(item?.channel) || 'pinterest';
	if (channel === 'facebook') {
		return toFacebookPublishingHistoryUiRow(item);
	}
	if (!item || typeof item !== 'object') return null;

	const destination = item.destination && typeof item.destination === 'object'
		? item.destination
		: {};
	const payload = item.channelPayload && typeof item.channelPayload === 'object'
		? item.channelPayload
		: {};
	const pinPayload = payload.pin && typeof payload.pin === 'object' ? payload.pin : null;

	const jobId = asText(item.jobId) || asText(String(item.id || '').split(':').pop());
	if (!jobId) return null;

	const title = asText(pinPayload?.title) || asText(item.title);
	const description = asText(pinPayload?.description) || asText(item.description);
	const imageUrl = asText(pinPayload?.imageUrl) || asText(item.imageUrl);

	// Match legacy mapJob exactly: no destinationUrl on row/pin (Article stays disabled unless added later intentionally).
	const pin = pinPayload
		? {
			id: asText(pinPayload.id) || asText(item.contentId),
			title: title || 'Untitled pin',
			description,
			overlayText: asText(pinPayload.overlayText),
			imageUrl,
			status: asText(pinPayload.status),
		}
		: null;

	return {
		// CRITICAL: actions call /pinterest/jobs/:id — must be raw job id, not "pinterest:…".
		id: jobId,
		aiPinId: asText(item.contentId) || asText(payload.pin?.id),
		accountId: asText(destination.accountId),
		accountLabel: asText(destination.accountLabel),
		accountUsername: asText(payload.accountUsername),
		websiteId: asText(item.websiteId),
		articleId: asText(payload.articleId),
		boardId: asText(destination.targetId) || asText(payload.boardId),
		boardName: asText(destination.targetLabel) || asText(payload.boardName),
		scheduledAt: item.scheduledAt || '',
		timezone: asText(item.timezone),
		status: asText(item.status) || asText(item.nativeStatus),
		attemptCount: Number(item.attemptCount) || 0,
		maxAttempts: Number(item.maxAttempts) || 3,
		nextRetryAt: item.nextRetryAt || '',
		lastError: asText(item.lastError),
		pinterestPinId: asText(destination.externalId) || asText(payload.pinterestPinId),
		pinterestPinUrl: asText(destination.externalUrl) || asText(payload.pinterestPinUrl),
		externalPostUrl: asText(destination.externalUrl) || asText(payload.pinterestPinUrl),
		publishedAt: item.publishedAt || '',
		performance: payload.performance && typeof payload.performance === 'object'
			? payload.performance
			: defaultPerformance(),
		createdAt: item.createdAt || '',
		updatedAt: item.updatedAt || '',
		pin,
	};
}

/**
 * Adapt GET /publishing/history JSON into the legacy list envelope + UI rows.
 * Page components should only consume the returned `items` (and optional warnings).
 *
 * @param {object} payload
 * @param {{ applyDefaultStatusFilter?: boolean }} [options]
 */
export function adaptPublishingHistoryResponse(payload = {}, options = {}) {
	const applyDefaultStatusFilter = options.applyDefaultStatusFilter !== false;
	const channel = asText(options.channel) || 'pinterest';
	const rawItems = Array.isArray(payload.items) ? payload.items : [];

	// Legacy channel history filters native statuses and excludes waiting_provider.
	const sourceItems = applyDefaultStatusFilter
		? rawItems.filter((item) => {
			const native = String(item?.nativeStatus || '').trim();
			if (native === 'waiting_provider') return false;
			const status = String(item?.status || '').trim();
			return PUBLISHING_HISTORY_DEFAULT_STATUSES.includes(status);
		})
		: rawItems;

	const items = sourceItems
		.map((item) => toPublishingHistoryUiRow(item, { channel }))
		.filter(Boolean);

	const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};

	return {
		page: Number(meta.page) || 1,
		perPage: Number(meta.perPage) || items.length || 50,
		totalItems: applyDefaultStatusFilter ? items.length : (Number(meta.totalItems) || items.length),
		totalPages: applyDefaultStatusFilter
			? (items.length === 0 ? 0 : 1)
			: (Number(meta.totalPages) || 0),
		items,
		warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
		truncated: Boolean(meta.truncated),
		version: Number(payload.version) || 1,
	};
}

/**
 * Build query for the unified history API while preserving legacy Pinterest Center behavior.
 */
export function buildPublishingHistoryFetchQuery({
	page = 1,
	perPage = 100,
	statusFilter = '',
	channel = 'pinterest',
} = {}) {
	const query = new URLSearchParams({
		page: String(Math.max(1, Number(page) || 1)),
		perPage: String(Math.min(100, Math.max(1, Number(perPage) || 100))),
		channel: String(channel || 'pinterest'),
		sort: '-updatedAt',
	});
	const status = String(statusFilter || '').trim();
	if (status) {
		query.set('status', status);
	}
	return query;
}
