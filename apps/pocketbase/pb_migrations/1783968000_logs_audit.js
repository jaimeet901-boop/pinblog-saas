/// <reference path="../pb_data/types.d.ts" />
/**
 * Phase 9: Logs & audit platform.
 * Collections: audit_logs, system_logs, security_events, api_requests, login_history.
 * API-only — never expose secrets to clients.
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

migrate(
	(app) => {
		if (
			findCollectionSafe(app, "audit_logs")
			&& findCollectionSafe(app, "system_logs")
			&& findCollectionSafe(app, "security_events")
			&& findCollectionSafe(app, "api_requests")
			&& findCollectionSafe(app, "login_history")
		) {
			return;
		}

		const users = app.findCollectionByNameOrId("users");
		const workspaces = findCollectionSafe(app, "workspaces");

		if (!findCollectionSafe(app, "audit_logs")) {
			const fields = [
				{
					type: "select",
					name: "category",
					required: true,
					maxSelect: 1,
					values: ["auth", "admin", "billing", "ai", "publishing", "security", "system", "queue", "api", "settings"],
				},
				{ type: "text", name: "ui_category", max: 80 },
				{
					type: "select",
					name: "severity",
					required: true,
					maxSelect: 1,
					values: ["debug", "info", "warn", "error", "critical", "success"],
				},
				{ type: "text", name: "ui_severity", max: 40 },
				relationField("actor_user", users.id, { cascadeDelete: false }),
				{ type: "text", name: "actor_label", max: 200 },
				{ type: "text", name: "workspace_key", max: 120 },
				{ type: "text", name: "workspace_label", max: 200 },
				{ type: "text", name: "service", max: 120 },
				{ type: "text", name: "action", required: true, max: 500 },
				{ type: "text", name: "message", max: 2000 },
				{
					type: "select",
					name: "result",
					maxSelect: 1,
					values: ["success", "ok", "denied", "failure", "failed", "degraded", "queued", "throttled"],
				},
				{ type: "text", name: "resource_type", max: 80 },
				{ type: "text", name: "resource_id", max: 80 },
				{ type: "text", name: "ip", max: 80 },
				{ type: "text", name: "user_agent", max: 500 },
				{ type: "text", name: "provider", max: 120 },
				{ type: "text", name: "model", max: 120 },
				{ type: "number", name: "credits", min: 0 },
				{ type: "number", name: "duration_ms", min: 0 },
				{ type: "text", name: "correlation_id", max: 120 },
				{ type: "json", name: "request", maxSize: 200000 },
				{ type: "json", name: "response", maxSize: 200000 },
				{ type: "json", name: "headers", maxSize: 50000 },
				{ type: "json", name: "metadata", maxSize: 200000 },
				{ type: "json", name: "timeline", maxSize: 100000 },
				{ type: "date", name: "occurred_at" },
			];
			if (workspaces) {
				fields.splice(6, 0, relationField("workspace", workspaces.id, { cascadeDelete: false }));
			}

			saveSchemaCollection(
				app,
				newBaseCollection(
					"audit_logs",
					fields,
					[
						"CREATE INDEX `idx_audit_logs_created` ON `audit_logs` (`created`)",
						"CREATE INDEX `idx_audit_logs_occurred` ON `audit_logs` (`occurred_at`)",
						"CREATE INDEX `idx_audit_logs_category_sev` ON `audit_logs` (`category`, `severity`)",
						"CREATE INDEX `idx_audit_logs_actor` ON `audit_logs` (`actor_user`)",
						"CREATE INDEX `idx_audit_logs_workspace_key` ON `audit_logs` (`workspace_key`)",
						"CREATE INDEX `idx_audit_logs_correlation` ON `audit_logs` (`correlation_id`)",
						"CREATE INDEX `idx_audit_logs_ui_category` ON `audit_logs` (`ui_category`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "system_logs")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"system_logs",
					[
						{
							type: "select",
							name: "level",
							required: true,
							maxSelect: 1,
							values: ["debug", "info", "warn", "error", "critical"],
						},
						{ type: "text", name: "source", max: 120 },
						{ type: "text", name: "message", required: true, max: 4000 },
						{ type: "json", name: "meta", maxSize: 100000 },
						{ type: "date", name: "occurred_at" },
					],
					[
						"CREATE INDEX `idx_system_logs_level` ON `system_logs` (`level`)",
						"CREATE INDEX `idx_system_logs_occurred` ON `system_logs` (`occurred_at`)",
						"CREATE INDEX `idx_system_logs_source` ON `system_logs` (`source`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "security_events")) {
			const fields = [
				relationField("actor_user", users.id, { cascadeDelete: false }),
				{ type: "text", name: "actor_label", max: 200 },
				{ type: "text", name: "event_type", required: true, max: 80 },
				{ type: "text", name: "title", required: true, max: 200 },
				{ type: "text", name: "detail", max: 2000 },
				{ type: "text", name: "ip", max: 80 },
				{
					type: "select",
					name: "severity",
					maxSelect: 1,
					values: ["info", "warn", "error", "critical"],
				},
				{ type: "json", name: "meta", maxSize: 100000 },
				{ type: "date", name: "occurred_at" },
			];
			saveSchemaCollection(
				app,
				newBaseCollection(
					"security_events",
					fields,
					[
						"CREATE INDEX `idx_security_events_type` ON `security_events` (`event_type`)",
						"CREATE INDEX `idx_security_events_occurred` ON `security_events` (`occurred_at`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "api_requests")) {
			const fields = [
				relationField("actor_user", users.id, { cascadeDelete: false }),
				{ type: "text", name: "method", max: 16 },
				{ type: "text", name: "path", required: true, max: 500 },
				{ type: "number", name: "status", min: 0 },
				{ type: "number", name: "duration_ms", min: 0 },
				{ type: "text", name: "ip", max: 80 },
				{ type: "text", name: "user_agent", max: 500 },
				{ type: "text", name: "correlation_id", max: 120 },
				{ type: "json", name: "meta", maxSize: 100000 },
				{ type: "date", name: "occurred_at" },
			];
			saveSchemaCollection(
				app,
				newBaseCollection(
					"api_requests",
					fields,
					[
						"CREATE INDEX `idx_api_requests_path` ON `api_requests` (`path`)",
						"CREATE INDEX `idx_api_requests_occurred` ON `api_requests` (`occurred_at`)",
						"CREATE INDEX `idx_api_requests_status` ON `api_requests` (`status`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "login_history")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"login_history",
					[
						relationField("user", users.id, { cascadeDelete: true }),
						{ type: "text", name: "email", max: 255 },
						{
							type: "select",
							name: "event",
							required: true,
							maxSelect: 1,
							values: ["login", "logout", "failed_login", "session_expired"],
						},
						{ type: "bool", name: "success" },
						{ type: "text", name: "ip", max: 80 },
						{ type: "text", name: "user_agent", max: 500 },
						{ type: "text", name: "reason", max: 500 },
						{ type: "json", name: "meta", maxSize: 50000 },
						{ type: "date", name: "occurred_at" },
					],
					[
						"CREATE INDEX `idx_login_history_user` ON `login_history` (`user`)",
						"CREATE INDEX `idx_login_history_event` ON `login_history` (`event`)",
						"CREATE INDEX `idx_login_history_occurred` ON `login_history` (`occurred_at`)",
					],
				),
			);
		}
	},
	(app) => {
		for (const name of ["login_history", "api_requests", "security_events", "system_logs", "audit_logs"]) {
			const collection = findCollectionSafe(app, name);
			if (collection) app.delete(collection);
		}
	},
);
