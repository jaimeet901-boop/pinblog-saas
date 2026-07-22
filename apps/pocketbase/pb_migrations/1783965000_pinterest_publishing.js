/// <reference path="../pb_data/types.d.ts" />
/**
 * Pinterest Phase 6: dedicated encrypted tokens + publish history ledger.
 * Complements existing pinterest_account_secrets / pinterest_publish_jobs.
 * API-only — tokens never exposed to clients.
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
		if (findCollectionSafe(app, "pinterest_tokens") && findCollectionSafe(app, "pinterest_publish_history")) {
			return;
		}

		const users = app.findCollectionByNameOrId("users");
		const accounts = app.findCollectionByNameOrId("pinterest_accounts");
		const jobs = app.findCollectionByNameOrId("pinterest_publish_jobs");

		if (!findCollectionSafe(app, "pinterest_tokens")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"pinterest_tokens",
					[
						relationField("owner", users.id, { required: true, cascadeDelete: true }),
						relationField("account", accounts.id, { required: true, cascadeDelete: true }),
						{ type: "text", name: "access_ciphertext", required: true, max: 4000 },
						{ type: "text", name: "refresh_ciphertext", max: 4000 },
						{ type: "text", name: "kek_version", max: 40 },
						{ type: "date", name: "expires_at" },
						{ type: "date", name: "rotated_at" },
						{ type: "text", name: "scopes", max: 1000 },
					],
					[
						"CREATE UNIQUE INDEX `idx_pinterest_tokens_account` ON `pinterest_tokens` (`account`)",
						"CREATE INDEX `idx_pinterest_tokens_owner` ON `pinterest_tokens` (`owner`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "pinterest_publish_history")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"pinterest_publish_history",
					[
						relationField("owner", users.id, { required: true, cascadeDelete: false }),
						relationField("account", accounts.id, { cascadeDelete: false }),
						relationField("job", jobs.id, { cascadeDelete: false }),
						{ type: "text", name: "workspace_key", max: 120 },
						{ type: "text", name: "title", max: 500 },
						{ type: "text", name: "board_id", max: 120 },
						{ type: "text", name: "board_name", max: 300 },
						{
							type: "select",
							name: "result",
							maxSelect: 1,
							values: ["published", "failed", "cancelled", "scheduled"],
						},
						{ type: "text", name: "pinterest_pin_id", max: 120 },
						{ type: "text", name: "pinterest_pin_url", max: 1000 },
						{ type: "date", name: "published_at" },
						{ type: "number", name: "duration_ms", min: 0 },
						{ type: "number", name: "attempt_count", min: 0 },
						{ type: "text", name: "error", max: 5000 },
						{ type: "json", name: "meta", maxSize: 100000 },
					],
					[
						"CREATE INDEX `idx_pinterest_publish_history_owner` ON `pinterest_publish_history` (`owner`, `created`)",
						"CREATE INDEX `idx_pinterest_publish_history_job` ON `pinterest_publish_history` (`job`)",
						"CREATE INDEX `idx_pinterest_publish_history_result` ON `pinterest_publish_history` (`result`)",
					],
				),
			);
		}
	},
	(app) => {
		for (const name of ["pinterest_publish_history", "pinterest_tokens"]) {
			try {
				app.delete(app.findCollectionByNameOrId(name));
			} catch (_) {
				// ignore
			}
		}
	},
);
