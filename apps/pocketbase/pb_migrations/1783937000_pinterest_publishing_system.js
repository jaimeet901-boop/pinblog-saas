/// <reference path="../pb_data/types.d.ts" />

const coreNS = typeof core !== "undefined" ? core : {};

function pickCtor(...ctors) {
	for (const ctor of ctors) {
		if (typeof ctor === "function") {
			return ctor;
		}
	}

	return null;
}

function toField(def) {
	if (!def || typeof def !== "object" || typeof def.type !== "string") {
		return def;
	}

	const ctorByType = {
		text: pickCtor(typeof TextField !== "undefined" ? TextField : null, coreNS.TextField),
		relation: pickCtor(typeof RelationField !== "undefined" ? RelationField : null, coreNS.RelationField),
		select: pickCtor(typeof SelectField !== "undefined" ? SelectField : null, coreNS.SelectField),
		json: pickCtor(typeof JSONField !== "undefined" ? JSONField : null, coreNS.JSONField),
		date: pickCtor(typeof DateField !== "undefined" ? DateField : null, coreNS.DateField),
		number: pickCtor(typeof NumberField !== "undefined" ? NumberField : null, coreNS.NumberField),
		bool: pickCtor(typeof BoolField !== "undefined" ? BoolField : null, coreNS.BoolField),
		autodate: pickCtor(typeof AutodateField !== "undefined" ? AutodateField : null, coreNS.AutodateField),
	};

	const Ctor = ctorByType[def.type];
	if (!Ctor) {
		throw new Error(`Unsupported migration field type: ${def.type}`);
	}

	return new Ctor(def);
}

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

		const applyOwnerRules = (collection) => {
			const persisted = app.findCollectionByNameOrId(collection.id || collection.name);
			if (!persisted || !persisted.fields.getByName("owner")) {
				return;
			}

			persisted.listRule = ownerRules.listRule;
			persisted.viewRule = ownerRules.viewRule;
			persisted.createRule = ownerRules.createRule;
			persisted.updateRule = ownerRules.updateRule;
			persisted.deleteRule = ownerRules.deleteRule;
			app.save(persisted);
		};

		const statusField = aiPins.fields.getByName("status");
		if (statusField) {
			statusField.values = ["draft", "scheduled", "publishing", "published", "failed"];
			statusField.maxSelect = 1;
		}

		if (!aiPins.fields.getByName("image_url")) {
			aiPins.fields.add(toField({ name: "image_url", type: "text", max: 1000 }));
		}
		if (!aiPins.fields.getByName("scheduled_at")) {
			aiPins.fields.add(toField({ name: "scheduled_at", type: "date" }));
		}
		if (!aiPins.fields.getByName("scheduled_timezone")) {
			aiPins.fields.add(toField({ name: "scheduled_timezone", type: "text", max: 80 }));
		}
		if (!aiPins.fields.getByName("pinterest_board_id")) {
			aiPins.fields.add(toField({ name: "pinterest_board_id", type: "text", max: 120 }));
		}
		if (!aiPins.fields.getByName("pinterest_board_name")) {
			aiPins.fields.add(toField({ name: "pinterest_board_name", type: "text", max: 300 }));
		}
		if (!aiPins.fields.getByName("pinterest_pin_id")) {
			aiPins.fields.add(toField({ name: "pinterest_pin_id", type: "text", max: 120 }));
		}
		if (!aiPins.fields.getByName("pinterest_pin_url")) {
			aiPins.fields.add(toField({ name: "pinterest_pin_url", type: "text", max: 1000 }));
		}
		if (!aiPins.fields.getByName("publish_job_id")) {
			aiPins.fields.add(toField({ name: "publish_job_id", type: "text", max: 120 }));
		}
		if (!aiPins.fields.getByName("published_at")) {
			aiPins.fields.add(toField({ name: "published_at", type: "date" }));
		}
		if (!aiPins.fields.getByName("publish_error")) {
			aiPins.fields.add(toField({ name: "publish_error", type: "text", max: 3000 }));
		}
		if (!aiPins.fields.getByName("performance")) {
			aiPins.fields.add(toField({ name: "performance", type: "json", maxSize: 100000 }));
		}
		app.save(aiPins);

		const pinterestAccounts = new Collection({
			type: "base",
			name: "pinterest_accounts",
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
			].map(toField),
		});
		app.save(pinterestAccounts);
		applyOwnerRules(pinterestAccounts);

		const pinterestBoards = new Collection({
			type: "base",
			name: "pinterest_boards",
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
			].map(toField),
		});
		app.save(pinterestBoards);
		applyOwnerRules(pinterestBoards);

		const publishJobs = new Collection({
			type: "base",
			name: "pinterest_publish_jobs",
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
			].map(toField),
		});
		app.save(publishJobs);
		applyOwnerRules(publishJobs);

		const publishEvents = new Collection({
			type: "base",
			name: "pinterest_publish_events",
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
			].map(toField),
		});
		app.save(publishEvents);
		applyOwnerRules(publishEvents);

		const oauthStates = new Collection({
			type: "base",
			name: "pinterest_oauth_states",
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
			].map(toField),
		});
		app.save(oauthStates);
		applyOwnerRules(oauthStates);
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
