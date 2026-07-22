/// <reference path="../pb_data/types.d.ts" />
/**
 * Platform AI model registry (Admin Console).
 * API-only — managed via apps/api superuser client.
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
		if (findCollectionSafe(app, "ai_models")) {
			return;
		}

		const providers = findCollectionSafe(app, "ai_providers");
		if (!providers) {
			throw new Error("ai_models migration requires ai_providers collection");
		}

		saveSchemaCollection(
			app,
			newBaseCollection(
				"ai_models",
				[
					relationField("provider", providers.id, { required: true, cascadeDelete: true }),
					{ type: "text", name: "model_id", required: true, max: 200 },
					{ type: "text", name: "display_name", required: true, max: 200 },
					{
						type: "select",
						name: "capability",
						maxSelect: 1,
						values: ["text", "image", "vision", "embedding"],
					},
					{ type: "json", name: "capabilities", maxSize: 100000 },
					{ type: "number", name: "context_window", min: 0 },
					{ type: "number", name: "input_pricing", min: 0 },
					{ type: "number", name: "output_pricing", min: 0 },
					{ type: "text", name: "pricing_unit", max: 32 },
					{ type: "bool", name: "supports_vision" },
					{ type: "bool", name: "supports_streaming" },
					{ type: "bool", name: "supports_function_calling" },
					{ type: "bool", name: "supports_reasoning" },
					{ type: "bool", name: "is_default" },
					{ type: "bool", name: "enabled" },
					{
						type: "select",
						name: "status",
						maxSelect: 1,
						values: ["enabled", "disabled", "deprecated"],
					},
					{ type: "number", name: "priority", min: 0 },
					{ type: "text", name: "version", max: 64 },
					{ type: "text", name: "fallback_model_id", max: 200 },
					{ type: "json", name: "features", maxSize: 100000 },
					{ type: "json", name: "recommended", maxSize: 100000 },
				],
				[
					"CREATE UNIQUE INDEX `idx_ai_models_provider_model` ON `ai_models` (`provider`, `model_id`)",
					"CREATE INDEX `idx_ai_models_capability` ON `ai_models` (`capability`)",
					"CREATE INDEX `idx_ai_models_status` ON `ai_models` (`status`)",
					"CREATE INDEX `idx_ai_models_priority` ON `ai_models` (`priority`)",
				],
			),
		);
	},
	(app) => {
		const models = findCollectionSafe(app, "ai_models");
		if (models) {
			app.delete(models);
		}
	},
);
