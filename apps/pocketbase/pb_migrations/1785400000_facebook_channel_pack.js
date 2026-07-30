/// <reference path="../pb_data/types.d.ts" />
/**
 * Facebook Channel Pack — F1-Apply
 *
 * Creates approved facebook_* collections + indexes with API-only rules.
 * Does NOT implement OAuth, Graph, publish, or workers.
 *
 * See docs/facebook-channel-pack-schema.md
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

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

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

function requireCollection(app, name) {
	const collection = findCollectionSafe(app, name);
	if (!collection) {
		throw new Error(`Facebook channel pack migration requires collection "${name}"`);
	}
	return collection;
}

migrate(
	(app) => {
		if (findCollectionSafe(app, "facebook_accounts") && findCollectionSafe(app, "facebook_publish_jobs")) {
			return;
		}

		const users = requireCollection(app, "users");
		const workspaces = requireCollection(app, "workspaces");
		const websites = requireCollection(app, "websites");
		const websiteArticles = requireCollection(app, "website_articles");
		const aiPins = requireCollection(app, "ai_pins");

		const accounts = findCollectionSafe(app, "facebook_accounts")
			|| saveSchemaCollection(
				app,
				newBaseCollection(
					"facebook_accounts",
					[
						relationField("owner", users.id, { required: true, cascadeDelete: true }),
						relationField("workspace", workspaces.id, { required: true, cascadeDelete: false }),
						{ type: "text", name: "facebook_user_id", required: true, max: 120 },
						{ type: "text", name: "username", max: 255 },
						{ type: "text", name: "label", max: 255 },
						{ type: "text", name: "account_name", max: 255 },
						{ type: "text", name: "profile_image_url", max: 1000 },
						{ type: "text", name: "scope", max: 2000 },
						{ type: "bool", name: "connected" },
						{
							type: "select",
							name: "status",
							maxSelect: 1,
							values: ["connected", "expired", "error", "disconnected"],
						},
						{ type: "text", name: "status_error", max: 2000 },
						{ type: "date", name: "token_expires_at" },
						{ type: "date", name: "last_sync_at" },
						{ type: "date", name: "connected_at" },
						{ type: "bool", name: "is_default" },
						{ type: "text", name: "oauth_app_id", max: 200 },
						{ type: "text", name: "workspace_key", max: 120 },
					],
					[
						"CREATE UNIQUE INDEX `idx_facebook_accounts_workspace_user` ON `facebook_accounts` (`workspace`, `facebook_user_id`)",
						"CREATE INDEX `idx_facebook_accounts_workspace` ON `facebook_accounts` (`workspace`)",
						"CREATE INDEX `idx_facebook_accounts_owner` ON `facebook_accounts` (`owner`)",
						"CREATE INDEX `idx_facebook_accounts_connected` ON `facebook_accounts` (`connected`)",
						"CREATE INDEX `idx_isolation_facebook_accounts_workspace` ON `facebook_accounts` (`workspace`)",
					],
				),
			);

		if (!findCollectionSafe(app, "facebook_account_secrets")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"facebook_account_secrets",
					[
						relationField("owner", users.id, { required: true, cascadeDelete: true }),
						relationField("workspace", workspaces.id, { required: true, cascadeDelete: false }),
						relationField("account", accounts.id, { required: true, cascadeDelete: true }),
						{ type: "text", name: "access_token", max: 4000 },
						{ type: "text", name: "refresh_token", max: 4000 },
						{ type: "json", name: "page_tokens", maxSize: 200000 },
					],
					[
						"CREATE UNIQUE INDEX `idx_facebook_account_secrets_account` ON `facebook_account_secrets` (`account`)",
						"CREATE INDEX `idx_facebook_account_secrets_workspace` ON `facebook_account_secrets` (`workspace`)",
						"CREATE INDEX `idx_facebook_account_secrets_owner` ON `facebook_account_secrets` (`owner`)",
						"CREATE INDEX `idx_isolation_facebook_account_secrets_workspace` ON `facebook_account_secrets` (`workspace`)",
					],
				),
			);
		}

		const pages = findCollectionSafe(app, "facebook_pages")
			|| saveSchemaCollection(
				app,
				newBaseCollection(
					"facebook_pages",
					[
						relationField("owner", users.id, { required: true, cascadeDelete: true }),
						relationField("workspace", workspaces.id, { required: true, cascadeDelete: false }),
						relationField("account", accounts.id, { required: true, cascadeDelete: true }),
						{ type: "text", name: "page_id", required: true, max: 120 },
						{ type: "text", name: "name", required: true, max: 300 },
						{ type: "text", name: "category", max: 200 },
						{ type: "text", name: "thumbnail_url", max: 1000 },
						{ type: "number", name: "fan_count", min: 0 },
						{ type: "json", name: "tasks", maxSize: 50000 },
						{ type: "bool", name: "is_default" },
						relationField("websiteId", websites.id, { cascadeDelete: false }),
						{ type: "bool", name: "connected" },
					],
					[
						"CREATE UNIQUE INDEX `idx_facebook_pages_workspace_page` ON `facebook_pages` (`workspace`, `page_id`)",
						"CREATE INDEX `idx_facebook_pages_account` ON `facebook_pages` (`account`)",
						"CREATE INDEX `idx_facebook_pages_workspace` ON `facebook_pages` (`workspace`)",
						"CREATE INDEX `idx_isolation_facebook_pages_workspace` ON `facebook_pages` (`workspace`)",
					],
				),
			);

		if (!findCollectionSafe(app, "facebook_oauth_states")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"facebook_oauth_states",
					[
						relationField("owner", users.id, { required: true, cascadeDelete: true }),
						relationField("workspace", workspaces.id, { required: true, cascadeDelete: false }),
						{ type: "text", name: "state", required: true, max: 200 },
						{ type: "date", name: "expires_at", required: true },
						{ type: "bool", name: "used" },
						{ type: "text", name: "return_path", max: 500 },
						relationField("websiteId", websites.id, { cascadeDelete: false }),
					],
					[
						"CREATE UNIQUE INDEX `idx_facebook_oauth_states_state` ON `facebook_oauth_states` (`state`)",
						"CREATE INDEX `idx_facebook_oauth_states_owner_expires` ON `facebook_oauth_states` (`owner`, `expires_at`)",
						"CREATE INDEX `idx_isolation_facebook_oauth_states_workspace` ON `facebook_oauth_states` (`workspace`)",
					],
				),
			);
		}

		const jobs = findCollectionSafe(app, "facebook_publish_jobs")
			|| saveSchemaCollection(
				app,
				newBaseCollection(
					"facebook_publish_jobs",
					[
						relationField("owner", users.id, { required: true, cascadeDelete: true }),
						relationField("workspace", workspaces.id, { required: true, cascadeDelete: false }),
						relationField("ai_pin", aiPins.id, { required: true, cascadeDelete: true }),
						relationField("account", accounts.id, { required: true, cascadeDelete: false }),
						relationField("page", pages.id, { cascadeDelete: false }),
						{ type: "text", name: "page_id", required: true, max: 120 },
						{ type: "text", name: "page_name", max: 300 },
						{ type: "text", name: "page_label", max: 300 },
						relationField("websiteId", websites.id, { cascadeDelete: false }),
						relationField("articleId", websiteArticles.id, { cascadeDelete: false }),
						{ type: "text", name: "title", max: 500 },
						{ type: "text", name: "message", max: 5000 },
						{ type: "text", name: "caption", max: 2000 },
						{ type: "text", name: "image_url", max: 2000 },
						{ type: "text", name: "destination_url", max: 2000 },
						{ type: "date", name: "scheduled_at", required: true },
						{ type: "text", name: "timezone", max: 80 },
						{ type: "text", name: "scheduled_timezone", max: 80 },
						{
							type: "select",
							name: "status",
							required: true,
							maxSelect: 1,
							values: ["scheduled", "publishing", "published", "failed", "cancelled"],
						},
						{ type: "number", name: "attempt_count", min: 0, max: 100, noDecimal: true },
						{ type: "number", name: "max_attempts", min: 1, max: 100, noDecimal: true },
						{ type: "date", name: "next_retry_at" },
						{ type: "text", name: "last_error", max: 3000 },
						{ type: "json", name: "raw_api_error", maxSize: 100000 },
						{ type: "text", name: "facebook_post_id", max: 120 },
						{ type: "text", name: "facebook_post_url", max: 1000 },
						{ type: "date", name: "published_at" },
						{ type: "json", name: "performance", maxSize: 100000 },
						{ type: "date", name: "analytics_synced_at" },
						{ type: "text", name: "claim_token", max: 120 },
						{ type: "number", name: "claim_version", min: 0, max: 1000000000, noDecimal: true },
						{ type: "text", name: "account_label", max: 255 },
					],
					[
						"CREATE INDEX `idx_facebook_publish_jobs_status_sched` ON `facebook_publish_jobs` (`status`, `scheduled_at`)",
						"CREATE INDEX `idx_facebook_publish_jobs_workspace_status` ON `facebook_publish_jobs` (`workspace`, `status`)",
						"CREATE INDEX `idx_facebook_publish_jobs_owner_status` ON `facebook_publish_jobs` (`owner`, `status`)",
						"CREATE INDEX `idx_facebook_publish_jobs_next_retry` ON `facebook_publish_jobs` (`next_retry_at`)",
						"CREATE INDEX `idx_facebook_publish_jobs_ai_pin` ON `facebook_publish_jobs` (`ai_pin`)",
						"CREATE INDEX `idx_facebook_publish_jobs_page_id` ON `facebook_publish_jobs` (`page_id`)",
						"CREATE INDEX `idx_facebook_publish_jobs_account` ON `facebook_publish_jobs` (`account`)",
						"CREATE INDEX `idx_isolation_facebook_publish_jobs_workspace` ON `facebook_publish_jobs` (`workspace`)",
					],
				),
			);

		if (!findCollectionSafe(app, "facebook_publish_events")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"facebook_publish_events",
					[
						relationField("owner", users.id, { required: true, cascadeDelete: true }),
						relationField("workspace", workspaces.id, { required: true, cascadeDelete: false }),
						relationField("job", jobs.id, { required: true, cascadeDelete: true }),
						{ type: "text", name: "event_type", required: true, max: 80 },
						{ type: "text", name: "message", max: 2000 },
						{ type: "json", name: "payload", maxSize: 100000 },
					],
					[
						"CREATE INDEX `idx_facebook_publish_events_job` ON `facebook_publish_events` (`job`)",
						"CREATE INDEX `idx_facebook_publish_events_workspace_created` ON `facebook_publish_events` (`workspace`, `created`)",
						"CREATE INDEX `idx_isolation_facebook_publish_events_workspace` ON `facebook_publish_events` (`workspace`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "facebook_publish_history")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"facebook_publish_history",
					[
						relationField("owner", users.id, { required: true, cascadeDelete: false }),
						relationField("workspace", workspaces.id, { required: true, cascadeDelete: false }),
						relationField("job", jobs.id, { cascadeDelete: false }),
						relationField("ai_pin", aiPins.id, { cascadeDelete: false }),
						relationField("account", accounts.id, { cascadeDelete: false }),
						{ type: "text", name: "page_id", max: 120 },
						{ type: "text", name: "page_name", max: 300 },
						{ type: "text", name: "facebook_post_id", max: 120 },
						{ type: "text", name: "facebook_post_url", max: 1000 },
						{ type: "text", name: "title", max: 500 },
						{ type: "text", name: "message", max: 2000 },
						{ type: "text", name: "image_url", max: 2000 },
						{ type: "date", name: "published_at" },
						{ type: "json", name: "performance", maxSize: 100000 },
						relationField("websiteId", websites.id, { cascadeDelete: false }),
					],
					[
						"CREATE INDEX `idx_facebook_publish_history_workspace_published` ON `facebook_publish_history` (`workspace`, `published_at`)",
						"CREATE INDEX `idx_facebook_publish_history_post_id` ON `facebook_publish_history` (`facebook_post_id`)",
						"CREATE INDEX `idx_isolation_facebook_publish_history_workspace` ON `facebook_publish_history` (`workspace`)",
					],
				),
			);
		}
	},
	(app) => {
		const names = [
			"facebook_publish_history",
			"facebook_publish_events",
			"facebook_publish_jobs",
			"facebook_oauth_states",
			"facebook_pages",
			"facebook_account_secrets",
			"facebook_accounts",
		];
		for (const name of names) {
			try {
				app.delete(app.findCollectionByNameOrId(name));
			} catch (_) {
				// ignore
			}
		}
	},
);
