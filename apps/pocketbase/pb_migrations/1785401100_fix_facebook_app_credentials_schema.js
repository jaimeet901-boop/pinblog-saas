/// <reference path="../pb_data/types.d.ts" />
/**
 * Repair facebook_app_credentials when F2 migration lagged or created a stub.
 * Mirrors pinterest_app_credentials Field construction (toField).
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
	if (collection.fields.getByName(def.name)) return false;
	collection.fields.add(toField(def));
	return true;
}

const CREDENTIAL_FIELDS = [
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

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

const UNIQUE_INDEX =
	"CREATE UNIQUE INDEX `idx_facebook_app_credentials_key` ON `facebook_app_credentials` (`config_key`)";

migrate(
	(app) => {
		let collection = findCollectionSafe(app, "facebook_app_credentials");
		if (!collection) {
			collection = new Collection({
				type: "base",
				name: "facebook_app_credentials",
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: [UNIQUE_INDEX],
				fields: CREDENTIAL_FIELDS.concat(AUTODATE_FIELDS).map(toField),
			});
			app.save(collection);
			return;
		}

		let dirty = false;
		for (const def of CREDENTIAL_FIELDS) {
			dirty = ensureField(collection, def) || dirty;
		}
		for (const def of AUTODATE_FIELDS) {
			dirty = ensureField(collection, def) || dirty;
		}
		collection.listRule = null;
		collection.viewRule = null;
		collection.createRule = null;
		collection.updateRule = null;
		collection.deleteRule = null;

		const indexes = collection.indexes || [];
		const hasIndex = indexes.some((value) => String(value || "").includes("idx_facebook_app_credentials_key"));
		if (!hasIndex && typeof collection.addIndex === "function") {
			collection.addIndex("idx_facebook_app_credentials_key", true, "config_key", "");
			dirty = true;
		} else if (!hasIndex) {
			collection.indexes = [...indexes, UNIQUE_INDEX];
			dirty = true;
		}

		if (dirty) app.save(collection);
	},
	(_app) => {
		// Non-destructive repair.
	},
);
