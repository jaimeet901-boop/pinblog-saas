/// <reference path="../pb_data/types.d.ts" />
/**
 * Phase 4.1 — claim_token / claim_version on ai_pin_image_jobs
 * for CAS-style multi-instance claim (parity with Pinterest/WP queues).
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

migrate(
	(app) => {
		const jobs = findCollectionSafe(app, "ai_pin_image_jobs");
		if (!jobs) return;

		let dirty = false;
		if (!jobs.fields.getByName("claim_token")) {
			jobs.fields.add(toField({ type: "text", name: "claim_token", max: 120 }));
			dirty = true;
		}
		if (!jobs.fields.getByName("claim_version")) {
			jobs.fields.add(toField({ type: "number", name: "claim_version", min: 0 }));
			dirty = true;
		}
		if (dirty) {
			app.save(jobs);
		}
	},
	(app) => {
		// Additive — keep claim fields on down (safe).
		void app;
	},
);
