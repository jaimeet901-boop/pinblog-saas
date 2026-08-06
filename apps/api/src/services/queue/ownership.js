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
		startedFrom: 'main.js#startPinterestPublishQueue',
		envFlag: 'PINTEREST_QUEUE_ENABLED',
	}),
	Object.freeze({
		id: 'wordpress-publish',
		jobType: 'wordpress_publishing',
		sourceCollection: 'publish_jobs',
		executorModule: 'services/wordpress-publish-queue.js',
		startedFrom: 'main.js#startWordpressPublishQueue',
		envFlag: 'WORDPRESS_QUEUE_ENABLED',
	}),
	Object.freeze({
		id: 'facebook-publish',
		jobType: 'facebook_publishing',
		sourceCollection: 'facebook_publish_jobs',
		executorModule: 'services/facebook/facebook-publish-queue.js',
		startedFrom: 'main.js#startFacebookPublishQueue',
		envFlag: 'FACEBOOK_QUEUE_ENABLED',
		statusHelper: 'getFacebookQueueStatus',
	}),
	Object.freeze({
		id: 'ai-pin-image',
		jobType: 'image_generation',
		sourceCollection: 'ai_pin_image_jobs',
		executorModule: 'services/ai-pin-image-queue.js',
		startedFrom: 'main.js#startAIPinImageQueue',
		envFlag: 'AI_PIN_IMAGE_QUEUE_ENABLED',
	}),
]);

/** Channel mirror write layer — retired Phase 9d-6. Legacy rows remain in queue_jobs. */
export const CHANNEL_MIRRORS = Object.freeze({
	retired: true,
	statusHelper: 'getQueueMirrorsStatus',
	module: 'services/queue/mirror-status.js',
	note: 'Mirror writes removed in 9d-4; findBySource reads legacy rows until cleanup',
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

/** Admin Queue channel control routing (Phase 9d-3 flag). */
export const ADMIN_QUEUE_CHANNEL_CONTROLS = Object.freeze({
	module: 'services/queue/admin-controls/index.js',
	envFlag: 'ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED',
	statusHelper: 'getAdminQueueChannelControlsStatus',
	defaultEnabled: false,
});

/** Where operators and product surfaces read queue state. */
export const QUEUE_CONSUMERS = Object.freeze([
	Object.freeze({
		id: 'admin-queue',
		surface: '/admin/queue',
		primaryStore: 'queue_jobs',
		dualReadFlag: 'ADMIN_QUEUE_DUAL_READ_ENABLED',
		channelControlsFlag: 'ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED',
		note: 'Unified admin monitor; dual-read merges channel collections when flag enabled',
	}),
	Object.freeze({
		id: 'calendar',
		surface: '/app/calendar',
		primaryStore: 'channel job collections',
		note: 'Channel collections are scheduling SoT; legacy queue_jobs rows optional enrichment only',
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
	executionSourceOfTruth: 'channel job collections (pinterest_publish_jobs, publish_jobs, facebook_publish_jobs, ai_pin_image_jobs)',
	adminObservabilityStore: 'queue_jobs (native) + channel collections (dual-read)',
	channelMirrors: CHANNEL_MIRRORS,
	adminDualRead: ADMIN_QUEUE_DUAL_READ,
	adminChannelControls: ADMIN_QUEUE_CHANNEL_CONTROLS,
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

/**
 * Channel executor runtime catalog for health/ownership surfaces (no I/O).
 */
export function getChannelExecutorRuntimeCatalog() {
	return CHANNEL_EXECUTORS.map((executor) => ({
		id: executor.id,
		jobType: executor.jobType,
		sourceCollection: executor.sourceCollection,
		executorModule: executor.executorModule,
		startedFrom: executor.startedFrom,
		envFlag: executor.envFlag,
		statusHelper: executor.statusHelper || null,
	}));
}
