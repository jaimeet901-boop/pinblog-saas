/// <reference path="../pb_data/types.d.ts" />
/**
 * Permanent repair for pinterest_app_credentials schema (PB v0.38+).
 *
 * Root cause:
 * 1783971000 only created the collection when missing. If an empty/stub
 * collection already existed, the migration was marked applied without fields.
 *
 * This migration is idempotent:
 * - creates the collection when absent
 * - adds any missing fields when the collection already exists
 * - ensures the unique config_key index
 * - never deletes records or drops the collection
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

function ensureIndex(collection, indexSql) {
	const indexes = Array.isArray(collection.indexes) ? collection.indexes : [];
	const needle = String(indexSql || "").replace(/\s+/g, " ").trim().toLowerCase();
	const exists = indexes.some((item) => String(item || "").replace(/\s+/g, " ").trim().toLowerCase() === needle
		|| String(item || "").includes("idx_pinterest_app_credentials_key"));
	if (exists) return false;

	if (typeof collection.addIndex === "function") {
		collection.addIndex("idx_pinterest_app_credentials_key", true, "config_key", "");
		return true;
	}

	indexes.push(indexSql);
	collection.indexes = indexes;
	return true;
}

function assertRequiredFields(collection) {
	const required = [
		"config_key",
		"app_id",
		"app_secret_ciphertext",
		"redirect_uri",
		"scopes",
		"enabled",
		"trial_access_pending",
		"kek_version",
		"meta",
	];
	const missing = required.filter((name) => !collection.fields.getByName(name));
	if (missing.length) {
		throw new Error(`pinterest_app_credentials still missing fields: ${missing.join(", ")}`);
	}
}

const CREDENTIAL_FIELDS = [
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

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

const UNIQUE_CONFIG_KEY_INDEX =
	"CREATE UNIQUE INDEX `idx_pinterest_app_credentials_key` ON `pinterest_app_credentials` (`config_key`)";

migrate(
	(app) => {
		let collection = findCollectionSafe(app, "pinterest_app_credentials");

		if (!collection) {
			collection = new Collection({
				type: "base",
				name: "pinterest_app_credentials",
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: [UNIQUE_CONFIG_KEY_INDEX],
				fields: CREDENTIAL_FIELDS.concat(AUTODATE_FIELDS).map(toField),
			});
			app.save(collection);
			collection = findCollectionSafe(app, "pinterest_app_credentials");
			if (!collection) {
				throw new Error("Failed to create pinterest_app_credentials collection");
			}
			assertRequiredFields(collection);
			return;
		}

		// Existing collection (including empty stubs with only system id): add missing fields.
		let dirty = false;
		for (const def of CREDENTIAL_FIELDS) {
			dirty = ensureField(collection, def) || dirty;
		}
		for (const def of AUTODATE_FIELDS) {
			dirty = ensureField(collection, def) || dirty;
		}

		// Keep API-only (no client rules).
		if (collection.listRule !== null
			|| collection.viewRule !== null
			|| collection.createRule !== null
			|| collection.updateRule !== null
			|| collection.deleteRule !== null) {
			collection.listRule = null;
			collection.viewRule = null;
			collection.createRule = null;
			collection.updateRule = null;
			collection.deleteRule = null;
			dirty = true;
		}

		dirty = ensureIndex(collection, UNIQUE_CONFIG_KEY_INDEX) || dirty;

		if (dirty) {
			app.save(collection);
			collection = findCollectionSafe(app, "pinterest_app_credentials");
		}

		assertRequiredFields(collection);
	},
	(_app) => {
		// Non-destructive: do not remove fields or drop the collection.
	},
);
