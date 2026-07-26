/// <reference path="../pb_data/types.d.ts" />
/**
 * AI Pins — permanent source article URL + image origin for publish.
 *
 * source_url: denormalized article URL kept on the pin forever (destination link).
 * image_origin: featured | body | ai — display Image Source on Publish screen.
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

const ADDED_FIELD_NAMES = ["source_url", "image_origin"];

migrate(
	(app) => {
		const aiPins = findCollectionSafe(app, "ai_pins");
		if (!aiPins) return;

		let dirty = false;
		dirty = ensureField(aiPins, { type: "text", name: "source_url", max: 2000 }) || dirty;
		dirty = ensureField(aiPins, { type: "text", name: "image_origin", max: 32 }) || dirty;

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
