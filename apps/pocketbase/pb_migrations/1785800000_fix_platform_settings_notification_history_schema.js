/// <reference path="../pb_data/types.d.ts" />
/**
 * Permanent repair for platform_settings + notification_history schema (PB v0.38+).
 *
 * Root cause:
 * 1783972000 only created each collection when missing, and passed Field class
 * instances into `new Collection({ fields })`. On PocketBase v0.38 those fields
 * are dropped on save, leaving id-only shells. The migration was still recorded
 * as applied, so restarts never re-ran the schema work.
 *
 * This migration is idempotent and production-safe:
 * - creates each collection when absent (plain field objects on create)
 * - adds any missing fields when the collection already exists (fields.add + toField)
 * - deduplicates platform_settings config_key values before the unique index
 * - ensures required indexes
 * - asserts all expected fields exist after save (fails loudly if not)
 * - never drops collections or deletes rows except duplicate config_key rows
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

function collectionHasIndexMarker(collection, marker) {
	const indexes = Array.isArray(collection?.indexes) ? collection.indexes : [];
	return indexes.some((sql) => String(sql).includes(marker));
}

function ensureIndexSql(collection, indexSql, marker) {
	if (collectionHasIndexMarker(collection, marker)) return false;
	const indexes = Array.isArray(collection.indexes) ? collection.indexes.slice() : [];
	if (indexes.includes(indexSql)) return false;
	indexes.push(indexSql);
	collection.indexes = indexes;
	return true;
}

function ensureApiOnlyRules(collection) {
	let dirty = false;
	if (collection.listRule !== null) {
		collection.listRule = null;
		dirty = true;
	}
	if (collection.viewRule !== null) {
		collection.viewRule = null;
		dirty = true;
	}
	if (collection.createRule !== null) {
		collection.createRule = null;
		dirty = true;
	}
	if (collection.updateRule !== null) {
		collection.updateRule = null;
		dirty = true;
	}
	if (collection.deleteRule !== null) {
		collection.deleteRule = null;
		dirty = true;
	}
	return dirty;
}

function assertFields(collection, collectionName, fieldNames) {
	const missing = fieldNames.filter((name) => !collection.fields.getByName(name));
	if (missing.length) {
		throw new Error(`${collectionName} still missing fields after save: ${missing.join(", ")}`);
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

function recordJson(record, field) {
	try {
		const value = record.get(field);
		if (value && typeof value === "object") return value;
		return null;
	} catch (_) {
		return null;
	}
}

/**
 * Prefer non-empty values from older duplicates onto the newest keeper.
 * Never overwrites a non-empty keeper value.
 */
function mergePlatformSettingsIntoKeeper(keeper, older) {
	let changed = false;

	if (!recordString(keeper, "config_key") && recordString(older, "config_key")) {
		keeper.set("config_key", older.get("config_key"));
		changed = true;
	}
	if (!recordString(keeper, "version") && recordString(older, "version")) {
		keeper.set("version", older.get("version"));
		changed = true;
	}

	const keeperPayload = recordJson(keeper, "payload");
	const olderPayload = recordJson(older, "payload");
	if (keeperPayload == null && olderPayload != null) {
		keeper.set("payload", olderPayload);
		changed = true;
	}

	const keeperMeta = recordJson(keeper, "meta");
	const olderMeta = recordJson(older, "meta");
	if (keeperMeta == null && olderMeta != null) {
		keeper.set("meta", olderMeta);
		changed = true;
	}

	return changed;
}

function dedupePlatformSettingsConfigKeys(app, collection) {
	if (!collection.fields.getByName("config_key")) return 0;

	let records = [];
	try {
		records = app.findRecordsByFilter(
			collection.name || "platform_settings",
			"",
			"-updated,-created",
			0,
			0,
		) || [];
	} catch (_) {
		try {
			records = app.findAllRecords(collection.name || "platform_settings") || [];
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
			keeperDirty = mergePlatformSettingsIntoKeeper(keeper, older) || keeperDirty;
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

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

const PLATFORM_SETTINGS_FIELDS = [
	{ type: "text", name: "config_key", required: true, max: 40 },
	{ type: "json", name: "payload", maxSize: 500000 },
	{ type: "text", name: "version", max: 40 },
	{ type: "json", name: "meta", maxSize: 100000 },
];

const PLATFORM_SETTINGS_FIELD_NAMES = [
	"config_key",
	"payload",
	"version",
	"meta",
	"created",
	"updated",
];

const NOTIFICATION_HISTORY_FIELDS = [
	{ type: "text", name: "title", required: true, max: 300 },
	{ type: "text", name: "body", max: 4000 },
	{
		type: "select",
		name: "channel",
		required: true,
		maxSelect: 1,
		values: ["email", "in-app", "in_app", "system"],
	},
	{
		type: "select",
		name: "status",
		required: true,
		maxSelect: 1,
		values: ["queued", "sent", "failed", "draft", "active"],
	},
	{ type: "text", name: "audience", max: 200 },
	{ type: "text", name: "template_id", max: 80 },
	{ type: "date", name: "sent_at" },
	{ type: "json", name: "meta", maxSize: 100000 },
];

const NOTIFICATION_HISTORY_FIELD_NAMES = [
	"title",
	"body",
	"channel",
	"status",
	"audience",
	"template_id",
	"sent_at",
	"meta",
	"created",
	"updated",
];

const UNIQUE_PLATFORM_SETTINGS_KEY_INDEX =
	"CREATE UNIQUE INDEX `idx_platform_settings_key` ON `platform_settings` (`config_key`)";

const NOTIFICATION_HISTORY_STATUS_INDEX =
	"CREATE INDEX `idx_notification_history_status` ON `notification_history` (`status`)";

const NOTIFICATION_HISTORY_CREATED_INDEX =
	"CREATE INDEX `idx_notification_history_created` ON `notification_history` (`created`)";

function plainCreateFields(fieldDefs) {
	return [
		{
			autogeneratePattern: "[a-z0-9]{15}",
			hidden: false,
			id: "text3208210256",
			max: 15,
			min: 15,
			name: "id",
			pattern: "^[a-z0-9]+$",
			presentable: false,
			primaryKey: true,
			required: true,
			system: true,
			type: "text",
		},
		...fieldDefs,
		...AUTODATE_FIELDS,
	];
}

function ensurePlatformSettingsCollection(app) {
	let collection = findCollectionSafe(app, "platform_settings");

	if (!collection) {
		collection = new Collection({
			type: "base",
			name: "platform_settings",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			indexes: [UNIQUE_PLATFORM_SETTINGS_KEY_INDEX],
			fields: plainCreateFields(PLATFORM_SETTINGS_FIELDS),
		});
		app.save(collection);
		collection = findCollectionSafe(app, "platform_settings");
		if (!collection) {
			throw new Error("Failed to create platform_settings collection");
		}
		assertFields(collection, "platform_settings", PLATFORM_SETTINGS_FIELD_NAMES);
		return;
	}

	let dirty = ensureApiOnlyRules(collection);
	for (const def of PLATFORM_SETTINGS_FIELDS) {
		dirty = ensureField(collection, def) || dirty;
	}
	for (const def of AUTODATE_FIELDS) {
		dirty = ensureField(collection, def) || dirty;
	}

	if (dirty) {
		app.save(collection);
		collection = findCollectionSafe(app, "platform_settings");
	}

	assertFields(collection, "platform_settings", PLATFORM_SETTINGS_FIELD_NAMES);

	dedupePlatformSettingsConfigKeys(app, collection);

	collection = findCollectionSafe(app, "platform_settings");
	if (ensureIndexSql(collection, UNIQUE_PLATFORM_SETTINGS_KEY_INDEX, "idx_platform_settings_key")) {
		app.save(collection);
	}

	assertFields(findCollectionSafe(app, "platform_settings"), "platform_settings", PLATFORM_SETTINGS_FIELD_NAMES);
}

function ensureNotificationHistoryCollection(app) {
	let collection = findCollectionSafe(app, "notification_history");

	if (!collection) {
		collection = new Collection({
			type: "base",
			name: "notification_history",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			indexes: [
				NOTIFICATION_HISTORY_STATUS_INDEX,
				NOTIFICATION_HISTORY_CREATED_INDEX,
			],
			fields: plainCreateFields(NOTIFICATION_HISTORY_FIELDS),
		});
		app.save(collection);
		collection = findCollectionSafe(app, "notification_history");
		if (!collection) {
			throw new Error("Failed to create notification_history collection");
		}
		assertFields(collection, "notification_history", NOTIFICATION_HISTORY_FIELD_NAMES);
		return;
	}

	let dirty = ensureApiOnlyRules(collection);
	for (const def of NOTIFICATION_HISTORY_FIELDS) {
		dirty = ensureField(collection, def) || dirty;
	}
	for (const def of AUTODATE_FIELDS) {
		dirty = ensureField(collection, def) || dirty;
	}

	if (dirty) {
		app.save(collection);
		collection = findCollectionSafe(app, "notification_history");
	}

	assertFields(collection, "notification_history", NOTIFICATION_HISTORY_FIELD_NAMES);

	collection = findCollectionSafe(app, "notification_history");
	let indexesDirty = ensureIndexSql(collection, NOTIFICATION_HISTORY_STATUS_INDEX, "idx_notification_history_status");
	indexesDirty = ensureIndexSql(collection, NOTIFICATION_HISTORY_CREATED_INDEX, "idx_notification_history_created") || indexesDirty;

	if (indexesDirty) {
		app.save(collection);
	}

	assertFields(findCollectionSafe(app, "notification_history"), "notification_history", NOTIFICATION_HISTORY_FIELD_NAMES);
}

migrate(
	(app) => {
		ensurePlatformSettingsCollection(app);
		ensureNotificationHistoryCollection(app);
	},
	(_app) => {
		// Non-destructive: do not remove fields or drop collections.
	},
);
