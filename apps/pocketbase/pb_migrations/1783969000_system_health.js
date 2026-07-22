/// <reference path="../pb_data/types.d.ts" />
/**
 * Phase 10: System health & monitoring.
 * Collections: system_health, service_status, worker_health, provider_health, health_incidents.
 * API-only — admin console reads via API.
 */

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
			findCollectionSafe(app, "system_health")
			&& findCollectionSafe(app, "service_status")
			&& findCollectionSafe(app, "worker_health")
			&& findCollectionSafe(app, "provider_health")
			&& findCollectionSafe(app, "health_incidents")
		) {
			return;
		}

		if (!findCollectionSafe(app, "system_health")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"system_health",
					[
						{
							type: "select",
							name: "overall_status",
							required: true,
							maxSelect: 1,
							values: ["healthy", "warning", "critical", "degraded"],
						},
						{ type: "text", name: "uptime_pct", max: 40 },
						{ type: "text", name: "system_uptime", max: 80 },
						{ type: "number", name: "services_online", min: 0 },
						{ type: "number", name: "services_offline", min: 0 },
						{ type: "number", name: "avg_response_ms", min: 0 },
						{ type: "number", name: "cpu_pct", min: 0 },
						{ type: "number", name: "memory_pct", min: 0 },
						{ type: "number", name: "disk_pct", min: 0 },
						{ type: "number", name: "network_ms", min: 0 },
						{ type: "text", name: "last_incident", max: 500 },
						{ type: "json", name: "payload", maxSize: 500000 },
						{ type: "json", name: "resources", maxSize: 200000 },
						{ type: "date", name: "checked_at" },
					],
					[
						"CREATE INDEX `idx_system_health_checked` ON `system_health` (`checked_at`)",
						"CREATE INDEX `idx_system_health_status` ON `system_health` (`overall_status`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "service_status")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"service_status",
					[
						{ type: "text", name: "service_key", required: true, max: 80 },
						{ type: "text", name: "name", required: true, max: 120 },
						{ type: "text", name: "group", max: 80 },
						{
							type: "select",
							name: "status",
							required: true,
							maxSelect: 1,
							values: ["healthy", "warning", "critical", "degraded", "offline"],
						},
						{ type: "number", name: "response_ms", min: 0 },
						{ type: "text", name: "uptime_pct", max: 40 },
						{ type: "text", name: "version", max: 80 },
						{ type: "text", name: "detail", max: 1000 },
						{ type: "json", name: "meta", maxSize: 100000 },
						{ type: "date", name: "last_checked" },
					],
					[
						"CREATE UNIQUE INDEX `idx_service_status_key` ON `service_status` (`service_key`)",
						"CREATE INDEX `idx_service_status_group` ON `service_status` (`group`)",
						"CREATE INDEX `idx_service_status_status` ON `service_status` (`status`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "worker_health")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"worker_health",
					[
						{ type: "text", name: "worker_key", required: true, max: 120 },
						{ type: "text", name: "name", max: 120 },
						{
							type: "select",
							name: "status",
							required: true,
							maxSelect: 1,
							values: ["online", "offline", "degraded", "stale"],
						},
						{ type: "text", name: "current_job", max: 120 },
						{ type: "number", name: "jobs_processed", min: 0 },
						{ type: "number", name: "latency_ms", min: 0 },
						{ type: "json", name: "meta", maxSize: 100000 },
						{ type: "date", name: "last_heartbeat" },
					],
					[
						"CREATE UNIQUE INDEX `idx_worker_health_key` ON `worker_health` (`worker_key`)",
						"CREATE INDEX `idx_worker_health_status` ON `worker_health` (`status`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "provider_health")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"provider_health",
					[
						{ type: "text", name: "provider_key", required: true, max: 80 },
						{ type: "text", name: "name", required: true, max: 120 },
						{ type: "text", name: "kind", max: 40 },
						{
							type: "select",
							name: "status",
							required: true,
							maxSelect: 1,
							values: ["healthy", "warning", "critical", "degraded", "offline", "disabled"],
						},
						{ type: "number", name: "avg_response_ms", min: 0 },
						{ type: "number", name: "error_rate", min: 0 },
						{ type: "text", name: "quota_label", max: 120 },
						{ type: "text", name: "detail", max: 1000 },
						{ type: "bool", name: "auth_error" },
						{ type: "bool", name: "quota_error" },
						{ type: "json", name: "meta", maxSize: 100000 },
						{ type: "date", name: "last_success_at" },
						{ type: "date", name: "last_checked" },
					],
					[
						"CREATE UNIQUE INDEX `idx_provider_health_key` ON `provider_health` (`provider_key`)",
						"CREATE INDEX `idx_provider_health_status` ON `provider_health` (`status`)",
						"CREATE INDEX `idx_provider_health_kind` ON `provider_health` (`kind`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "health_incidents")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"health_incidents",
					[
						{ type: "text", name: "incident_key", max: 160 },
						{ type: "text", name: "title", required: true, max: 300 },
						{ type: "text", name: "type", max: 80 },
						{ type: "text", name: "service", max: 120 },
						{
							type: "select",
							name: "severity",
							required: true,
							maxSelect: 1,
							values: ["info", "warning", "critical"],
						},
						{
							type: "select",
							name: "status",
							required: true,
							maxSelect: 1,
							values: ["open", "acknowledged", "resolved"],
						},
						{ type: "text", name: "message", max: 2000 },
						{ type: "bool", name: "is_alert" },
						{ type: "json", name: "meta", maxSize: 100000 },
						{ type: "date", name: "started_at" },
						{ type: "date", name: "acknowledged_at" },
						{ type: "date", name: "resolved_at" },
					],
					[
						"CREATE INDEX `idx_health_incidents_status` ON `health_incidents` (`status`)",
						"CREATE INDEX `idx_health_incidents_severity` ON `health_incidents` (`severity`)",
						"CREATE INDEX `idx_health_incidents_started` ON `health_incidents` (`started_at`)",
						"CREATE INDEX `idx_health_incidents_key` ON `health_incidents` (`incident_key`)",
						"CREATE INDEX `idx_health_incidents_alert` ON `health_incidents` (`is_alert`)",
					],
				),
			);
		}
	},
	(app) => {
		for (const name of [
			"health_incidents",
			"provider_health",
			"worker_health",
			"service_status",
			"system_health",
		]) {
			const collection = findCollectionSafe(app, name);
			if (collection) app.delete(collection);
		}
	},
);
