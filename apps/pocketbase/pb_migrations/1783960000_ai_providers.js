/// <reference path="../pb_data/types.d.ts" />
/**
 * Platform AI provider registry + encrypted secrets (Admin Console).
 * API-only rules — managed exclusively via apps/api superuser client.
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
		if (findCollectionSafe(app, "ai_providers")) {
			return;
		}

		const providers = saveSchemaCollection(
			app,
			newBaseCollection(
				"ai_providers",
				[
					{ type: "text", name: "code", required: true, max: 64 },
					{ type: "text", name: "name", required: true, max: 120 },
					{ type: "text", name: "badge", max: 8 },
					{ type: "text", name: "accent", max: 120 },
					{
						type: "select",
						name: "status",
						maxSelect: 1,
						values: ["connected", "disconnected", "error"],
					},
					{ type: "bool", name: "enabled" },
					{
						type: "select",
						name: "health",
						maxSelect: 1,
						values: ["healthy", "degraded", "unknown", "down"],
					},
					{ type: "date", name: "last_checked" },
					{ type: "text", name: "default_model", max: 200 },
					{ type: "text", name: "base_url", max: 500 },
					{ type: "text", name: "api_version", max: 64 },
					{ type: "text", name: "rate_limit", max: 120 },
					{ type: "text", name: "organization_id", max: 200 },
					{ type: "number", name: "priority", min: 0 },
					{ type: "number", name: "timeout_ms", min: 1000 },
					{ type: "number", name: "retry_count", min: 0 },
					{ type: "text", name: "webhook_url", max: 500 },
					{ type: "text", name: "redirect_uri", max: 500 },
					{ type: "text", name: "scopes", max: 500 },
					{ type: "json", name: "models", maxSize: 100000 },
					{ type: "json", name: "history", maxSize: 200000 },
					{ type: "date", name: "last_success_at" },
					{ type: "text", name: "last_error", max: 2000 },
					{ type: "number", name: "last_latency_ms", min: 0 },
				],
				[
					"CREATE UNIQUE INDEX `idx_ai_providers_code` ON `ai_providers` (`code`)",
					"CREATE INDEX `idx_ai_providers_enabled` ON `ai_providers` (`enabled`)",
					"CREATE INDEX `idx_ai_providers_priority` ON `ai_providers` (`priority`)",
				],
			),
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"ai_provider_secrets",
				[
					relationField("provider", providers.id, { required: true, cascadeDelete: true }),
					{ type: "text", name: "api_key", max: 4000 },
					{ type: "text", name: "secret_key", max: 4000 },
					{ type: "text", name: "kek_version", max: 32 },
					{ type: "date", name: "rotated_at" },
				],
				[
					"CREATE UNIQUE INDEX `idx_ai_provider_secrets_provider` ON `ai_provider_secrets` (`provider`)",
				],
			),
		);
	},
	(app) => {
		const secrets = findCollectionSafe(app, "ai_provider_secrets");
		if (secrets) {
			app.delete(secrets);
		}
		const providers = findCollectionSafe(app, "ai_providers");
		if (providers) {
			app.delete(providers);
		}
	},
);
