/// <reference path="../pb_data/types.d.ts" />
/**
 * Phase 7: Unified queue engine — queue_jobs, queue_workers, queue_metrics, queue_job_events.
 * API-only. Specialized WP/Pinterest/image queues dual-write into queue_jobs.
 */

function relationField(name, collectionId, options = {}) {
	return {
		name,
		type: "relation",
		required: options.required === true,
		maxSelect: options.maxSelect ?? 1,
		collectionId,
		cascadeDelete: options.cascadeDelete === true,
	};
}

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

function saveSchemaCollection(app, collection) {
	collection.listRule = null;
	collection.viewRule = null;
	collection.createRule = null;
	collection.updateRule = null;
	collection.deleteRule = null;
	app.save(collection);
	return app.findCollectionByNameOrId(collection.id || collection.name);
}

function newBaseCollection(name, fields, indexes = []) {
	return new Collection({
		type: "base",
		name,
		listRule: null,
		viewRule: null,
		createRule: null,
		updateRule: null,
		deleteRule: null,
		indexes,
		fields: fields.concat(AUTODATE_FIELDS),
	});
}

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

const JOB_TYPES = [
	"ai_article_generation",
	"recipe_generation",
	"image_generation",
	"ai_pin_analyze",
	"ai_pin_prompt",
	"pinterest_publishing",
	"wordpress_publishing",
	"bulk_publishing",
	"seo_optimization",
	"template_rendering",
	"website_scan",
	"import",
	"export",
	"webhook_delivery",
	"email_notification",
	"notification",
	"media_upload",
	"analytics_refresh",
	"health_check",
];

const JOB_STATUSES = [
	"pending",
	"queued",
	"waiting",
	"running",
	"retrying",
	"completed",
	"cancelled",
	"failed",
	"paused",
];

migrate(
	(app) => {
		if (findCollectionSafe(app, "queue_jobs") && findCollectionSafe(app, "queue_workers") && findCollectionSafe(app, "queue_metrics")) {
			return;
		}

		const users = app.findCollectionByNameOrId("users");
		const workspaces = findCollectionSafe(app, "workspaces");

		if (!findCollectionSafe(app, "queue_jobs")) {
			const jobFields = [
				relationField("owner", users.id, { required: true, cascadeDelete: true }),
				{ type: "text", name: "workspace_key", max: 120 },
				{ type: "text", name: "workspace_label", max: 200 },
				{
					type: "select",
					name: "type",
					required: true,
					maxSelect: 1,
					values: JOB_TYPES,
				},
				{
					type: "select",
					name: "status",
					required: true,
					maxSelect: 1,
					values: JOB_STATUSES,
				},
				{
					type: "select",
					name: "priority",
					maxSelect: 1,
					values: ["low", "normal", "high", "critical"],
				},
				{ type: "json", name: "payload", maxSize: 500000 },
				{ type: "json", name: "inputs", maxSize: 500000 },
				{ type: "json", name: "outputs", maxSize: 500000 },
				{ type: "number", name: "progress", min: 0, max: 100 },
				{ type: "number", name: "attempt_count", min: 0 },
				{ type: "number", name: "max_attempts", min: 1 },
				{ type: "date", name: "started_at" },
				{ type: "date", name: "completed_at" },
				{ type: "number", name: "duration_ms", min: 0 },
				{ type: "text", name: "worker_id", max: 120 },
				{ type: "text", name: "error", max: 4000 },
				{ type: "text", name: "failure_reason", max: 4000 },
				{ type: "text", name: "provider", max: 120 },
				{ type: "text", name: "model", max: 120 },
				{ type: "number", name: "credits", min: 0 },
				{ type: "date", name: "next_retry_at" },
				{ type: "bool", name: "dead_letter" },
				{ type: "text", name: "claim_token", max: 80 },
				{ type: "number", name: "claim_version", min: 0 },
				{ type: "text", name: "source_collection", max: 80 },
				{ type: "text", name: "source_id", max: 40 },
				{ type: "text", name: "correlation_id", max: 120 },
				{ type: "date", name: "paused_at" },
				{ type: "json", name: "meta", maxSize: 200000 },
			];
			if (workspaces) {
				jobFields.splice(1, 0, relationField("workspace", workspaces.id, { cascadeDelete: false }));
			}

			saveSchemaCollection(
				app,
				newBaseCollection(
					"queue_jobs",
					jobFields,
					[
						"CREATE INDEX `idx_queue_jobs_status_priority` ON `queue_jobs` (`status`, `priority`, `created`)",
						"CREATE INDEX `idx_queue_jobs_owner` ON `queue_jobs` (`owner`)",
						"CREATE INDEX `idx_queue_jobs_type` ON `queue_jobs` (`type`)",
						"CREATE INDEX `idx_queue_jobs_source` ON `queue_jobs` (`source_collection`, `source_id`)",
						"CREATE INDEX `idx_queue_jobs_worker` ON `queue_jobs` (`worker_id`)",
						"CREATE INDEX `idx_queue_jobs_dead` ON `queue_jobs` (`dead_letter`)",
						"CREATE INDEX `idx_queue_jobs_workspace_key` ON `queue_jobs` (`workspace_key`)",
					],
				),
			);
		}

		const jobs = app.findCollectionByNameOrId("queue_jobs");

		if (!findCollectionSafe(app, "queue_job_events")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"queue_job_events",
					[
						relationField("job", jobs.id, { required: true, cascadeDelete: true }),
						relationField("owner", users.id, { cascadeDelete: true }),
						{ type: "date", name: "at" },
						{
							type: "select",
							name: "level",
							maxSelect: 1,
							values: ["debug", "info", "warn", "error"],
						},
						{ type: "text", name: "message", required: true, max: 2000 },
						{ type: "json", name: "payload", maxSize: 200000 },
					],
					[
						"CREATE INDEX `idx_queue_job_events_job` ON `queue_job_events` (`job`, `created`)",
						"CREATE INDEX `idx_queue_job_events_owner` ON `queue_job_events` (`owner`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "queue_workers")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"queue_workers",
					[
						{ type: "text", name: "worker_id", required: true, max: 120 },
						{
							type: "select",
							name: "status",
							required: true,
							maxSelect: 1,
							values: ["online", "offline", "draining", "stale"],
						},
						{ type: "json", name: "job_types", maxSize: 50000 },
						{ type: "number", name: "concurrency", min: 1 },
						{ type: "text", name: "current_job", max: 40 },
						{ type: "date", name: "last_heartbeat" },
						{ type: "number", name: "jobs_today", min: 0 },
						{ type: "number", name: "avg_duration_ms", min: 0 },
						{ type: "number", name: "cpu_pct", min: 0, max: 100 },
						{ type: "number", name: "memory_pct", min: 0, max: 100 },
						{ type: "number", name: "timeout_ms", min: 0 },
						{ type: "json", name: "meta", maxSize: 100000 },
					],
					[
						"CREATE UNIQUE INDEX `idx_queue_workers_worker_id` ON `queue_workers` (`worker_id`)",
						"CREATE INDEX `idx_queue_workers_status` ON `queue_workers` (`status`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "queue_metrics")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"queue_metrics",
					[
						{ type: "text", name: "bucket_key", required: true, max: 80 },
						{ type: "date", name: "bucket_at" },
						{ type: "number", name: "jobs_per_minute", min: 0 },
						{ type: "number", name: "avg_duration_ms", min: 0 },
						{ type: "number", name: "failure_rate", min: 0, max: 100 },
						{ type: "number", name: "retry_rate", min: 0, max: 100 },
						{ type: "number", name: "queue_size", min: 0 },
						{ type: "number", name: "workers_online", min: 0 },
						{ type: "number", name: "workers_total", min: 0 },
						{ type: "number", name: "running", min: 0 },
						{ type: "number", name: "queued", min: 0 },
						{ type: "number", name: "failed", min: 0 },
						{ type: "number", name: "retrying", min: 0 },
						{ type: "number", name: "completed_today", min: 0 },
						{ type: "bool", name: "paused" },
						{ type: "json", name: "meta", maxSize: 200000 },
					],
					[
						"CREATE UNIQUE INDEX `idx_queue_metrics_bucket` ON `queue_metrics` (`bucket_key`)",
						"CREATE INDEX `idx_queue_metrics_at` ON `queue_metrics` (`bucket_at`)",
					],
				),
			);
		}
	},
	(app) => {
		for (const name of ["queue_job_events", "queue_metrics", "queue_workers", "queue_jobs"]) {
			const collection = findCollectionSafe(app, name);
			if (collection) app.delete(collection);
		}
	},
);
