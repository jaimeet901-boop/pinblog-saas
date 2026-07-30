/// <reference path="../pb_data/types.d.ts" />
/**
 * Facebook Channel Pack — F2
 * - facebook_app_credentials (platform OAuth app)
 * - oauth_states fields for reconnect (account_id, requested_label, workspace_*)
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

function ensureTextField(collection, name, max) {
	if (collection.fields.getByName(name)) return false;
	collection.fields.add(toField({
		type: "text",
		name,
		max: max || 255,
		required: false,
	}));
	return true;
}

function saveApiOnly(app, collection) {
	collection.listRule = null;
	collection.viewRule = null;
	collection.createRule = null;
	collection.updateRule = null;
	collection.deleteRule = null;
	app.save(collection);
	return app.findCollectionByNameOrId(collection.id || collection.name);
}

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

migrate(
	(app) => {
		if (!findCollectionSafe(app, "facebook_app_credentials")) {
			const credentialFields = [
				{ type: "text", name: "config_key", required: true, max: 80 },
				{ type: "text", name: "app_id", max: 200 },
				{ type: "text", name: "app_secret_ciphertext", max: 4000 },
				{ type: "text", name: "redirect_uri", max: 1000 },
				{ type: "text", name: "scopes", max: 2000 },
				{ type: "bool", name: "enabled" },
				{ type: "bool", name: "trial_access_pending" },
				{ type: "text", name: "kek_version", max: 40 },
				{ type: "json", name: "meta", maxSize: 100000 },
			];
			saveApiOnly(
				app,
				new Collection({
					type: "base",
					name: "facebook_app_credentials",
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					indexes: [
						"CREATE UNIQUE INDEX `idx_facebook_app_credentials_key` ON `facebook_app_credentials` (`config_key`)",
					],
					fields: credentialFields.concat(AUTODATE_FIELDS).map(toField),
				}),
			);
		}

		const oauthStates = findCollectionSafe(app, "facebook_oauth_states");
		if (oauthStates) {
			let dirty = false;
			dirty = ensureTextField(oauthStates, "account_id", 80) || dirty;
			dirty = ensureTextField(oauthStates, "requested_label", 255) || dirty;
			dirty = ensureTextField(oauthStates, "workspace_id", 80) || dirty;
			dirty = ensureTextField(oauthStates, "workspace_key", 120) || dirty;
			if (dirty) saveApiOnly(app, oauthStates);
		}
	},
	(app) => {
		try {
			app.delete(app.findCollectionByNameOrId("facebook_app_credentials"));
		} catch (_) {
			// ignore
		}
	},
);
