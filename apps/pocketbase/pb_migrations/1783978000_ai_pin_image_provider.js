/// <reference path="../pb_data/types.d.ts" />
/**
 * Durable image_provider text field on ai_pin_image_jobs.
 * prompt_payload alone is not reliable enough for worker provider selection.
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

migrate(
	(app) => {
		const jobs = findCollectionSafe(app, "ai_pin_image_jobs");
		if (!jobs) return;
		if (ensureField(jobs, { type: "text", name: "image_provider", max: 40 })) {
			app.save(jobs);
		}
	},
	(_app) => {
		// non-destructive
	},
);
