/// <reference path="../pb_data/types.d.ts" />
/**
 * Module 7 — Pin Generation runs (metadata separate from templates).
 * Templates are never written by generation; only referenced + snapshotted.
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

const STAGES = [
	"queued",
	"preparing",
	"generating_image",
	"resolving_variables",
	"rendering",
	"exporting",
	"completed",
	"failed",
	"cancelled",
];

const IMAGE_MODES = ["generate_ai", "use_featured", "provided_url"];

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

function deleteCollectionSafe(app, name) {
	const collection = findCollectionSafe(app, name);
	if (collection) {
		app.delete(collection);
	}
}

migrate(
	(app) => {
		if (findCollectionSafe(app, "ai_pin_generation_runs")) {
			return;
		}

		const users = app.findCollectionByNameOrId("users");
		const workspaces = findCollectionSafe(app, "workspaces");

		const fields = [
			relationField("owner", users.id, { required: true }),
			relationField("created_by", users.id, { required: true }),
			workspaces
				? relationField("workspace_id", workspaces.id, { required: false })
				: { type: "text", name: "workspace_id", required: false, max: 80 },
			{
				name: "status",
				type: "select",
				required: true,
				maxSelect: 1,
				values: STAGES,
			},
			{
				name: "stage",
				type: "select",
				required: true,
				maxSelect: 1,
				values: STAGES,
			},
			{ name: "progress", type: "number", required: false, min: 0, max: 100 },
			{ name: "template_id", type: "text", required: false, max: 80 },
			{ name: "template_uuid", type: "text", required: false, max: 80 },
			{ name: "template_checksum", type: "text", required: false, max: 128 },
			{ name: "export_profile_id", type: "text", required: false, max: 80 },
			{ name: "output_format", type: "text", required: false, max: 20 },
			{ name: "image_provider", type: "text", required: false, max: 40 },
			{
				name: "image_mode",
				type: "select",
				required: true,
				maxSelect: 1,
				values: IMAGE_MODES,
			},
			{ name: "image_job_id", type: "text", required: false, max: 80 },
			{ name: "ai_pin_id", type: "text", required: false, max: 80 },
			{ name: "article_id", type: "text", required: false, max: 80 },
			{ name: "client_token", type: "text", required: false, max: 120 },
			/** Full request choices + content (not template mutations). */
			{ name: "request_snapshot", type: "json", required: false },
			/** Deep-cloned template configuration used for this run only. */
			{ name: "template_snapshot", type: "json", required: false },
			/** Ordered step log entries. */
			{ name: "steps", type: "json", required: false },
			{ name: "result", type: "json", required: false },
			{ name: "last_error", type: "text", required: false, max: 2000 },
			{ name: "error_code", type: "text", required: false, max: 80 },
			{ name: "attempt_count", type: "number", required: false, min: 0 },
			{ name: "max_attempts", type: "number", required: false, min: 1 },
			{ name: "next_retry_at", type: "date", required: false },
			/**
			 * Extension bag: batchId, variantId, locale, scheduleAt, teamId, abGroup, etc.
			 */
			{ name: "extensions", type: "json", required: false },
			{ name: "correlation_id", type: "text", required: false, max: 120 },
			{ name: "started_at", type: "date", required: false },
			{ name: "completed_at", type: "date", required: false },
			{ name: "cancelled_at", type: "date", required: false },
			{ name: "deleted_at", type: "date", required: false },
		].concat(AUTODATE_FIELDS);

		const collection = new Collection({
			type: "base",
			name: "ai_pin_generation_runs",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			indexes: [
				"CREATE INDEX idx_gen_runs_owner_status ON ai_pin_generation_runs (owner, status)",
				"CREATE INDEX idx_gen_runs_workspace_status ON ai_pin_generation_runs (workspace_id, status)",
				"CREATE INDEX idx_gen_runs_image_job ON ai_pin_generation_runs (image_job_id)",
				"CREATE INDEX idx_gen_runs_correlation ON ai_pin_generation_runs (correlation_id)",
			],
			fields,
		});

		app.save(collection);
	},
	(app) => {
		deleteCollectionSafe(app, "ai_pin_generation_runs");
	},
);
