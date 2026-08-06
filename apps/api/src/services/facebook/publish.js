/**
 * Facebook Channel Pack — publish job producer service (F4-2).
 * Validates via F3, builds job/event payloads. No Graph calls, no worker, no routes.
 */

import { normalizeDestinationUrl, resolvePinDestinationUrl } from '../../utils/pin-publish-destination.js';
import { FACEBOOK_JOB_COLLECTION } from './channel-pack.js';
import {
	FACEBOOK_PUBLISH_CREATED_EVENT_TYPE,
	buildFacebookPublishCreatedEventPayload,
} from './publish-events.js';
import { validateFacebookDestinationPost } from './destinations.js';

export { FACEBOOK_PUBLISH_CREATED_EVENT_TYPE, buildFacebookPublishCreatedEventPayload };

const ACTIVE_JOB_STATUSES = Object.freeze(['scheduled', 'publishing']);

function recordFieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

function publishValidationResult(input = {}) {
	const {
		ok,
		errors = [],
		warnings = [],
		normalized = null,
		...rest
	} = input;

	return {
		ok,
		errors: [...errors],
		warnings: [...warnings],
		...(normalized ? { normalized } : {}),
		...rest,
	};
}

async function resolvePublishDeps(deps = {}) {
	let getOwnedFacebookAccountById = deps.getOwnedFacebookAccountById;
	if (!getOwnedFacebookAccountById) {
		({ getOwnedFacebookAccountById } = await import('./api.js'));
	}

	let resolveJobCreateStamps = deps.resolveJobCreateStamps;
	if (!resolveJobCreateStamps) {
		({ resolveJobCreateStamps } = await import('../queue/job-ownership.js'));
	}

	const pocketbaseClient = deps.pocketbaseClient
		|| (await import('../../utils/pocketbaseClient.js')).default;

	return {
		getOwnedFacebookAccountById,
		resolveJobCreateStamps,
		pocketbaseClient,
	};
}

/**
 * Merge studio pin, optional article, and request post overrides.
 *
 * @param {{ post?: object, aiPin?: object, article?: object|null }} input
 */
export function resolveFacebookPublishPostContent(input = {}) {
	const post = input.post && typeof input.post === 'object' ? input.post : {};
	const aiPin = input.aiPin && typeof input.aiPin === 'object' ? input.aiPin : {};
	const article = input.article && typeof input.article === 'object' ? input.article : null;

	const message = String(
		post.message
		?? post.caption
		?? aiPin.description
		?? aiPin.body
		?? aiPin.caption
		?? aiPin.title
		?? '',
	).trim();

	const imageUrl = normalizeDestinationUrl(
		post.imageUrl
		?? post.image_url
		?? aiPin.image_url
		?? aiPin.imageUrl
		?? aiPin.featured_image_url
		?? aiPin.featuredImageUrl
		?? '',
	);

	const linkUrl = normalizeDestinationUrl(
		post.linkUrl
		?? post.link_url
		?? post.destinationUrl
		?? post.destination_url
		?? '',
	) || resolvePinDestinationUrl(aiPin, article, '');

	const title = String(aiPin.title ?? post.title ?? message ?? 'Facebook post').trim().slice(0, 500);

	return {
		message,
		imageUrl,
		linkUrl,
		title,
		caption: message.slice(0, 2000),
	};
}

/**
 * Build a PocketBase create payload for facebook_publish_jobs (pure).
 */
export function buildFacebookPublishJobPayload({
	owner,
	workspaceId = '',
	account = {},
	pageRecord = {},
	aiPin = {},
	content = {},
	normalized = {},
	timezone = 'UTC',
	scheduledAt,
	maxAttempts = FACEBOOK_PUBLISH_DEFAULT_MAX_ATTEMPTS,
} = {}) {
	const ownerStr = String(owner || '').trim();
	const pageId = String(pageRecord.page_id || pageRecord.pageId || normalized.pageId || '').trim();
	const pageName = String(pageRecord.name || pageRecord.page_name || '').trim();
	const accountId = String(account.id || account.accountId || normalized.accountId || '').trim();
	const accountLabel = String(
		account.label || account.account_name || account.username || account.accountLabel || '',
	).trim();
	const tz = String(timezone || 'UTC').trim() || 'UTC';
	const scheduled = scheduledAt || new Date().toISOString();

	const payload = {
		owner: ownerStr,
		ai_pin: recordFieldId(aiPin.id || aiPin),
		account: accountId,
		page_id: pageId,
		page_name: pageName,
		page_label: pageName,
		account_label: accountLabel,
		title: String(content.title || '').trim().slice(0, 500),
		message: String(content.message || '').trim().slice(0, 5000),
		caption: String(content.caption || content.message || '').trim().slice(0, 2000),
		image_url: String(content.imageUrl || '').trim().slice(0, 2000),
		destination_url: String(content.linkUrl || '').trim().slice(0, 2000),
		scheduled_at: scheduled,
		timezone: tz,
		scheduled_timezone: tz,
		status: 'scheduled',
		attempt_count: 0,
		max_attempts: maxAttempts,
		next_retry_at: '',
		last_error: '',
	};

	if (workspaceId) payload.workspace = workspaceId;
	if (pageRecord.id) payload.page = pageRecord.id;

	const websiteId = recordFieldId(aiPin.websiteId || aiPin.website_id);
	const articleId = recordFieldId(aiPin.articleId || aiPin.article_id);
	if (websiteId) payload.websiteId = websiteId;
	if (articleId) payload.articleId = articleId;

	return payload;
}

export const FACEBOOK_PUBLISH_DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Public API DTO for a facebook_publish_jobs row.
 */
export function mapFacebookPublishJobDto(job = {}) {
	return {
		id: String(job.id || '').trim(),
		status: String(job.status || 'scheduled').trim(),
		scheduledAt: job.scheduled_at || job.scheduledAt || null,
		timezone: job.scheduled_timezone || job.timezone || 'UTC',
		accountId: recordFieldId(job.account || job.accountId),
		pageId: String(job.page_id || job.pageId || '').trim(),
		pageName: String(job.page_name || job.page_label || '').trim(),
		aiPinId: recordFieldId(job.ai_pin || job.aiPinId),
		title: String(job.title || '').trim(),
		message: String(job.message || '').trim(),
		imageUrl: String(job.image_url || job.imageUrl || '').trim(),
		destinationUrl: String(job.destination_url || job.destinationUrl || '').trim(),
		facebookPostId: String(job.facebook_post_id || job.facebookPostId || '').trim(),
		facebookPostUrl: String(job.facebook_post_url || job.facebookPostUrl || '').trim(),
		publishedAt: job.published_at || job.publishedAt || null,
		lastError: String(job.last_error || job.lastError || '').trim(),
		attemptCount: Number(job.attempt_count ?? job.attemptCount) || 0,
		maxAttempts: Number(job.max_attempts ?? job.maxAttempts) || FACEBOOK_PUBLISH_DEFAULT_MAX_ATTEMPTS,
	};
}

async function loadFacebookPageRecord({
	pocketbaseClient,
	owner,
	accountId,
	pageId,
	req = null,
	andWorkspaceScope = null,
}) {
	const accountIdStr = String(accountId || '').trim();
	const pageIdStr = String(pageId || '').trim();
	if (!owner || !accountIdStr || !pageIdStr) return null;

	const pb = pocketbaseClient;
	const filter = req && typeof andWorkspaceScope === 'function'
		? andWorkspaceScope(req, pb.filter('account = {:account} && page_id = {:pageId}', {
			account: accountIdStr,
			pageId: pageIdStr,
		}))
		: pb.filter('owner = {:owner} && account = {:account} && page_id = {:pageId}', {
			owner,
			account: accountIdStr,
			pageId: pageIdStr,
		});

	return pb.collection('facebook_pages').getFirstListItem(filter, { requestKey: null }).catch(() => null);
}

async function findActiveFacebookPublishJobForPin({
	pocketbaseClient,
	owner,
	aiPinId,
}) {
	const ownerStr = String(owner || '').trim();
	const pinId = String(aiPinId || '').trim();
	if (!ownerStr || !pinId) return null;

	const statusFilter = ACTIVE_JOB_STATUSES.map((status) => `status = "${status}"`).join(' || ');
	const filter = pocketbaseClient.filter(
		`owner = {:owner} && ai_pin = {:pin} && (${statusFilter})`,
		{ owner: ownerStr, pin: pinId },
	);

	return pocketbaseClient.collection(FACEBOOK_JOB_COLLECTION).getFirstListItem(filter, { requestKey: null }).catch(() => null);
}

/**
 * Validate and build publish-now job + event payloads (no persistence).
 *
 * @param {{
 *   owner: string,
 *   accountId: string,
 *   pageId: string,
 *   aiPinId: string,
 *   post?: object,
 *   timezone?: string,
 *   scheduledAt?: string,
 *   req?: object,
 *   deps?: object,
 * }} input
 */
export async function prepareFacebookPublishJob({
	owner,
	accountId,
	pageId,
	aiPinId,
	post = {},
	timezone = 'UTC',
	scheduledAt = null,
	req = null,
	deps = null,
} = {}) {
	const ownerStr = String(owner || '').trim();
	const accountIdStr = String(accountId || '').trim();
	const pageIdStr = String(pageId || '').trim();
	const aiPinIdStr = String(aiPinId || '').trim();

	if (!aiPinIdStr) {
		return publishValidationResult({
			ok: false,
			errors: ['AI pin is required'],
		});
	}

	const {
		pocketbaseClient,
		resolveJobCreateStamps,
		getOwnedFacebookAccountById,
	} = await resolvePublishDeps(deps || {});

	const aiPin = await pocketbaseClient.collection('ai_pins').getOne(aiPinIdStr, { requestKey: null }).catch(() => null);
	if (!aiPin || recordFieldId(aiPin.owner) !== ownerStr) {
		return publishValidationResult({
			ok: false,
			errors: ['AI pin not found'],
		});
	}

	const activeJob = await findActiveFacebookPublishJobForPin({
		pocketbaseClient,
		owner: ownerStr,
		aiPinId: aiPinIdStr,
	});
	if (activeJob) {
		return publishValidationResult({
			ok: false,
			errors: ['This pin already has an active Facebook publish job'],
		});
	}

	const article = aiPin.articleId
		? await pocketbaseClient.collection('website_articles').getOne(
			recordFieldId(aiPin.articleId),
			{ requestKey: null },
		).catch(() => null)
		: null;

	const content = resolveFacebookPublishPostContent({ post, aiPin, article });

	const validation = await validateFacebookDestinationPost({
		owner: ownerStr,
		accountId: accountIdStr,
		pageId: pageIdStr,
		post: {
			...post,
			message: content.message,
			imageUrl: content.imageUrl,
			linkUrl: content.linkUrl,
		},
		req,
		deps,
	});

	if (!validation.ok) {
		return publishValidationResult({
			ok: false,
			errors: validation.errors,
			warnings: validation.warnings,
			normalized: validation.normalized,
		});
	}

	const account = await getOwnedFacebookAccountById({
		owner: ownerStr,
		accountId: accountIdStr,
		req,
	});
	if (!account) {
		return publishValidationResult({
			ok: false,
			errors: ['Facebook account not found'],
			normalized: validation.normalized,
		});
	}

	const andWorkspaceScope = deps?.andWorkspaceScope;
	const pageRecord = await loadFacebookPageRecord({
		pocketbaseClient,
		owner: ownerStr,
		accountId: accountIdStr,
		pageId: validation.normalized.pageId || pageIdStr,
		req,
		andWorkspaceScope,
	});
	if (!pageRecord) {
		return publishValidationResult({
			ok: false,
			errors: ['Facebook destination not found'],
			normalized: validation.normalized,
		});
	}

	const stamps = await resolveJobCreateStamps({
		ownerId: ownerStr,
		workspaceId: req?.workspaceId || req?.workspace?.id || '',
		workspaceKey: req?.workspaceKey || req?.workspace?.workspace_key || '',
	});

	const scheduledAtIso = scheduledAt || new Date().toISOString();
	const tz = String(timezone || 'UTC').trim() || 'UTC';

	const jobPayload = buildFacebookPublishJobPayload({
		owner: stamps.owner || ownerStr,
		workspaceId: stamps.workspace || '',
		account,
		pageRecord,
		aiPin,
		content,
		normalized: validation.normalized,
		timezone: tz,
		scheduledAt: scheduledAtIso,
	});

	const eventPayload = buildFacebookPublishCreatedEventPayload({
		owner: stamps.owner || ownerStr,
		workspaceId: stamps.workspace || '',
		accountId: accountIdStr,
		pageId: jobPayload.page_id,
		aiPinId: aiPinIdStr,
		scheduledAt: scheduledAtIso,
		timezone: tz,
	});

	return publishValidationResult({
		ok: true,
		warnings: validation.warnings,
		normalized: validation.normalized,
		jobPayload,
		eventPayload,
		dtoPreview: mapFacebookPublishJobDto(jobPayload),
	});
}
