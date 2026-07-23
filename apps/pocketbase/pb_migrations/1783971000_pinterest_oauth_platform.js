/// <reference path="../pb_data/types.d.ts" />
/**
 * Platform Pinterest OAuth app credentials (Admin-configured once).
 * API-only — never exposed to workspace clients.
 * Also adds workspace linkage fields on pinterest_accounts when missing.
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

function ensureField(collection, def) {
	if (!collection.fields.getByName(def.name)) {
		collection.fields.add(toField(def));
	}
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

migrate(
	(app) => {
		let collection = findCollectionSafe(app, "pinterest_app_credentials");
		const credentialFields = [
			{ type: "text", name: "config_key", required: true, max: 40 },
			{ type: "text", name: "app_id", max: 200 },
			{ type: "text", name: "app_secret_ciphertext", max: 4000 },
			{ type: "text", name: "redirect_uri", max: 1000 },
			{ type: "text", name: "scopes", max: 1000 },
			{ type: "bool", name: "enabled" },
			{ type: "bool", name: "trial_access_pending" },
			{ type: "text", name: "kek_version", max: 40 },
			{ type: "json", name: "meta", maxSize: 100000 },
		];

		if (!collection) {
			const fields = credentialFields.concat(AUTODATE_FIELDS).map(toField);
			collection = new Collection({
				type: "base",
				name: "pinterest_app_credentials",
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: [
					"CREATE UNIQUE INDEX `idx_pinterest_app_credentials_key` ON `pinterest_app_credentials` (`config_key`)",
				],
				fields,
			});
			app.save(collection);
		} else {
			// Repair path for stub collections that already existed without fields.
			let dirty = false;
			for (const def of credentialFields) {
				if (!collection.fields.getByName(def.name)) {
					collection.fields.add(toField(def));
					dirty = true;
				}
			}
			for (const def of AUTODATE_FIELDS) {
				if (!collection.fields.getByName(def.name)) {
					collection.fields.add(toField(def));
					dirty = true;
				}
			}
			if (dirty) app.save(collection);
		}

		const accounts = findCollectionSafe(app, "pinterest_accounts");
		const workspaces = findCollectionSafe(app, "workspaces");
		if (accounts) {
			ensureField(accounts, { type: "text", name: "workspace_key", max: 120 });
			ensureField(accounts, { type: "text", name: "workspace_id", max: 80 });
			if (workspaces && !accounts.fields.getByName("workspace")) {
				accounts.fields.add(toField(relationField("workspace", workspaces.id, { cascadeDelete: false })));
			}
			app.save(accounts);
		}

		const oauthStates = findCollectionSafe(app, "pinterest_oauth_states");
		if (oauthStates) {
			ensureField(oauthStates, { type: "text", name: "workspace_key", max: 120 });
			ensureField(oauthStates, { type: "text", name: "workspace_id", max: 80 });
			app.save(oauthStates);
		}
	},
	(app) => {
		const collection = findCollectionSafe(app, "pinterest_app_credentials");
		if (collection) app.delete(collection);
	},
);
