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
		envFlag: 'WORDPRESS_QUEUE_ENABLED',
	}),
	Object.freeze({
		id: 'ai-pin-image',
		jobType: 'image_generation',
		sourceCollection: 'ai_pin_image_jobs',
		executorModule: 'services/ai-pin-image-queue.js',
		mirrorModule: 'services/queue/mirrors.js#mirrorImageJob',
		startedFrom: 'main.js#startAIPinImageQueue',
		envFlag: 'AI_PIN_IMAGE_QUEUE_ENABLED',
	}),
]);

/** Channel mirror layer — observability upserts into queue_jobs (Phase 9d-1 flag). */
export const CHANNEL_MIRRORS = Object.freeze({
	module: 'services/queue/mirrors.js',
	envFlag: 'QUEUE_MIRRORS_ENABLED',
	functions: Object.freeze([
		'mirrorPinterestJob',
		'mirrorWordpressJob',
		'mirrorImageJob',
	]),
	statusHelper: 'getQueueMirrorsStatus',
});

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

/** Admin Queue dual-read layer — channel SoT + native queue_jobs (Phase 9d-2 flag). */
export const ADMIN_QUEUE_DUAL_READ = Object.freeze({
	module: 'services/queue/admin-read/index.js',
	envFlag: 'ADMIN_QUEUE_DUAL_READ_ENABLED',
	statusHelper: 'getAdminQueueDualReadStatus',
	defaultEnabled: false,
});

/** Where operators and product surfaces read queue state. */
export const QUEUE_CONSUMERS = Object.freeze([
	Object.freeze({
		id: 'admin-queue',
		surface: '/admin/queue',
		primaryStore: 'queue_jobs',
		dualReadFlag: 'ADMIN_QUEUE_DUAL_READ_ENABLED',
		note: 'Unified admin monitor; dual-read merges channel collections when flag enabled',
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
	mirrorRetirement: 'docs/queue-mirror-retirement.md',
	executionSourceOfTruth: 'channel job collections (pinterest_publish_jobs, publish_jobs, ai_pin_image_jobs)',
	adminObservabilityStore: 'queue_jobs',
	channelMirrors: CHANNEL_MIRRORS,
	adminDualRead: ADMIN_QUEUE_DUAL_READ,
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
