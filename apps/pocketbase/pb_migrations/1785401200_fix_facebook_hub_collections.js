/// <reference path="../pb_data/types.d.ts" />
/**
 * Repair Facebook Hub collections when F1 migration lagged in production.
 * Creates facebook_accounts / secrets / pages / oauth_states with proper Field ctors.
 */

const coreNS = typeof core !== "undefined" ? core : {};

function pickCtor(...ctors) {
	for (const ctor of ctors) {
		if (typeof ctor === "function") return ctor;
	}
	return null;
}

function toField(def) {
	if (!def || typeof def !== "object" || typeof def.type !== "string") return def;
	const ctorByType = {
		text: pickCtor(typeof TextField !== "undefined" ? TextField : null, coreNS.TextField),
		number: pickCtor(typeof NumberField !== "undefined" ? NumberField : null, coreNS.NumberField),
		bool: pickCtor(typeof BoolField !== "undefined" ? BoolField : null, coreNS.BoolField),
		select: pickCtor(typeof SelectField !== "undefined" ? SelectField : null, coreNS.SelectField),
		date: pickCtor(typeof DateField !== "undefined" ? DateField : null, coreNS.DateField),
		json: pickCtor(typeof JSONField !== "undefined" ? JSONField : null, coreNS.JSONField),
		relation: pickCtor(typeof RelationField !== "undefined" ? RelationField : null, coreNS.RelationField),
		autodate: pickCtor(typeof AutodateField !== "undefined" ? AutodateField : null, coreNS.AutodateField),
	};
	const Ctor = ctorByType[def.type];
	if (!Ctor) throw new Error(`Unsupported migration field type: ${def.type}`);
	return new Ctor(def);
}

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

function requireCollection(app, name) {
	const collection = findCollectionSafe(app, name);
	if (!collection) throw new Error(`Missing required collection "${name}"`);
	return collection;
}

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

function saveApiOnly(app, collection) {
	collection.listRule = null;
	collection.viewRule = null;
	collection.createRule = null;
	collection.updateRule = null;
	collection.deleteRule = null;
	app.save(collection);
	return app.findCollectionByNameOrId(collection.id || collection.name);
}

function ensureCollection(app, name, fieldDefs, indexes) {
	let collection = findCollectionSafe(app, name);
	if (collection) return collection;
	return saveApiOnly(
		app,
		new Collection({
			type: "base",
			name,
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			indexes,
			fields: fieldDefs.concat(AUTODATE_FIELDS).map(toField),
		}),
	);
}

migrate(
	(app) => {
		if (findCollectionSafe(app, "facebook_accounts") && findCollectionSafe(app, "facebook_oauth_states")) {
			return;
		}

		const users = requireCollection(app, "users");
		const workspaces = requireCollection(app, "workspaces");
		const websites = findCollectionSafe(app, "websites");

		const accounts = ensureCollection(
			app,
			"facebook_accounts",
			[
				relationField("owner", users.id, { required: true, cascadeDelete: true }),
				relationField("workspace", workspaces.id, { required: true }),
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
			],
		);

		ensureCollection(
			app,
			"facebook_account_secrets",
			[
				relationField("owner", users.id, { required: true, cascadeDelete: true }),
				relationField("workspace", workspaces.id, { required: true }),
				relationField("account", accounts.id, { required: true, cascadeDelete: true }),
				{ type: "text", name: "access_token", max: 4000 },
				{ type: "text", name: "refresh_token", max: 4000 },
				{ type: "json", name: "page_tokens", maxSize: 200000 },
			],
			[
				"CREATE UNIQUE INDEX `idx_facebook_account_secrets_account` ON `facebook_account_secrets` (`account`)",
			],
		);

		const pageFields = [
			relationField("owner", users.id, { required: true, cascadeDelete: true }),
			relationField("workspace", workspaces.id, { required: true }),
			relationField("account", accounts.id, { required: true, cascadeDelete: true }),
			{ type: "text", name: "page_id", required: true, max: 120 },
			{ type: "text", name: "name", required: true, max: 300 },
			{ type: "text", name: "category", max: 200 },
			{ type: "text", name: "thumbnail_url", max: 1000 },
			{ type: "number", name: "fan_count", min: 0 },
			{ type: "json", name: "tasks", maxSize: 50000 },
			{ type: "bool", name: "is_default" },
			{ type: "bool", name: "connected" },
		];
		if (websites) {
			pageFields.push(relationField("websiteId", websites.id));
		}
		ensureCollection(
			app,
			"facebook_pages",
			pageFields,
			[
				"CREATE UNIQUE INDEX `idx_facebook_pages_workspace_page` ON `facebook_pages` (`workspace`, `page_id`)",
				"CREATE INDEX `idx_facebook_pages_account` ON `facebook_pages` (`account`)",
			],
		);

		const oauthFields = [
			relationField("owner", users.id, { required: true, cascadeDelete: true }),
			relationField("workspace", workspaces.id, { required: true }),
			{ type: "text", name: "state", required: true, max: 200 },
			{ type: "date", name: "expires_at", required: true },
			{ type: "bool", name: "used" },
			{ type: "text", name: "return_path", max: 500 },
			{ type: "text", name: "account_id", max: 80 },
			{ type: "text", name: "requested_label", max: 255 },
			{ type: "text", name: "workspace_id", max: 80 },
			{ type: "text", name: "workspace_key", max: 120 },
		];
		if (websites) {
			oauthFields.push(relationField("websiteId", websites.id));
		}
		ensureCollection(
			app,
			"facebook_oauth_states",
			oauthFields,
			[
				"CREATE UNIQUE INDEX `idx_facebook_oauth_states_state` ON `facebook_oauth_states` (`state`)",
			],
		);
	},
	(_app) => {
		// Non-destructive repair.
	},
);
