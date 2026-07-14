/// <reference path="../pb_data/types.d.ts" />

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId("users");
		const aiPins = app.findCollectionByNameOrId("ai_pins");
		const websites = app.findCollectionByNameOrId("websites");
		const websiteArticles = app.findCollectionByNameOrId("website_articles");

		const ownerField = {
			name: "owner",
			type: "relation",
			required: true,
			maxSelect: 1,
			collectionId: users.id,
			cascadeDelete: true,
		};

		const ownerRules = {
			listRule: "@request.auth.id != '' && owner = @request.auth.id",
			viewRule: "@request.auth.id != '' && owner = @request.auth.id",
			createRule: "@request.auth.id != '' && owner = @request.auth.id",
			updateRule: "@request.auth.id != '' && owner = @request.auth.id",
			deleteRule: "@request.auth.id != '' && owner = @request.auth.id",
		};

		const statusField = aiPins.fields.getByName("status");
		if (statusField) {
			statusField.values = ["draft", "scheduled", "publishing", "published", "failed"];
			statusField.maxSelect = 1;
		}

		if (!aiPins.fields.getByName("image_url")) {
			aiPins.fields.add({ name: "image_url", type: "text", max: 1000 });
		}
		if (!aiPins.fields.getByName("scheduled_at")) {
			aiPins.fields.add({ name: "scheduled_at", type: "date" });
		}
		if (!aiPins.fields.getByName("scheduled_timezone")) {
			aiPins.fields.add({ name: "scheduled_timezone", type: "text", max: 80 });
		}
		if (!aiPins.fields.getByName("pinterest_board_id")) {
			aiPins.fields.add({ name: "pinterest_board_id", type: "text", max: 120 });
		}
		if (!aiPins.fields.getByName("pinterest_board_name")) {
			aiPins.fields.add({ name: "pinterest_board_name", type: "text", max: 300 });
		}
		if (!aiPins.fields.getByName("pinterest_pin_id")) {
			aiPins.fields.add({ name: "pinterest_pin_id", type: "text", max: 120 });
		}
		if (!aiPins.fields.getByName("pinterest_pin_url")) {
			aiPins.fields.add({ name: "pinterest_pin_url", type: "text", max: 1000 });
		}
		if (!aiPins.fields.getByName("publish_job_id")) {
			aiPins.fields.add({ name: "publish_job_id", type: "text", max: 120 });
		}
		if (!aiPins.fields.getByName("published_at")) {
			aiPins.fields.add({ name: "published_at", type: "date" });
		}
		if (!aiPins.fields.getByName("publish_error")) {
			aiPins.fields.add({ name: "publish_error", type: "text", max: 3000 });
		}
		if (!aiPins.fields.getByName("performance")) {
			aiPins.fields.add({ name: "performance", type: "json", maxSize: 100000 });
		}
		app.save(aiPins);

		const pinterestAccounts = new Collection({
			type: "base",
			name: "pinterest_accounts",
			...ownerRules,
			indexes: [
				"CREATE UNIQUE INDEX `idx_pinterest_accounts_owner` ON `pinterest_accounts` (`owner`)",
				"CREATE INDEX `idx_pinterest_accounts_user_id` ON `pinterest_accounts` (`pinterest_user_id`)"
			],
			fields: [
				ownerField,
				{ name: "pinterest_user_id", type: "text", max: 120 },
				{ name: "username", type: "text", max: 255 },
				{ name: "access_token", type: "text", max: 4000 },
				{ name: "refresh_token", type: "text", max: 4000 },
				{ name: "token_expires_at", type: "date" },
				{ name: "scope", type: "text", max: 1000 },
				{ name: "connected", type: "bool" },
				{ name: "last_sync_at", type: "date" },
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			],
		});
		app.save(pinterestAccounts);

		const pinterestBoards = new Collection({
			type: "base",
			name: "pinterest_boards",
			...ownerRules,
			indexes: [
				"CREATE UNIQUE INDEX `idx_pinterest_boards_owner_board` ON `pinterest_boards` (`owner`, `board_id`)",
				"CREATE INDEX `idx_pinterest_boards_account` ON `pinterest_boards` (`account`)"
			],
			fields: [
				ownerField,
				{
					name: "account",
					type: "relation",
					required: true,
					maxSelect: 1,
					collectionId: pinterestAccounts.id,
					cascadeDelete: true,
				},
				{ name: "board_id", type: "text", required: true, max: 120 },
				{ name: "name", type: "text", required: true, max: 300 },
				{ name: "thumbnail_url", type: "text", max: 1000 },
				{ name: "description", type: "text", max: 1000 },
				{ name: "privacy", type: "text", max: 50 },
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			],
		});
		app.save(pinterestBoards);

		const publishJobs = new Collection({
			type: "base",
			name: "pinterest_publish_jobs",
			...ownerRules,
			indexes: [
				"CREATE INDEX `idx_pinterest_publish_jobs_status_sched` ON `pinterest_publish_jobs` (`status`, `scheduled_at`)",
				"CREATE INDEX `idx_pinterest_publish_jobs_owner_status` ON `pinterest_publish_jobs` (`owner`, `status`)",
				"CREATE INDEX `idx_pinterest_publish_jobs_next_retry` ON `pinterest_publish_jobs` (`next_retry_at`)"
			],
			fields: [
				ownerField,
				{
					name: "ai_pin",
					type: "relation",
					required: true,
					maxSelect: 1,
					collectionId: aiPins.id,
					cascadeDelete: true,
				},
				{
					name: "websiteId",
					type: "relation",
					maxSelect: 1,
					collectionId: websites.id,
					cascadeDelete: false,
				},
				{
					name: "articleId",
					type: "relation",
					maxSelect: 1,
					collectionId: websiteArticles.id,
					cascadeDelete: false,
				},
				{ name: "board_id", type: "text", required: true, max: 120 },
				{ name: "board_name", type: "text", max: 300 },
				{ name: "scheduled_at", type: "date", required: true },
				{ name: "timezone", type: "text", max: 80 },
				{ name: "status", type: "select", required: true, maxSelect: 1, values: ["scheduled", "publishing", "published", "failed", "cancelled"] },
				{ name: "attempt_count", type: "number", min: 0, max: 100, noDecimal: true },
				{ name: "max_attempts", type: "number", min: 1, max: 100, noDecimal: true },
				{ name: "next_retry_at", type: "date" },
				{ name: "last_error", type: "text", max: 3000 },
				{ name: "pinterest_pin_id", type: "text", max: 120 },
				{ name: "pinterest_pin_url", type: "text", max: 1000 },
				{ name: "published_at", type: "date" },
				{ name: "performance", type: "json", maxSize: 100000 },
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			],
		});
		app.save(publishJobs);

		const publishEvents = new Collection({
			type: "base",
			name: "pinterest_publish_events",
			...ownerRules,
			indexes: [
				"CREATE INDEX `idx_pinterest_publish_events_job` ON `pinterest_publish_events` (`job`)",
				"CREATE INDEX `idx_pinterest_publish_events_owner_created` ON `pinterest_publish_events` (`owner`, `created`)"
			],
			fields: [
				ownerField,
				{
					name: "job",
					type: "relation",
					required: true,
					maxSelect: 1,
					collectionId: publishJobs.id,
					cascadeDelete: true,
				},
				{ name: "event_type", type: "text", required: true, max: 80 },
				{ name: "message", type: "text", max: 2000 },
				{ name: "payload", type: "json", maxSize: 100000 },
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			],
		});
		app.save(publishEvents);

		const oauthStates = new Collection({
			type: "base",
			name: "pinterest_oauth_states",
			...ownerRules,
			indexes: [
				"CREATE UNIQUE INDEX `idx_pinterest_oauth_states_state` ON `pinterest_oauth_states` (`state`)",
				"CREATE INDEX `idx_pinterest_oauth_states_owner_expires` ON `pinterest_oauth_states` (`owner`, `expires_at`)"
			],
			fields: [
				ownerField,
				{ name: "state", type: "text", required: true, max: 200 },
				{ name: "expires_at", type: "date", required: true },
				{ name: "used", type: "bool" },
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			],
		});
		app.save(oauthStates);
	},
	(app) => {
		for (const name of [
			"pinterest_oauth_states",
			"pinterest_publish_events",
			"pinterest_publish_jobs",
			"pinterest_boards",
			"pinterest_accounts",
		]) {
			try {
				app.delete(app.findCollectionByNameOrId(name));
			} catch (_) {
				// ignore
			}
		}

		const aiPins = app.findCollectionByNameOrId("ai_pins");
		const statusField = aiPins.fields.getByName("status");
		if (statusField) {
			statusField.values = ["draft"];
		}

		for (const fieldName of [
			"image_url",
			"scheduled_at",
			"scheduled_timezone",
			"pinterest_board_id",
			"pinterest_board_name",
			"pinterest_pin_id",
			"pinterest_pin_url",
			"publish_job_id",
			"published_at",
			"publish_error",
			"performance",
		]) {
			try {
				aiPins.fields.removeByName(fieldName);
			} catch (_) {
				// ignore
			}
		}

		app.save(aiPins);
	},
);
