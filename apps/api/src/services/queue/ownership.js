/**
 * Queue ownership catalog — Phase 9a observability only (pure, no I/O).
 *
 * Documents which subsystem executes work vs which stores mirror state.
 * See docs/queue-ownership.md for the full operator guide.
 */

/** @typedef {'execution'|'native'|'mirror'|'scheduler'} QueueRole */

/**
 * Channel executors: legacy pollers own real publish/generation work today.
 * @type {readonly object[]}
 */
export const CHANNEL_EXECUTORS = Object.freeze([
	Object.freeze({
		id: 'pinterest-publish',
		jobType: 'pinterest_publishing',
		sourceCollection: 'pinterest_publish_jobs',
		executorModule: 'services/pinterest-publish-queue.js',
		mirrorModule: 'services/queue/mirrors.js#mirrorPinterestJob',
		startedFrom: 'main.js#startPinterestPublishQueue',
		envFlag: 'PINTEREST_QUEUE_ENABLED',
	}),
	Object.freeze({
		id: 'wordpress-publish',
		jobType: 'wordpress_publishing',
		sourceCollection: 'publish_jobs',
		executorModule: 'services/wordpress-publish-queue.js',
		mirrorModule: 'services/queue/mirrors.js#mirrorWordpressJob',
		startedFrom: 'main.js#startWordpressPublishQueue',
	}),
	Object.freeze({
		id: 'ai-pin-image',
		jobType: 'image_generation',
		sourceCollection: 'ai_pin_image_jobs',
		executorModule: 'services/ai-pin-image-queue.js',
		mirrorModule: 'services/queue/mirrors.js#mirrorImageJob',
		startedFrom: 'main.js#startAIPinImageQueue',
	}),
]);

/** Native queue_jobs types processed by queue/engine.js (not channel executors). */
export const NATIVE_ENGINE = Object.freeze({
	processorModule: 'services/queue/engine.js',
	startedFrom: 'main.js#startQueueEngine',
	jobTypes: Object.freeze([
		'webhook_delivery',
		'email_notification',
		'notification',
		'media_upload',
		'analytics_refresh',
		'health_check',
	]),
});

/** Where operators and product surfaces read queue state. */
export const QUEUE_CONSUMERS = Object.freeze([
	Object.freeze({
		id: 'admin-queue',
		surface: '/admin/queue',
		primaryStore: 'queue_jobs',
		note: 'Unified admin monitor; includes mirrored channel jobs',
	}),
	Object.freeze({
		id: 'calendar',
		surface: '/app/calendar',
		primaryStore: 'channel job collections',
		note: 'Channel collections are scheduling SoT; queue_jobs mirrors are optional enrichment only',
	}),
	Object.freeze({
		id: 'publishing-history',
		surface: '/app/publishing',
		primaryStore: 'channel job collections + history tables',
		note: 'Read model; not queue_jobs',
	}),
	Object.freeze({
		id: 'health-monitor',
		surface: '/api/health',
		primaryStore: 'queue_jobs metrics + ownership catalog',
		note: 'Observability probe only',
	}),
]);

export const QUEUE_OWNERSHIP_MODEL = Object.freeze({
	documentation: 'docs/queue-ownership.md',
	executionSourceOfTruth: 'channel job collections (pinterest_publish_jobs, publish_jobs, ai_pin_image_jobs)',
	adminObservabilityStore: 'queue_jobs',
	nativeProcessor: NATIVE_ENGINE,
	channelExecutors: CHANNEL_EXECUTORS,
	consumers: QUEUE_CONSUMERS,
});

/**
 * Snapshot for health payloads and operator tooling (no side effects).
 */
export function getQueueOwnershipSnapshot() {
	return QUEUE_OWNERSHIP_MODEL;
}
