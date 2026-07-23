/// <reference path="../pb_data/types.d.ts" />
/**
 * Permanent repair for pinterest_app_credentials schema (PB v0.38+).
 *
 * Root cause:
 * 1783971000 only created the collection when missing. If an empty/stub
 * collection already existed, the migration was marked applied without fields.
 *
 * This migration is idempotent and production-safe:
 * - creates the collection when absent
 * - adds any missing fields when the collection already exists
 * - deduplicates config_key values before creating the unique index
 * - ensures the unique config_key index
 * - never drops the collection
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

function hasUniqueConfigKeyIndex(collection) {
	const indexes = Array.isArray(collection.indexes) ? collection.indexes : [];
	return indexes.some((item) => {
		const value = String(item || "").replace(/\s+/g, " ").trim().toLowerCase();
		return value.includes("idx_pinterest_app_credentials_key")
			|| (value.includes("unique index") && value.includes("config_key"));
	});
}

function ensureIndex(collection, indexSql) {
	if (hasUniqueConfigKeyIndex(collection)) return false;

	if (typeof collection.addIndex === "function") {
		collection.addIndex("idx_pinterest_app_credentials_key", true, "config_key", "");
		return true;
	}

	const indexes = Array.isArray(collection.indexes) ? collection.indexes : [];
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

function recordTimestampMs(record) {
	const updated = String(record.get("updated") || record.getString?.("updated") || "");
	const created = String(record.get("created") || record.getString?.("created") || "");
	const updatedMs = Date.parse(updated);
	const createdMs = Date.parse(created);
	if (Number.isFinite(updatedMs)) return updatedMs;
	if (Number.isFinite(createdMs)) return createdMs;
	return 0;
}

function recordString(record, field) {
	try {
		const value = record.get(field);
		if (value == null) return "";
		return String(value).trim();
	} catch (_) {
		return "";
	}
}

function recordBool(record, field) {
	try {
		return Boolean(record.get(field));
	} catch (_) {
		return false;
	}
}

function recordJson(record, field) {
	try {
		const value = record.get(field);
		if (value && typeof value === "object") return value;
		return {};
	} catch (_) {
		return {};
	}
}

/**
 * Prefer non-empty values from older duplicates onto the newest keeper.
 * Never overwrites a non-empty keeper value.
 */
function mergeCredentialIntoKeeper(keeper, older) {
	const textFields = [
		"app_id",
		"app_secret_ciphertext",
		"redirect_uri",
		"scopes",
		"kek_version",
	];
	let changed = false;

	for (const field of textFields) {
		if (!recordString(keeper, field) && recordString(older, field)) {
			keeper.set(field, older.get(field));
			changed = true;
		}
	}

	// Prefer enabled=true / trial_access_pending=false when older has clearer production state.
	if (!recordBool(keeper, "enabled") && recordBool(older, "enabled")) {
		keeper.set("enabled", true);
		changed = true;
	}
	if (recordBool(keeper, "trial_access_pending") && !recordBool(older, "trial_access_pending")) {
		keeper.set("trial_access_pending", false);
		changed = true;
	}

	const keeperMeta = recordJson(keeper, "meta");
	const olderMeta = recordJson(older, "meta");
	if (Object.keys(keeperMeta).length === 0 && Object.keys(olderMeta).length > 0) {
		keeper.set("meta", olderMeta);
		changed = true;
	}

	return changed;
}

/**
 * Detect duplicate config_key values, keep newest per key, merge useful older fields, delete older rows.
 * Safe when config_key field exists; no-op when collection has zero records.
 */
function dedupeConfigKeyRecords(app, collection) {
	if (!collection.fields.getByName("config_key")) return 0;

	let records = [];
	try {
		records = app.findRecordsByFilter(
			collection.name || "pinterest_app_credentials",
			"",
			"-updated,-created",
			0,
			0,
		) || [];
	} catch (_) {
		try {
			records = app.findAllRecords(collection.name || "pinterest_app_credentials") || [];
		} catch (__) {
			return 0;
		}
	}

	if (!records.length) return 0;

	const groups = {};
	for (const record of records) {
		const key = recordString(record, "config_key") || "__empty__";
		if (!groups[key]) groups[key] = [];
		groups[key].push(record);
	}

	let deleted = 0;

	for (const key of Object.keys(groups)) {
		const group = groups[key];
		if (group.length < 2) continue;

		group.sort((a, b) => {
			const delta = recordTimestampMs(b) - recordTimestampMs(a);
			if (delta !== 0) return delta;
			return String(b.id || "").localeCompare(String(a.id || ""));
		});

		const keeper = group[0];
		let keeperDirty = false;

		for (let i = 1; i < group.length; i++) {
			const older = group[i];
			keeperDirty = mergeCredentialIntoKeeper(keeper, older) || keeperDirty;
			app.delete(older);
			deleted += 1;
		}

		if (keeperDirty) {
			if (typeof app.saveNoValidate === "function") {
				app.saveNoValidate(keeper);
			} else {
				app.save(keeper);
			}
		}
	}

	return deleted;
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

		// 1) Ensure fields + API-only rules first (without unique index yet).
		let dirty = false;
		for (const def of CREDENTIAL_FIELDS) {
			dirty = ensureField(collection, def) || dirty;
		}
		for (const def of AUTODATE_FIELDS) {
			dirty = ensureField(collection, def) || dirty;
		}

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

		if (dirty) {
			app.save(collection);
			collection = findCollectionSafe(app, "pinterest_app_credentials");
		}

		assertRequiredFields(collection);

		// 2) Deduplicate config_key before unique index creation.
		dedupeConfigKeyRecords(app, collection);

		// 3) Create unique index only after duplicates are gone.
		collection = findCollectionSafe(app, "pinterest_app_credentials");
		if (ensureIndex(collection, UNIQUE_CONFIG_KEY_INDEX)) {
			app.save(collection);
		}

		assertRequiredFields(findCollectionSafe(app, "pinterest_app_credentials"));
	},
	(_app) => {
		// Non-destructive: do not remove fields or drop the collection.
	},
);
