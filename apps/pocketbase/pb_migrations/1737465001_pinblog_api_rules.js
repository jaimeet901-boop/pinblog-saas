/// <reference path="../pb_data/types.d.ts" />
/**
 * Apply API rules after all collections and fields exist (1737465000_pinblog_schema.js).
 */

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

function applyRules(app, name, rules) {
	const collection = findCollectionSafe(app, name);
	if (!collection) {
		return;
	}

	if (rules.requireOwner && !collection.fields.getByName("owner")) {
		throw new Error(`API rules migration: collection "${name}" is missing owner field`);
	}
	if (rules.requireUserId && !collection.fields.getByName("userId")) {
		throw new Error(`API rules migration: collection "${name}" is missing userId field`);
	}

	app.save(collection);
	const persisted = app.findCollectionByNameOrId(collection.id || collection.name);

	persisted.listRule = rules.listRule ?? null;
	persisted.viewRule = rules.viewRule ?? null;
	persisted.createRule = rules.createRule ?? null;
	persisted.updateRule = rules.updateRule ?? null;
	persisted.deleteRule = rules.deleteRule ?? null;

	app.save(persisted);
}

const AUTH = "@request.auth.id != ''";
const OWNER_SCOPE = `${AUTH} && owner = @request.auth.id`;
const USER_ID_SCOPE = `${AUTH} && userId = @request.auth.id`;

const FULL_OWNER_RULES = {
	requireOwner: true,
	listRule: OWNER_SCOPE,
	viewRule: OWNER_SCOPE,
	createRule: OWNER_SCOPE,
	updateRule: OWNER_SCOPE,
	deleteRule: OWNER_SCOPE,
};

const CHEF_IA_OWNER_RULES = {
	requireOwner: true,
	listRule: OWNER_SCOPE,
	viewRule: OWNER_SCOPE,
	createRule: AUTH,
	updateRule: OWNER_SCOPE,
	deleteRule: OWNER_SCOPE,
};

const OWNER_READ_API_WRITE_RULES = {
	requireOwner: true,
	listRule: OWNER_SCOPE,
	viewRule: OWNER_SCOPE,
	createRule: null,
	updateRule: null,
	deleteRule: null,
};

const API_ONLY_RULES = {
	listRule: null,
	viewRule: null,
	createRule: null,
	updateRule: null,
	deleteRule: null,
};

migrate(
	(app) => {
		const ownerCollections = [
			"websites",
			"website_articles",
			"ai_pins",
			"ai_pin_templates",
			"ai_pin_image_jobs",
			"ai_pin_generation_history",
			"brand_kits",
			"pinterest_boards",
			"pinterest_publish_events",
			"pinterest_oauth_states",
		];

		for (const name of ownerCollections) {
			applyRules(app, name, FULL_OWNER_RULES);
		}

		for (const name of ["articles", "pins", "user_settings"]) {
			applyRules(app, name, CHEF_IA_OWNER_RULES);
		}

		applyRules(app, "pinterest_accounts", OWNER_READ_API_WRITE_RULES);
		applyRules(app, "pinterest_publish_jobs", OWNER_READ_API_WRITE_RULES);
		applyRules(app, "pinterest_account_secrets", API_ONLY_RULES);

		applyRules(app, "_integratedAiMessages", {
			requireUserId: true,
			listRule: USER_ID_SCOPE,
			viewRule: USER_ID_SCOPE,
			createRule: null,
			updateRule: null,
			deleteRule: USER_ID_SCOPE,
		});
	},
	(app) => {
		const names = [
			"websites",
			"website_articles",
			"articles",
			"pins",
			"user_settings",
			"ai_pins",
			"ai_pin_templates",
			"ai_pin_image_jobs",
			"ai_pin_generation_history",
			"brand_kits",
			"pinterest_accounts",
			"pinterest_boards",
			"pinterest_publish_jobs",
			"pinterest_publish_events",
			"pinterest_oauth_states",
			"pinterest_account_secrets",
			"_integratedAiMessages",
		];

		for (const name of names) {
			applyRules(app, name, API_ONLY_RULES);
		}
	},
);
