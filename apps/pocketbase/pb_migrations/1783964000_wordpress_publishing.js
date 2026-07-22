/// <reference path="../pb_data/types.d.ts" />
/**
 * WordPress publishing: sites, encrypted credentials, publish jobs, history.
 * API-only — managed via apps/api (never expose passwords to clients).
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
		if (findCollectionSafe(app, "wordpress_sites")) {
			return;
		}

		const users = app.findCollectionByNameOrId("users");
		let websites = null;
		try {
			websites = app.findCollectionByNameOrId("websites");
		} catch (_) {
			websites = null;
		}

		const wordpressSites = saveSchemaCollection(
			app,
			newBaseCollection(
				"wordpress_sites",
				[
					relationField("owner", users.id, { required: true, cascadeDelete: false }),
					{ type: "text", name: "workspace_key", required: true, max: 120 },
					{ type: "text", name: "name", required: true, max: 200 },
					{ type: "url", name: "url", required: true },
					{ type: "text", name: "domain", max: 255 },
					{
						type: "select",
						name: "status",
						maxSelect: 1,
						values: ["untested", "connected", "active", "failed", "disabled"],
					},
					{ type: "bool", name: "is_default" },
					{ type: "json", name: "health", maxSize: 100000 },
					{ type: "date", name: "last_tested_at" },
					{ type: "text", name: "last_error", max: 3000 },
					...(websites
						? [relationField("website", websites.id, { cascadeDelete: false })]
						: [{ type: "text", name: "website_id", max: 120 }]),
				],
				[
					"CREATE INDEX `idx_wordpress_sites_owner` ON `wordpress_sites` (`owner`)",
					"CREATE INDEX `idx_wordpress_sites_workspace` ON `wordpress_sites` (`workspace_key`)",
					"CREATE INDEX `idx_wordpress_sites_default` ON `wordpress_sites` (`owner`, `is_default`)",
				],
			),
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"wordpress_credentials",
				[
					relationField("site", wordpressSites.id, { required: true, cascadeDelete: true }),
					relationField("owner", users.id, { required: true, cascadeDelete: true }),
					{ type: "text", name: "username", required: true, max: 200 },
					{ type: "text", name: "ciphertext", required: true, max: 4000 },
					{ type: "text", name: "kek_version", max: 40 },
					{ type: "date", name: "rotated_at" },
				],
				[
					"CREATE UNIQUE INDEX `idx_wordpress_credentials_site` ON `wordpress_credentials` (`site`)",
					"CREATE INDEX `idx_wordpress_credentials_owner` ON `wordpress_credentials` (`owner`)",
				],
			),
		);

		const publishJobs = saveSchemaCollection(
			app,
			newBaseCollection(
				"publish_jobs",
				[
					relationField("owner", users.id, { required: true, cascadeDelete: false }),
					{ type: "text", name: "workspace_key", required: true, max: 120 },
					relationField("site", wordpressSites.id, { required: true, cascadeDelete: false }),
					{ type: "text", name: "article_id", max: 120 },
					{ type: "text", name: "title", required: true, max: 500 },
					{ type: "text", name: "content", required: true, max: 500000 },
					{ type: "text", name: "excerpt", max: 5000 },
					{ type: "text", name: "slug", max: 300 },
					{ type: "text", name: "meta_description", max: 1000 },
					{ type: "text", name: "featured_image_url", max: 2000 },
					{ type: "json", name: "categories", maxSize: 20000 },
					{ type: "json", name: "tags", maxSize: 20000 },
					{ type: "json", name: "seo", maxSize: 50000 },
					{ type: "json", name: "recipe_card", maxSize: 100000 },
					{ type: "json", name: "payload", maxSize: 200000 },
					{
						type: "select",
						name: "wp_status",
						maxSelect: 1,
						values: ["draft", "pending", "private", "publish", "future"],
					},
					{ type: "date", name: "scheduled_at" },
					{ type: "text", name: "timezone", max: 80 },
					{
						type: "select",
						name: "status",
						required: true,
						maxSelect: 1,
						values: ["queued", "scheduled", "publishing", "published", "failed", "cancelled"],
					},
					{ type: "number", name: "progress", min: 0, max: 100 },
					{ type: "number", name: "attempt_count", min: 0 },
					{ type: "number", name: "max_attempts", min: 1 },
					{ type: "date", name: "next_retry_at" },
					{ type: "date", name: "started_at" },
					{ type: "date", name: "completed_at" },
					{ type: "text", name: "last_error", max: 5000 },
					{ type: "number", name: "wp_post_id", min: 0 },
					{ type: "text", name: "wp_post_url", max: 2000 },
					{ type: "number", name: "wp_media_id", min: 0 },
					{ type: "json", name: "media_ids", maxSize: 20000 },
					{ type: "text", name: "claim_token", max: 80 },
					{ type: "number", name: "claim_version", min: 0 },
					{ type: "text", name: "idempotency_key", max: 120 },
					{ type: "bool", name: "dead_letter" },
				],
				[
					"CREATE INDEX `idx_publish_jobs_owner_status` ON `publish_jobs` (`owner`, `status`)",
					"CREATE INDEX `idx_publish_jobs_workspace` ON `publish_jobs` (`workspace_key`)",
					"CREATE INDEX `idx_publish_jobs_scheduled` ON `publish_jobs` (`status`, `scheduled_at`)",
					"CREATE INDEX `idx_publish_jobs_idempotency` ON `publish_jobs` (`idempotency_key`)",
				],
			),
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"publish_history",
				[
					relationField("owner", users.id, { required: true, cascadeDelete: false }),
					{ type: "text", name: "workspace_key", required: true, max: 120 },
					relationField("site", wordpressSites.id, { cascadeDelete: false }),
					relationField("job", publishJobs.id, { cascadeDelete: false }),
					{ type: "text", name: "title", max: 500 },
					{ type: "text", name: "wp_status", max: 40 },
					{
						type: "select",
						name: "result",
						maxSelect: 1,
						values: ["published", "draft", "scheduled", "failed", "cancelled"],
					},
					{ type: "number", name: "wp_post_id", min: 0 },
					{ type: "text", name: "published_url", max: 2000 },
					{ type: "date", name: "published_at" },
					{ type: "number", name: "duration_ms", min: 0 },
					{ type: "text", name: "error", max: 5000 },
					{ type: "json", name: "meta", maxSize: 100000 },
				],
				[
					"CREATE INDEX `idx_publish_history_owner` ON `publish_history` (`owner`, `created`)",
					"CREATE INDEX `idx_publish_history_workspace` ON `publish_history` (`workspace_key`)",
					"CREATE INDEX `idx_publish_history_job` ON `publish_history` (`job`)",
				],
			),
		);
	},
	(app) => {
		for (const name of ["publish_history", "publish_jobs", "wordpress_credentials", "wordpress_sites"]) {
			try {
				app.delete(app.findCollectionByNameOrId(name));
			} catch (_) {
				// ignore
			}
		}
	},
);
