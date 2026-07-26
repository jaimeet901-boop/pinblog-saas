/// <reference path="../pb_data/types.d.ts" />
/**
 * AI Pins — historical template snapshot fields (additive, non-destructive).
 *
 * Stores the exact template used at draft creation time so later gallery
 * edits/renames/deletes/version publishes never change existing drafts.
 *
 * Up: add optional fields only (no row backfill).
 * Down: remove only fields introduced here.
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
		date: pickCtor(typeof DateField !== "undefined" ? DateField : null, coreNS.DateField),
		json: pickCtor(typeof JSONField !== "undefined" ? JSONField : null, coreNS.JSONField),
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

function removeFieldSafe(collection, name) {
	const field = collection.fields.getByName(name);
	if (!field) return false;
	collection.fields.removeById(field.id);
	return true;
}

const ADDED_FIELD_NAMES = [
	"template_id",
	"template_name",
	"template_version",
	"template_configuration",
	"template_thumbnail",
	"template_snapshot_at",
];

migrate(
	(app) => {
		const aiPins = findCollectionSafe(app, "ai_pins");
		if (!aiPins) return;

		let dirty = false;
		dirty = ensureField(aiPins, { type: "text", name: "template_id", max: 80 }) || dirty;
		dirty = ensureField(aiPins, { type: "text", name: "template_name", max: 180 }) || dirty;
		dirty = ensureField(aiPins, { type: "text", name: "template_version", max: 120 }) || dirty;
		dirty = ensureField(aiPins, {
			type: "json",
			name: "template_configuration",
			maxSize: 300000,
		}) || dirty;
		dirty = ensureField(aiPins, { type: "text", name: "template_thumbnail", max: 4000 }) || dirty;
		dirty = ensureField(aiPins, { type: "date", name: "template_snapshot_at" }) || dirty;

		if (dirty) {
			app.save(aiPins);
		}
	},
	(app) => {
		const aiPins = findCollectionSafe(app, "ai_pins");
		if (!aiPins) return;
		let dirty = false;
		for (const name of ADDED_FIELD_NAMES) {
			dirty = removeFieldSafe(aiPins, name) || dirty;
		}
		if (dirty) {
			app.save(aiPins);
		}
	},
);
