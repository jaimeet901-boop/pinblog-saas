/// <reference path="../pb_data/types.d.ts" />

migrate(
	(app) => {
		const pinterestAccounts = app.findCollectionByNameOrId("pinterest_accounts");
		const pinterestBoards = app.findCollectionByNameOrId("pinterest_boards");
		const publishJobs = app.findCollectionByNameOrId("pinterest_publish_jobs");
		const oauthStates = app.findCollectionByNameOrId("pinterest_oauth_states");
		const aiPins = app.findCollectionByNameOrId("ai_pins");

		if (!pinterestAccounts.fields.getByName("label")) {
			pinterestAccounts.fields.add({ name: "label", type: "text", max: 255 });
		}
		if (!pinterestAccounts.fields.getByName("account_name")) {
			pinterestAccounts.fields.add({ name: "account_name", type: "text", max: 255 });
		}
		if (!pinterestAccounts.fields.getByName("profile_image_url")) {
			pinterestAccounts.fields.add({ name: "profile_image_url", type: "text", max: 1000 });
		}
		if (!pinterestAccounts.fields.getByName("status")) {
			pinterestAccounts.fields.add({
				name: "status",
				type: "select",
				required: true,
				maxSelect: 1,
				values: ["connected", "expired", "error"],
			});
		}
		if (!pinterestAccounts.fields.getByName("status_error")) {
			pinterestAccounts.fields.add({ name: "status_error", type: "text", max: 2000 });
		}
		if (!pinterestAccounts.fields.getByName("connected_at")) {
			pinterestAccounts.fields.add({ name: "connected_at", type: "date" });
		}

		pinterestAccounts.indexes = [
			"CREATE UNIQUE INDEX `idx_pinterest_accounts_owner_user_unique` ON `pinterest_accounts` (`owner`, `pinterest_user_id`)",
			"CREATE INDEX `idx_pinterest_accounts_owner_status` ON `pinterest_accounts` (`owner`, `status`)",
			"CREATE INDEX `idx_pinterest_accounts_user_id` ON `pinterest_accounts` (`pinterest_user_id`)",
		];
		app.save(pinterestAccounts);

		pinterestBoards.indexes = [
			"CREATE UNIQUE INDEX `idx_pinterest_boards_owner_account_board` ON `pinterest_boards` (`owner`, `account`, `board_id`)",
			"CREATE INDEX `idx_pinterest_boards_account` ON `pinterest_boards` (`account`)",
		];
		if (!pinterestBoards.fields.getByName("account_label")) {
			pinterestBoards.fields.add({ name: "account_label", type: "text", max: 255 });
		}
		if (!pinterestBoards.fields.getByName("account_username")) {
			pinterestBoards.fields.add({ name: "account_username", type: "text", max: 255 });
		}
		app.save(pinterestBoards);

		if (!publishJobs.fields.getByName("account")) {
			publishJobs.fields.add({
				name: "account",
				type: "relation",
				required: true,
				maxSelect: 1,
				collectionId: pinterestAccounts.id,
				cascadeDelete: false,
			});
		}
		if (!publishJobs.fields.getByName("account_label")) {
			publishJobs.fields.add({ name: "account_label", type: "text", max: 255 });
		}
		if (!publishJobs.fields.getByName("account_username")) {
			publishJobs.fields.add({ name: "account_username", type: "text", max: 255 });
		}
		publishJobs.indexes = [
			"CREATE INDEX `idx_pinterest_publish_jobs_status_sched` ON `pinterest_publish_jobs` (`status`, `scheduled_at`)",
			"CREATE INDEX `idx_pinterest_publish_jobs_owner_status` ON `pinterest_publish_jobs` (`owner`, `status`)",
			"CREATE INDEX `idx_pinterest_publish_jobs_next_retry` ON `pinterest_publish_jobs` (`next_retry_at`)",
			"CREATE INDEX `idx_pinterest_publish_jobs_account_status` ON `pinterest_publish_jobs` (`account`, `status`)",
		];
		app.save(publishJobs);

		if (!oauthStates.fields.getByName("account_id")) {
			oauthStates.fields.add({ name: "account_id", type: "text", max: 80 });
		}
		if (!oauthStates.fields.getByName("requested_label")) {
			oauthStates.fields.add({ name: "requested_label", type: "text", max: 255 });
		}
		app.save(oauthStates);

		if (!aiPins.fields.getByName("pinterest_account_id")) {
			aiPins.fields.add({ name: "pinterest_account_id", type: "text", max: 80 });
		}
		if (!aiPins.fields.getByName("pinterest_account_label")) {
			aiPins.fields.add({ name: "pinterest_account_label", type: "text", max: 255 });
		}
		app.save(aiPins);
	},
	(app) => {
		const pinterestAccounts = app.findCollectionByNameOrId("pinterest_accounts");
		const pinterestBoards = app.findCollectionByNameOrId("pinterest_boards");
		const publishJobs = app.findCollectionByNameOrId("pinterest_publish_jobs");
		const oauthStates = app.findCollectionByNameOrId("pinterest_oauth_states");
		const aiPins = app.findCollectionByNameOrId("ai_pins");

		for (const fieldName of ["label", "account_name", "profile_image_url", "status", "status_error", "connected_at"]) {
			try { pinterestAccounts.fields.removeByName(fieldName); } catch (_) {}
		}
		pinterestAccounts.indexes = [
			"CREATE UNIQUE INDEX `idx_pinterest_accounts_owner` ON `pinterest_accounts` (`owner`)",
			"CREATE INDEX `idx_pinterest_accounts_user_id` ON `pinterest_accounts` (`pinterest_user_id`)",
		];
		app.save(pinterestAccounts);

		pinterestBoards.indexes = [
			"CREATE UNIQUE INDEX `idx_pinterest_boards_owner_board` ON `pinterest_boards` (`owner`, `board_id`)",
			"CREATE INDEX `idx_pinterest_boards_account` ON `pinterest_boards` (`account`)",
		];
		for (const fieldName of ["account_label", "account_username"]) {
			try { pinterestBoards.fields.removeByName(fieldName); } catch (_) {}
		}
		app.save(pinterestBoards);

		for (const fieldName of ["account", "account_label", "account_username"]) {
			try { publishJobs.fields.removeByName(fieldName); } catch (_) {}
		}
		publishJobs.indexes = [
			"CREATE INDEX `idx_pinterest_publish_jobs_status_sched` ON `pinterest_publish_jobs` (`status`, `scheduled_at`)",
			"CREATE INDEX `idx_pinterest_publish_jobs_owner_status` ON `pinterest_publish_jobs` (`owner`, `status`)",
			"CREATE INDEX `idx_pinterest_publish_jobs_next_retry` ON `pinterest_publish_jobs` (`next_retry_at`)",
		];
		app.save(publishJobs);

		for (const fieldName of ["account_id", "requested_label"]) {
			try { oauthStates.fields.removeByName(fieldName); } catch (_) {}
		}
		app.save(oauthStates);

		for (const fieldName of ["pinterest_account_id", "pinterest_account_label"]) {
			try { aiPins.fields.removeByName(fieldName); } catch (_) {}
		}
		app.save(aiPins);
	},
);
