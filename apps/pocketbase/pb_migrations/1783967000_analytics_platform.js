/// <reference path="../pb_data/types.d.ts" />
/**
 * Phase 8: Analytics platform — daily rollups + response cache.
 * API-only. Populated by aggregation services / queue analytics_refresh jobs.
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
		if (findCollectionSafe(app, "analytics_daily") && findCollectionSafe(app, "analytics_cache")) {
			return;
		}

		const users = findCollectionSafe(app, "users");
		const workspaces = findCollectionSafe(app, "workspaces");

		if (!findCollectionSafe(app, "analytics_daily")) {
			const fields = [
				{ type: "text", name: "scope", required: true, max: 40 },
				{ type: "text", name: "scope_key", required: true, max: 120 },
				{ type: "date", name: "day", required: true },
				{ type: "text", name: "metric", required: true, max: 80 },
				{ type: "number", name: "value", min: 0 },
				{ type: "json", name: "dimensions", maxSize: 100000 },
				{ type: "json", name: "meta", maxSize: 100000 },
			];
			if (users) fields.push(relationField("owner", users.id, { cascadeDelete: true }));
			if (workspaces) fields.push(relationField("workspace", workspaces.id, { cascadeDelete: true }));

			saveSchemaCollection(
				app,
				newBaseCollection(
					"analytics_daily",
					fields,
					[
						"CREATE UNIQUE INDEX `idx_analytics_daily_unique` ON `analytics_daily` (`scope`, `scope_key`, `day`, `metric`)",
						"CREATE INDEX `idx_analytics_daily_day` ON `analytics_daily` (`day`)",
						"CREATE INDEX `idx_analytics_daily_metric` ON `analytics_daily` (`metric`)",
						"CREATE INDEX `idx_analytics_daily_scope` ON `analytics_daily` (`scope`, `scope_key`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "analytics_cache")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"analytics_cache",
					[
						{ type: "text", name: "cache_key", required: true, max: 180 },
						{ type: "text", name: "scope", required: true, max: 40 },
						{ type: "text", name: "scope_key", max: 120 },
						{ type: "text", name: "range_key", max: 40 },
						{ type: "json", name: "payload", maxSize: 2000000 },
						{ type: "date", name: "computed_at" },
						{ type: "date", name: "expires_at" },
						{ type: "number", name: "ttl_seconds", min: 0 },
						{ type: "bool", name: "stale" },
						{ type: "json", name: "meta", maxSize: 50000 },
					],
					[
						"CREATE UNIQUE INDEX `idx_analytics_cache_key` ON `analytics_cache` (`cache_key`)",
						"CREATE INDEX `idx_analytics_cache_expires` ON `analytics_cache` (`expires_at`)",
						"CREATE INDEX `idx_analytics_cache_scope` ON `analytics_cache` (`scope`, `scope_key`)",
					],
				),
			);
		}
	},
	(app) => {
		for (const name of ["analytics_cache", "analytics_daily"]) {
			const collection = findCollectionSafe(app, name);
			if (collection) app.delete(collection);
		}
	},
);
