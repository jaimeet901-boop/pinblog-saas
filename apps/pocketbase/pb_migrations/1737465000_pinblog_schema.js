/// <reference path="../pb_data/types.d.ts" />
/**
 * Pinblog schema (collections + fields + indexes only).
 * PocketBase v0.38.0 — see apps/pocketbase/.pocketbase-version
 *
 * New Collection() field definitions MUST be plain objects (type/name/...).
 * Passing Field class instances in Collection.fields is not supported on v0.38:
 * custom fields are dropped on save (only the system id field remains).
 *
 * https://pocketbase.io/docs/js-migrations/
 * https://pocketbase.io/docs/js-collections/
 *
 * API rules stay null until 1737465001_pinblog_api_rules.js runs.
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

function ownerField(users) {
	return relationField("owner", users.id, { required: true, cascadeDelete: true });
}

/** Plain autodate defs (required for DB columns referenced in indexes). */
const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

function saveSchemaCollection(app, collection, { requireOwner = false } = {}) {
	collection.listRule = null;
	collection.viewRule = null;
	collection.createRule = null;
	collection.updateRule = null;
	collection.deleteRule = null;

	app.save(collection);

	const persisted = app.findCollectionByNameOrId(collection.id || collection.name);
	if (requireOwner && !persisted.fields.getByName("owner")) {
		throw new Error(`Schema migration: collection "${persisted.name}" is missing owner after save`);
	}
	return persisted;
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

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId("users");

		if (!users.fields.getByName("plan")) {
			users.fields.add(
				new SelectField({
					name: "plan",
					maxSelect: 1,
					values: ["free", "starter", "pro", "agency"],
				}),
			);
		}
		if (!users.fields.getByName("role")) {
			users.fields.add(
				new SelectField({
					name: "role",
					maxSelect: 1,
					values: ["member", "admin"],
				}),
			);
		}
		if (!users.fields.getByName("ai_credits_used")) {
			users.fields.add(new NumberField({ name: "ai_credits_used", min: 0 }));
		}
		if (!users.fields.getByName("image_credits_used")) {
			users.fields.add(new NumberField({ name: "image_credits_used", min: 0 }));
		}
		app.save(users);

		const owner = ownerField(users);

		const websites = saveSchemaCollection(
			app,
			newBaseCollection("websites", [
				{ type: "text", name: "name", required: true, max: 120 },
				{ type: "url", name: "url" },
				{ type: "text", name: "wp_username", max: 120 },
				{ type: "text", name: "wp_app_password", max: 200 },
				{
					type: "select",
					name: "status",
					maxSelect: 1,
					values: ["untested", "connected", "failed"],
				},
				{ type: "date", name: "last_scan_at" },
				{ type: "date", name: "next_scan_at" },
				{ type: "json", name: "last_scan_summary", maxSize: 200000 },
				owner,
			]),
			{ requireOwner: true },
		);

		saveSchemaCollection(
			app,
			newBaseCollection("articles", [
				{ type: "text", name: "keyword", max: 200 },
				{ type: "text", name: "seo_title", max: 200 },
				{ type: "text", name: "meta_description", max: 400 },
				{ type: "text", name: "slug", max: 200 },
				{ type: "text", name: "language", max: 40 },
				{ type: "text", name: "country", max: 60 },
				{ type: "text", name: "tone", max: 60 },
				{ type: "json", name: "body", maxSize: 2000000 },
				{
					type: "select",
					name: "status",
					maxSelect: 1,
					values: ["draft", "scheduled", "published"],
				},
				{ type: "date", name: "scheduled_at" },
				owner,
			]),
			{ requireOwner: true },
		);

		saveSchemaCollection(
			app,
			newBaseCollection("pins", [
				{ type: "text", name: "title", max: 200 },
				{ type: "text", name: "image_url", max: 500 },
				{ type: "text", name: "board", max: 120 },
				{
					type: "select",
					name: "format",
					maxSelect: 1,
					values: ["square", "portrait", "landscape"],
				},
				{
					type: "select",
					name: "status",
					maxSelect: 1,
					values: ["draft", "scheduled", "published"],
				},
				{ type: "date", name: "scheduled_at" },
				owner,
			]),
			{ requireOwner: true },
		);

		saveSchemaCollection(
			app,
			newBaseCollection("user_settings", [
				{ type: "text", name: "openai_key", max: 300 },
				{ type: "text", name: "gemini_key", max: 300 },
				{ type: "text", name: "fal_key", max: 300 },
				{ type: "text", name: "pinterest_token", max: 500 },
				{ type: "bool", name: "pinterest_connected" },
				{ type: "text", name: "email_from", max: 200 },
				owner,
			]),
			{ requireOwner: true },
		);

		const websiteArticles = saveSchemaCollection(
			app,
			newBaseCollection(
				"website_articles",
				[
					relationField("websiteId", websites.id, { required: true, cascadeDelete: true }),
					owner,
					{ type: "text", name: "url", required: true, max: 1000 },
					{ type: "text", name: "slug", max: 255 },
					{ type: "text", name: "title", max: 500 },
					{ type: "text", name: "meta_description", max: 2000 },
					{ type: "text", name: "featured_image", max: 1000 },
					{ type: "date", name: "publish_date" },
					{ type: "date", name: "last_modified_date" },
					{ type: "text", name: "category", max: 255 },
					{ type: "text", name: "author", max: 255 },
					{ type: "text", name: "language", max: 32 },
					{
						type: "select",
						name: "status",
						required: true,
						maxSelect: 1,
						values: ["new", "imported", "published"],
					},
					{ type: "text", name: "source", max: 64 },
					{ type: "text", name: "scan_run_id", max: 64 },
				],
				[
					"CREATE UNIQUE INDEX `idx_website_articles_unique_url` ON `website_articles` (`websiteId`, `url`)",
					"CREATE INDEX `idx_website_articles_owner_website` ON `website_articles` (`owner`, `websiteId`)",
					"CREATE INDEX `idx_website_articles_status` ON `website_articles` (`status`)",
					"CREATE INDEX `idx_website_articles_published_at` ON `website_articles` (`publish_date`)",
				],
			),
			{ requireOwner: true },
		);

		const brandKits = saveSchemaCollection(
			app,
			newBaseCollection(
				"brand_kits",
				[
					owner,
					{ type: "text", name: "name", required: true, max: 120 },
					{ type: "text", name: "logo_url", max: 1000 },
					{ type: "text", name: "primary_color", max: 32 },
					{ type: "text", name: "secondary_color", max: 32 },
					{ type: "text", name: "accent_color", max: 32 },
					{ type: "text", name: "font_heading", max: 120 },
					{ type: "text", name: "font_body", max: 120 },
					{ type: "text", name: "watermark_text", max: 120 },
					{ type: "text", name: "watermark_url", max: 1000 },
					{ type: "text", name: "website_url", max: 500 },
					{ type: "bool", name: "is_default" },
				],
				["CREATE INDEX `idx_brand_kits_owner` ON `brand_kits` (`owner`)"],
			),
			{ requireOwner: true },
		);

		const aiPins = saveSchemaCollection(
			app,
			newBaseCollection(
				"ai_pins",
				[
					relationField("articleId", websiteArticles.id, { required: true, cascadeDelete: true }),
					relationField("websiteId", websites.id, { required: true, cascadeDelete: true }),
					owner,
					relationField("brand_kit", brandKits.id, { cascadeDelete: false }),
					{ type: "text", name: "image_prompt", max: 4000 },
					{ type: "text", name: "overlay_text", max: 600 },
					{ type: "text", name: "title", required: true, max: 300 },
					{ type: "text", name: "description", max: 2000 },
					{ type: "json", name: "suggested_keywords", maxSize: 10000 },
					{ type: "json", name: "suggested_hashtags", maxSize: 10000 },
					{ type: "text", name: "target_audience", max: 200 },
					{ type: "text", name: "tone_of_voice", max: 100 },
					{ type: "text", name: "language", max: 60 },
					{
						type: "select",
						name: "status",
						required: true,
						maxSelect: 1,
						values: ["draft", "scheduled", "publishing", "published", "failed"],
					},
					{ type: "text", name: "image_url", max: 1000 },
					{ type: "date", name: "scheduled_at" },
					{ type: "text", name: "scheduled_timezone", max: 80 },
					{ type: "text", name: "pinterest_board_id", max: 120 },
					{ type: "text", name: "pinterest_board_name", max: 300 },
					{ type: "text", name: "pinterest_pin_id", max: 120 },
					{ type: "text", name: "pinterest_pin_url", max: 1000 },
					{ type: "text", name: "publish_job_id", max: 120 },
					{ type: "date", name: "published_at" },
					{ type: "text", name: "publish_error", max: 3000 },
					{ type: "json", name: "performance", maxSize: 100000 },
					{
						type: "select",
						name: "image_source",
						maxSelect: 1,
						values: ["featured", "ai_generated", "featured_fallback"],
					},
					{
						type: "select",
						name: "image_generation_status",
						maxSelect: 1,
						values: ["idle", "queued", "processing", "completed", "failed", "fallback"],
					},
					{ type: "text", name: "image_generation_error", max: 3000 },
					{ type: "text", name: "image_job_id", max: 120 },
					{ type: "json", name: "analysis", maxSize: 100000 },
					{ type: "text", name: "cta", max: 300 },
					{ type: "text", name: "pinterest_category", max: 120 },
					{ type: "text", name: "style", max: 64 },
					{ type: "json", name: "editor_state", maxSize: 200000 },
					{ type: "number", name: "ai_credits_used", min: 0 },
					{ type: "number", name: "image_credits_used", min: 0 },
				],
				[
					"CREATE INDEX `idx_ai_pins_owner` ON `ai_pins` (`owner`)",
					"CREATE INDEX `idx_ai_pins_website` ON `ai_pins` (`websiteId`)",
					"CREATE INDEX `idx_ai_pins_article` ON `ai_pins` (`articleId`)",
					"CREATE INDEX `idx_ai_pins_status` ON `ai_pins` (`status`)",
				],
			),
			{ requireOwner: true },
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"ai_pin_templates",
				[
					owner,
					{ type: "text", name: "name", required: true, max: 180 },
					{ type: "text", name: "thumbnail", max: 4000 },
					{ type: "json", name: "configuration", required: true, maxSize: 300000 },
					{ type: "bool", name: "is_default" },
				],
				[
					"CREATE INDEX `idx_ai_pin_templates_owner` ON `ai_pin_templates` (`owner`)",
					"CREATE INDEX `idx_ai_pin_templates_owner_default` ON `ai_pin_templates` (`owner`, `is_default`)",
				],
			),
			{ requireOwner: true },
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"ai_pin_image_jobs",
				[
					owner,
					relationField("ai_pin", aiPins.id, { cascadeDelete: false }),
					relationField("websiteId", websites.id, { cascadeDelete: false }),
					relationField("articleId", websiteArticles.id, { cascadeDelete: false }),
					{ type: "text", name: "client_token", max: 120 },
					{
						type: "select",
						name: "source_type",
						required: true,
						maxSelect: 1,
						values: ["preview", "pin"],
					},
					{
						type: "select",
						name: "image_mode",
						required: true,
						maxSelect: 1,
						values: ["generate_ai", "use_featured"],
					},
					{ type: "text", name: "prompt", max: 5000 },
					{ type: "json", name: "prompt_payload", maxSize: 200000 },
					{ type: "text", name: "featured_image_url", max: 1000 },
					{ type: "text", name: "image_url", max: 1000 },
					{
						type: "select",
						name: "status",
						required: true,
						maxSelect: 1,
						values: ["queued", "processing", "completed", "failed", "fallback"],
					},
					{ type: "number", name: "attempt_count", min: 0, max: 20, noDecimal: true },
					{ type: "number", name: "max_attempts", min: 1, max: 20, noDecimal: true },
					{ type: "date", name: "next_retry_at" },
					{ type: "text", name: "last_error", max: 3000 },
					{ type: "date", name: "completed_at" },
				],
				[
					"CREATE INDEX `idx_ai_pin_image_jobs_owner_status` ON `ai_pin_image_jobs` (`owner`, `status`)",
					"CREATE INDEX `idx_ai_pin_image_jobs_status_retry` ON `ai_pin_image_jobs` (`status`, `next_retry_at`)",
					"CREATE INDEX `idx_ai_pin_image_jobs_pin` ON `ai_pin_image_jobs` (`ai_pin`)",
				],
			),
			{ requireOwner: true },
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"ai_pin_generation_history",
				[
					owner,
					relationField("ai_pin", aiPins.id, { cascadeDelete: false }),
					relationField("articleId", websiteArticles.id, { cascadeDelete: false }),
					relationField("websiteId", websites.id, { cascadeDelete: false }),
					{
						type: "select",
						name: "event_type",
						required: true,
						maxSelect: 1,
						values: ["analyze", "prompt", "image", "save", "edit", "bulk"],
					},
					{ type: "text", name: "prompt", max: 8000 },
					{ type: "text", name: "image_url", max: 1000 },
					{ type: "json", name: "analysis", maxSize: 100000 },
					{ type: "json", name: "metadata", maxSize: 100000 },
					{ type: "number", name: "ai_credits_used", min: 0 },
					{ type: "number", name: "image_credits_used", min: 0 },
				],
				[
					"CREATE INDEX `idx_ai_pin_history_owner` ON `ai_pin_generation_history` (`owner`)",
					"CREATE INDEX `idx_ai_pin_history_pin` ON `ai_pin_generation_history` (`ai_pin`)",
				],
			),
			{ requireOwner: true },
		);

		const pinterestAccounts = saveSchemaCollection(
			app,
			newBaseCollection(
				"pinterest_accounts",
				[
					owner,
					{ type: "text", name: "pinterest_user_id", max: 120 },
					{ type: "text", name: "username", max: 255 },
					{ type: "text", name: "access_token", max: 4000 },
					{ type: "text", name: "refresh_token", max: 4000 },
					{ type: "date", name: "token_expires_at" },
					{ type: "text", name: "scope", max: 1000 },
					{ type: "bool", name: "connected" },
					{ type: "date", name: "last_sync_at" },
					{ type: "bool", name: "is_default" },
				],
				[
					"CREATE UNIQUE INDEX `idx_pinterest_accounts_owner` ON `pinterest_accounts` (`owner`)",
					"CREATE INDEX `idx_pinterest_accounts_user_id` ON `pinterest_accounts` (`pinterest_user_id`)",
				],
			),
			{ requireOwner: true },
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"pinterest_boards",
				[
					owner,
					relationField("account", pinterestAccounts.id, { required: true, cascadeDelete: true }),
					{ type: "text", name: "board_id", required: true, max: 120 },
					{ type: "text", name: "name", required: true, max: 300 },
					{ type: "text", name: "thumbnail_url", max: 1000 },
					{ type: "text", name: "description", max: 1000 },
					{ type: "text", name: "privacy", max: 50 },
					{ type: "bool", name: "is_default" },
				],
				[
					"CREATE UNIQUE INDEX `idx_pinterest_boards_owner_board` ON `pinterest_boards` (`owner`, `board_id`)",
					"CREATE INDEX `idx_pinterest_boards_account` ON `pinterest_boards` (`account`)",
				],
			),
			{ requireOwner: true },
		);

		const publishJobs = saveSchemaCollection(
			app,
			newBaseCollection(
				"pinterest_publish_jobs",
				[
					owner,
					relationField("ai_pin", aiPins.id, { required: true, cascadeDelete: true }),
					relationField("websiteId", websites.id, { cascadeDelete: false }),
					relationField("articleId", websiteArticles.id, { cascadeDelete: false }),
					{ type: "text", name: "board_id", required: true, max: 120 },
					{ type: "text", name: "board_name", max: 300 },
					{ type: "date", name: "scheduled_at", required: true },
					{ type: "text", name: "timezone", max: 80 },
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
					{ type: "text", name: "pinterest_pin_id", max: 120 },
					{ type: "text", name: "pinterest_pin_url", max: 1000 },
					{ type: "date", name: "published_at" },
					{ type: "json", name: "performance", maxSize: 100000 },
					{ type: "text", name: "claim_token", max: 120 },
					{ type: "number", name: "claim_version", min: 0, max: 1000000000, noDecimal: true },
					{ type: "date", name: "analytics_synced_at" },
				],
				[
					"CREATE INDEX `idx_pinterest_publish_jobs_status_sched` ON `pinterest_publish_jobs` (`status`, `scheduled_at`)",
					"CREATE INDEX `idx_pinterest_publish_jobs_owner_status` ON `pinterest_publish_jobs` (`owner`, `status`)",
					"CREATE INDEX `idx_pinterest_publish_jobs_next_retry` ON `pinterest_publish_jobs` (`next_retry_at`)",
				],
			),
			{ requireOwner: true },
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"pinterest_publish_events",
				[
					owner,
					relationField("job", publishJobs.id, { required: true, cascadeDelete: true }),
					{ type: "text", name: "event_type", required: true, max: 80 },
					{ type: "text", name: "message", max: 2000 },
					{ type: "json", name: "payload", maxSize: 100000 },
				],
				[
					"CREATE INDEX `idx_pinterest_publish_events_job` ON `pinterest_publish_events` (`job`)",
					"CREATE INDEX `idx_pinterest_publish_events_owner_created` ON `pinterest_publish_events` (`owner`, `created`)",
				],
			),
			{ requireOwner: true },
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"pinterest_oauth_states",
				[
					owner,
					{ type: "text", name: "state", required: true, max: 200 },
					{ type: "date", name: "expires_at", required: true },
					{ type: "bool", name: "used" },
				],
				[
					"CREATE UNIQUE INDEX `idx_pinterest_oauth_states_state` ON `pinterest_oauth_states` (`state`)",
					"CREATE INDEX `idx_pinterest_oauth_states_owner_expires` ON `pinterest_oauth_states` (`owner`, `expires_at`)",
				],
			),
			{ requireOwner: true },
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"pinterest_account_secrets",
				[
					owner,
					relationField("account", pinterestAccounts.id, { required: true, cascadeDelete: true }),
					{ type: "text", name: "access_token", max: 4000 },
					{ type: "text", name: "refresh_token", max: 4000 },
				],
				[
					"CREATE UNIQUE INDEX `idx_pinterest_account_secrets_account` ON `pinterest_account_secrets` (`account`)",
					"CREATE INDEX `idx_pinterest_account_secrets_owner` ON `pinterest_account_secrets` (`owner`)",
				],
			),
			{ requireOwner: true },
		);
	},
	(app) => {
		const names = [
			"pinterest_account_secrets",
			"pinterest_oauth_states",
			"pinterest_publish_events",
			"pinterest_publish_jobs",
			"pinterest_boards",
			"pinterest_accounts",
			"ai_pin_generation_history",
			"ai_pin_image_jobs",
			"ai_pin_templates",
			"ai_pins",
			"brand_kits",
			"website_articles",
			"user_settings",
			"pins",
			"articles",
			"websites",
		];

		for (const name of names) {
			try {
				app.delete(app.findCollectionByNameOrId(name));
			} catch (_) {
				// ignore
			}
		}

		const users = app.findCollectionByNameOrId("users");
		for (const fieldName of ["plan", "role", "ai_credits_used", "image_credits_used"]) {
			try {
				users.fields.removeByName(fieldName);
			} catch (_) {
				// ignore
			}
		}
		app.save(users);
	},
);
