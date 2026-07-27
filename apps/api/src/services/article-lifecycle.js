/**
 * Chef IA Article Lifecycle — production workflow for synchronized articles.
 * Keeps legacy website_articles.status (new/imported/published) intact.
 */
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { ensureArticleLifecycleSchema } from '../utils/ensure-article-lifecycle-schema.js';
import { enqueueJob } from './queue/index.js';
import logger from '../utils/logger.js';

export const ARTICLE_LIFECYCLE_STATES = Object.freeze([
	'DISCOVERED',
	'SYNCED',
	'READY_FOR_AI',
	'AI_GENERATING',
	'AI_COMPLETED',
	'READY_FOR_PINS',
	'PINS_GENERATING',
	'PINS_READY',
	'READY_FOR_PUBLISH',
	'SCHEDULED',
	'PUBLISHED',
	'FAILED',
	'ARCHIVED',
]);

export const ARTICLE_LIFECYCLE_EVENTS = Object.freeze({
	DISCOVERED: 'Discovered',
	SYNCED: 'Synced',
	READY_FOR_AI: 'Ready for AI',
	AI_STARTED: 'AI Started',
	AI_COMPLETED: 'AI Completed',
	READY_FOR_PINS: 'Ready for Pins',
	PINS_GENERATING: 'Pins Generating',
	PINS_GENERATED: 'Pins Generated',
	READY_FOR_PUBLISH: 'Ready for Publish',
	SCHEDULED: 'Scheduled',
	PUBLISHED: 'Published',
	RETRY: 'Retry',
	FAILED: 'Failed',
	ARCHIVED: 'Archived',
	STATUS_UPDATED: 'Status Updated',
});

const PIPELINE_ORDER = [
	'DISCOVERED',
	'SYNCED',
	'READY_FOR_AI',
	'AI_GENERATING',
	'AI_COMPLETED',
	'READY_FOR_PINS',
	'PINS_GENERATING',
	'PINS_READY',
	'READY_FOR_PUBLISH',
	'SCHEDULED',
	'PUBLISHED',
];

const ALLOWED_TRANSITIONS = {
	DISCOVERED: ['SYNCED', 'READY_FOR_AI', 'FAILED', 'ARCHIVED'],
	SYNCED: ['READY_FOR_AI', 'FAILED', 'ARCHIVED'],
	READY_FOR_AI: ['AI_GENERATING', 'FAILED', 'ARCHIVED'],
	AI_GENERATING: ['AI_COMPLETED', 'READY_FOR_PINS', 'FAILED', 'ARCHIVED'],
	AI_COMPLETED: ['READY_FOR_PINS', 'FAILED', 'ARCHIVED'],
	READY_FOR_PINS: ['PINS_GENERATING', 'FAILED', 'ARCHIVED'],
	PINS_GENERATING: ['PINS_READY', 'READY_FOR_PUBLISH', 'FAILED', 'ARCHIVED'],
	PINS_READY: ['READY_FOR_PUBLISH', 'SCHEDULED', 'FAILED', 'ARCHIVED'],
	READY_FOR_PUBLISH: ['SCHEDULED', 'PUBLISHED', 'FAILED', 'ARCHIVED'],
	SCHEDULED: ['PUBLISHED', 'FAILED', 'ARCHIVED', 'READY_FOR_PUBLISH'],
	PUBLISHED: ['ARCHIVED', 'READY_FOR_PUBLISH'],
	FAILED: [
		'DISCOVERED',
		'SYNCED',
		'READY_FOR_AI',
		'AI_GENERATING',
		'READY_FOR_PINS',
		'PINS_GENERATING',
		'READY_FOR_PUBLISH',
		'ARCHIVED',
	],
	ARCHIVED: ['READY_FOR_AI', 'READY_FOR_PINS', 'READY_FOR_PUBLISH'],
};

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

export function normalizeLifecycleState(value) {
	const raw = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
	if (ARTICLE_LIFECYCLE_STATES.includes(raw)) return raw;
	return '';
}

export function mapLegacyStatusToLifecycle(status) {
	const value = String(status || '').toLowerCase();
	if (value === 'published') return 'PUBLISHED';
	if (value === 'imported') return 'SYNCED';
	if (value === 'new') return 'DISCOVERED';
	return 'DISCOVERED';
}

function eventForTransition(toState, explicitEvent) {
	if (explicitEvent) return explicitEvent;
	switch (toState) {
		case 'DISCOVERED': return ARTICLE_LIFECYCLE_EVENTS.DISCOVERED;
		case 'SYNCED': return ARTICLE_LIFECYCLE_EVENTS.SYNCED;
		case 'READY_FOR_AI': return ARTICLE_LIFECYCLE_EVENTS.READY_FOR_AI;
		case 'AI_GENERATING': return ARTICLE_LIFECYCLE_EVENTS.AI_STARTED;
		case 'AI_COMPLETED': return ARTICLE_LIFECYCLE_EVENTS.AI_COMPLETED;
		case 'READY_FOR_PINS': return ARTICLE_LIFECYCLE_EVENTS.READY_FOR_PINS;
		case 'PINS_GENERATING': return ARTICLE_LIFECYCLE_EVENTS.PINS_GENERATING;
		case 'PINS_READY': return ARTICLE_LIFECYCLE_EVENTS.PINS_GENERATED;
		case 'READY_FOR_PUBLISH': return ARTICLE_LIFECYCLE_EVENTS.READY_FOR_PUBLISH;
		case 'SCHEDULED': return ARTICLE_LIFECYCLE_EVENTS.SCHEDULED;
		case 'PUBLISHED': return ARTICLE_LIFECYCLE_EVENTS.PUBLISHED;
		case 'FAILED': return ARTICLE_LIFECYCLE_EVENTS.FAILED;
		case 'ARCHIVED': return ARTICLE_LIFECYCLE_EVENTS.ARCHIVED;
		default: return ARTICLE_LIFECYCLE_EVENTS.STATUS_UPDATED;
	}
}

function progressForState(state) {
	if (state === 'FAILED') return { percent: null, label: 'Failed', step: -1, totalSteps: PIPELINE_ORDER.length };
	if (state === 'ARCHIVED') return { percent: 100, label: 'Archived', step: PIPELINE_ORDER.length, totalSteps: PIPELINE_ORDER.length };
	const index = PIPELINE_ORDER.indexOf(state);
	if (index < 0) return { percent: 0, label: state || 'Unknown', step: 0, totalSteps: PIPELINE_ORDER.length };
	const percent = Math.round(((index + 1) / PIPELINE_ORDER.length) * 1000) / 10;
	return {
		percent,
		label: state,
		step: index + 1,
		totalSteps: PIPELINE_ORDER.length,
	};
}

function ownerIdOf(article) {
	const raw = article?.owner;
	if (!raw) return '';
	if (typeof raw === 'string') return raw;
	return raw.id || '';
}

function websiteIdOf(article) {
	return article?.websiteId || article?.website_id || article?.website || '';
}

export function mapArticleLifecycle(article) {
	const state = normalizeLifecycleState(article?.lifecycle_state)
		|| mapLegacyStatusToLifecycle(article?.status);
	const previous = normalizeLifecycleState(article?.lifecycle_previous_state) || '';
	const progress = progressForState(state);
	return {
		articleId: article?.id || '',
		websiteId: websiteIdOf(article),
		currentState: state,
		previousState: previous,
		lastStateChange: article?.lifecycle_changed_at || '',
		failureReason: article?.lifecycle_failure_reason || '',
		failedStage: article?.lifecycle_failed_stage || '',
		retryCount: Number(article?.lifecycle_retry_count) || 0,
		processingDurationMs: Number(article?.lifecycle_processing_ms) || 0,
		timestamps: {
			aiStartedAt: article?.ai_started_at || '',
			aiCompletedAt: article?.ai_completed_at || '',
			pinsStartedAt: article?.pins_started_at || '',
			pinsReadyAt: article?.pins_ready_at || '',
			publishStartedAt: article?.publish_started_at || '',
			publishedAt: article?.published_at || '',
		},
		legacyStatus: article?.status || '',
		progress,
	};
}

async function writeActivity({
	ownerId,
	articleId,
	websiteId,
	event,
	fromState,
	toState,
	message = '',
	source = '',
	meta = {},
}) {
	await ensureArticleLifecycleSchema(pocketbaseClient);
	return pocketbaseClient.collection('article_activity_history').create({
		owner: ownerId,
		article: articleId,
		website: websiteId || '',
		event: String(event || '').slice(0, 80),
		from_state: fromState || '',
		to_state: toState || '',
		message: String(message || '').slice(0, 2000),
		source: String(source || '').slice(0, 80),
		meta: meta || {},
		occurred_at: new Date().toISOString(),
	}).catch((error) => {
		logger.warn('Article activity history write failed', {
			articleId,
			event,
			message: error?.message || String(error),
		});
		return null;
	});
}

function buildLifecyclePatch({
	fromState,
	toState,
	failureReason = '',
	failedStage = '',
	retryCount = null,
	article,
	startedAt = null,
}) {
	const now = new Date().toISOString();
	const patch = {
		lifecycle_state: toState,
		lifecycle_previous_state: fromState || '',
		lifecycle_changed_at: now,
	};

	if (toState === 'FAILED') {
		patch.lifecycle_failure_reason = String(failureReason || '').slice(0, 4000);
		patch.lifecycle_failed_stage = String(failedStage || fromState || '').slice(0, 64);
	} else {
		patch.lifecycle_failure_reason = '';
		patch.lifecycle_failed_stage = '';
	}

	if (retryCount != null) {
		patch.lifecycle_retry_count = Number(retryCount) || 0;
	}

	if (startedAt) {
		const duration = Math.max(0, Date.now() - new Date(startedAt).getTime());
		if (Number.isFinite(duration)) {
			patch.lifecycle_processing_ms = (Number(article?.lifecycle_processing_ms) || 0) + duration;
		}
	}

	if (toState === 'AI_GENERATING' && !article?.ai_started_at) {
		patch.ai_started_at = now;
	}
	if (toState === 'AI_COMPLETED' || (toState === 'READY_FOR_PINS' && fromState === 'AI_GENERATING')) {
		patch.ai_completed_at = now;
		if (!article?.ai_started_at) patch.ai_started_at = article?.ai_started_at || now;
	}
	if (toState === 'PINS_GENERATING' && !article?.pins_started_at) {
		patch.pins_started_at = now;
	}
	if (toState === 'PINS_READY' || toState === 'READY_FOR_PUBLISH') {
		if (!article?.pins_ready_at) patch.pins_ready_at = now;
		if (!article?.pins_started_at) patch.pins_started_at = article?.pins_started_at || now;
	}
	if (toState === 'SCHEDULED' || toState === 'READY_FOR_PUBLISH') {
		if (!article?.publish_started_at && toState === 'SCHEDULED') {
			patch.publish_started_at = now;
		}
	}
	if (toState === 'PUBLISHED') {
		patch.published_at = now;
		if (!article?.publish_started_at) patch.publish_started_at = now;
	}

	return patch;
}

/**
 * Transition an article lifecycle state and append activity history.
 */
export async function transitionArticleLifecycle(articleId, toStateRaw, {
	ownerId = '',
	event = '',
	message = '',
	source = 'system',
	meta = {},
	failureReason = '',
	failedStage = '',
	force = false,
	allowSame = false,
} = {}) {
	await ensureArticleLifecycleSchema(pocketbaseClient);
	const toState = normalizeLifecycleState(toStateRaw);
	if (!toState) {
		throw httpError(422, `Invalid lifecycle state: ${toStateRaw}`, 'INVALID_LIFECYCLE_STATE');
	}

	const article = await pocketbaseClient.collection('website_articles').getOne(articleId).catch(() => null);
	if (!article) {
		throw httpError(404, 'Article not found', 'NOT_FOUND');
	}

	const resolvedOwner = ownerId || ownerIdOf(article);
	if (ownerId && ownerIdOf(article) && ownerIdOf(article) !== ownerId) {
		throw httpError(403, 'You do not have access to this article', 'FORBIDDEN');
	}

	const fromState = normalizeLifecycleState(article.lifecycle_state)
		|| mapLegacyStatusToLifecycle(article.status);

	if (fromState === toState && !allowSame) {
		return {
			unchanged: true,
			article,
			lifecycle: mapArticleLifecycle({ ...article, lifecycle_state: fromState }),
		};
	}

	const allowed = ALLOWED_TRANSITIONS[fromState] || [];
	if (!force && fromState && !allowed.includes(toState)) {
		throw httpError(
			409,
			`Invalid lifecycle transition ${fromState} → ${toState}`,
			'INVALID_LIFECYCLE_TRANSITION',
		);
	}

	const stageStartedAt = (
		(fromState === 'AI_GENERATING' && article.ai_started_at)
		|| (fromState === 'PINS_GENERATING' && article.pins_started_at)
		|| (fromState === 'SCHEDULED' && article.publish_started_at)
		|| article.lifecycle_changed_at
		|| null
	);

	const patch = buildLifecyclePatch({
		fromState,
		toState,
		failureReason,
		failedStage,
		article,
		startedAt: ['AI_COMPLETED', 'PINS_READY', 'READY_FOR_PUBLISH', 'PUBLISHED', 'FAILED'].includes(toState)
			? stageStartedAt
			: null,
	});

	const updated = await pocketbaseClient.collection('website_articles').update(article.id, patch).catch(async (error) => {
		// Schema may not be migrated yet on older deploys — retry with minimal fields.
		logger.warn('Lifecycle update with full patch failed; retrying minimal', {
			articleId,
			message: error?.message || String(error),
		});
		return pocketbaseClient.collection('website_articles').update(article.id, {
			lifecycle_state: toState,
			lifecycle_previous_state: fromState || '',
			lifecycle_changed_at: new Date().toISOString(),
		});
	});

	const activityEvent = eventForTransition(toState, event);
	await writeActivity({
		ownerId: resolvedOwner,
		articleId: article.id,
		websiteId: websiteIdOf(article),
		event: activityEvent,
		fromState,
		toState,
		message: message || `${fromState || 'NONE'} → ${toState}`,
		source,
		meta: {
			...meta,
			failureReason: failureReason || '',
			failedStage: failedStage || '',
		},
	});

	return {
		unchanged: false,
		article: updated,
		lifecycle: mapArticleLifecycle(updated),
		event: activityEvent,
	};
}

/**
 * Best-effort lifecycle bump used by workers/hooks (never throws into callers).
 */
export async function safeTransitionArticleLifecycle(articleId, toState, options = {}) {
	if (!articleId) return null;
	try {
		return await transitionArticleLifecycle(articleId, toState, options);
	} catch (error) {
		logger.warn('Safe article lifecycle transition skipped', {
			articleId,
			toState,
			message: error?.message || String(error),
		});
		return null;
	}
}

export async function getArticleLifecycleStatus(ownerId, articleId) {
	await ensureArticleLifecycleSchema(pocketbaseClient);
	const article = await pocketbaseClient.collection('website_articles').getOne(articleId).catch(() => null);
	if (!article) throw httpError(404, 'Article not found', 'NOT_FOUND');
	if (ownerIdOf(article) !== ownerId) throw httpError(403, 'Forbidden', 'FORBIDDEN');
	return mapArticleLifecycle(article);
}

export async function updateArticleLifecycleStatus(ownerId, articleId, body = {}) {
	const toState = body.state || body.lifecycleState || body.toState;
	return transitionArticleLifecycle(articleId, toState, {
		ownerId,
		event: body.event || ARTICLE_LIFECYCLE_EVENTS.STATUS_UPDATED,
		message: body.message || '',
		source: body.source || 'api',
		meta: body.meta || {},
		failureReason: body.failureReason || '',
		failedStage: body.failedStage || '',
		force: body.force === true,
	});
}

export async function getArticleLifecycleTimeline(ownerId, articleId, { page = 1, perPage = 50 } = {}) {
	await ensureArticleLifecycleSchema(pocketbaseClient);
	const article = await pocketbaseClient.collection('website_articles').getOne(articleId).catch(() => null);
	if (!article) throw httpError(404, 'Article not found', 'NOT_FOUND');
	if (ownerIdOf(article) !== ownerId) throw httpError(403, 'Forbidden', 'FORBIDDEN');

	const result = await pocketbaseClient.collection('article_activity_history').getList(page, Math.min(100, perPage), {
		filter: pocketbaseClient.filter('owner = {:owner} && article = {:article}', {
			owner: ownerId,
			article: articleId,
		}),
		sort: '-occurred_at',
		requestKey: null,
	}).catch(() => ({ items: [], totalItems: 0, page, perPage }));

	return {
		articleId,
		items: (result.items || []).map((row) => ({
			id: row.id,
			event: row.event,
			fromState: row.from_state || '',
			toState: row.to_state || '',
			message: row.message || '',
			source: row.source || '',
			meta: row.meta || {},
			occurredAt: row.occurred_at || row.created,
		})),
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: result.totalItems || 0,
	};
}

export async function getArticleLifecycleProgress(ownerId, articleId) {
	const lifecycle = await getArticleLifecycleStatus(ownerId, articleId);
	const timeline = await getArticleLifecycleTimeline(ownerId, articleId, { page: 1, perPage: 5 });
	return {
		...lifecycle,
		recentEvents: timeline.items,
		pipeline: PIPELINE_ORDER,
	};
}

function retryTargetFromFailed(article) {
	const failedStage = normalizeLifecycleState(article.lifecycle_failed_stage)
		|| normalizeLifecycleState(article.lifecycle_previous_state)
		|| 'READY_FOR_AI';

	if (['AI_GENERATING', 'AI_COMPLETED', 'READY_FOR_AI'].includes(failedStage)) {
		return { state: 'READY_FOR_AI', queueType: 'ai_pin_analyze' };
	}
	if (['PINS_GENERATING', 'PINS_READY', 'READY_FOR_PINS'].includes(failedStage)) {
		return { state: 'READY_FOR_PINS', queueType: 'image_generation' };
	}
	if (['READY_FOR_PUBLISH', 'SCHEDULED', 'PUBLISHED'].includes(failedStage)) {
		return { state: 'READY_FOR_PUBLISH', queueType: 'pinterest_publishing' };
	}
	if (['DISCOVERED', 'SYNCED'].includes(failedStage)) {
		return { state: 'SYNCED', queueType: null };
	}
	return { state: 'READY_FOR_AI', queueType: 'ai_pin_analyze' };
}

/**
 * Retry the failed stage: restore prior pipeline state, log Retry, optionally enqueue queue work.
 */
export async function retryFailedArticleStage(ownerId, articleId, body = {}) {
	await ensureArticleLifecycleSchema(pocketbaseClient);
	const article = await pocketbaseClient.collection('website_articles').getOne(articleId).catch(() => null);
	if (!article) throw httpError(404, 'Article not found', 'NOT_FOUND');
	if (ownerIdOf(article) !== ownerId) throw httpError(403, 'Forbidden', 'FORBIDDEN');

	const current = normalizeLifecycleState(article.lifecycle_state)
		|| mapLegacyStatusToLifecycle(article.status);
	if (current !== 'FAILED' && body.force !== true) {
		throw httpError(409, 'Article is not in FAILED state', 'NOT_FAILED');
	}

	const target = retryTargetFromFailed(article);
	const retryCount = (Number(article.lifecycle_retry_count) || 0) + 1;

	await pocketbaseClient.collection('website_articles').update(article.id, {
		lifecycle_retry_count: retryCount,
		lifecycle_failure_reason: '',
		lifecycle_failed_stage: '',
	}).catch(() => null);

	const transition = await transitionArticleLifecycle(article.id, target.state, {
		ownerId,
		event: ARTICLE_LIFECYCLE_EVENTS.RETRY,
		message: body.message || `Retry #${retryCount} → ${target.state}`,
		source: body.source || 'api.retry',
		meta: { retryCount, queueType: target.queueType || '' },
		force: true,
	});

	let queueJob = null;
	if (target.queueType && body.enqueue !== false) {
		try {
			queueJob = await enqueueJob({
				type: target.queueType,
				owner: ownerId,
				workspaceKey: ownerId,
				priority: 'normal',
				payload: {
					articleId: article.id,
					websiteId: websiteIdOf(article),
					retry: true,
					retryCount,
				},
				meta: {
					source: 'article_lifecycle_retry',
					articleId: article.id,
				},
			});
		} catch (error) {
			logger.warn('Lifecycle retry queue enqueue skipped', {
				articleId,
				queueType: target.queueType,
				message: error?.message || String(error),
			});
		}
	}

	return {
		...transition,
		retryCount,
		queueJob,
		targetState: target.state,
	};
}

/**
 * Initialize lifecycle after discovery/sync create/update.
 * Never pulls mid/late pipeline articles backward on re-sync.
 */
export async function markArticleSynced(articleId, { ownerId = '', source = 'wordpress_sync', discovered = false } = {}) {
	if (!articleId) return null;
	try {
		await ensureArticleLifecycleSchema(pocketbaseClient);
		const article = await pocketbaseClient.collection('website_articles').getOne(articleId).catch(() => null);
		if (!article) return null;

		const current = normalizeLifecycleState(article.lifecycle_state)
			|| mapLegacyStatusToLifecycle(article.status);
		const failedStage = normalizeLifecycleState(article.lifecycle_failed_stage);
		const canAdvance = !article.lifecycle_state
			|| ['DISCOVERED', 'SYNCED', 'READY_FOR_AI'].includes(current)
			|| (current === 'FAILED' && ['DISCOVERED', 'SYNCED', ''].includes(failedStage));

		if (!canAdvance) {
			return { skipped: true, lifecycle: mapArticleLifecycle(article) };
		}

		if (discovered || !article.lifecycle_state || current === 'DISCOVERED') {
			await safeTransitionArticleLifecycle(articleId, 'DISCOVERED', {
				ownerId,
				source,
				message: 'Article discovered',
				force: true,
				allowSame: true,
			});
		}

		await safeTransitionArticleLifecycle(articleId, 'SYNCED', {
			ownerId,
			source,
			message: 'Article synchronized',
			force: true,
		});
		return safeTransitionArticleLifecycle(articleId, 'READY_FOR_AI', {
			ownerId,
			source,
			message: 'Article ready for AI',
			force: true,
		});
	} catch (error) {
		logger.warn('markArticleSynced failed', {
			articleId,
			message: error?.message || String(error),
		});
		return null;
	}
}
