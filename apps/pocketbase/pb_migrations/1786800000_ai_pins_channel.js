/// <reference path="../pb_data/types.d.ts" />
/**
 * AI-CROSS-02 Phase 1 — nullable studio channel on ai_pins.
 *
 * Additive only: pinterest | facebook. Existing rows stay empty/null.
 * Does not backfill, rewrite, or delete legacy records.
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
		select: pickCtor(typeof SelectField !== "undefined" ? SelectField : null, coreNS.SelectField),
	};
	const Ctor = ctorByType[def.type];
	if (!Ctor) throw new Error("Unsupported migration field type: " + def.type);
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

function ensureIndexIdempotent(collection, sql) {
	const indexes = Array.isArray(collection.indexes) ? collection.indexes.slice() : [];
	if (indexes.includes(sql)) return false;
	const marker = String(sql).match(/`(idx_[^`]+)`/);
	if (marker && indexes.some((existing) => String(existing).includes(marker[1]))) {
		return false;
	}
	indexes.push(sql);
	collection.indexes = indexes;
	return true;
}

const CHANNEL_INDEX_SQL =
	"CREATE INDEX `idx_ai_pins_workspace_website_channel` ON `ai_pins` (`workspace`, `websiteId`, `channel`)";

migrate(
	(app) => {
		const aiPins = findCollectionSafe(app, "ai_pins");
		if (!aiPins) return;

		let dirty = false;
		dirty = ensureField(aiPins, {
			type: "select",
			name: "channel",
			required: false,
			maxSelect: 1,
			values: ["pinterest", "facebook"],
		}) || dirty;
		dirty = ensureIndexIdempotent(aiPins, CHANNEL_INDEX_SQL) || dirty;

		if (dirty) {
			app.save(aiPins);
		}
	},
	(_app) => {
		// non-destructive — do not drop channel or rewrite legacy rows
	},
);
