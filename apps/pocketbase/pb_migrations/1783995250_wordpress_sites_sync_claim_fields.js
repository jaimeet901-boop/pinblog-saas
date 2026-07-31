/// <reference path="../pb_data/types.d.ts" />
/**
 * WordPress sync CAS claim fields on wordpress_sites.
 * Previously only present via API ensureWordpressIntegrationSchema / a local PB dump;
 * keep them in committed migrations for fresh PocketBase deploys.
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
		const sites = findCollectionSafe(app, "wordpress_sites");
		if (!sites) return;

		let dirty = false;
		if (!sites.fields.getByName("sync_claim_token")) {
			sites.fields.add(toField({ type: "text", name: "sync_claim_token", max: 80 }));
			dirty = true;
		}
		if (!sites.fields.getByName("sync_claim_version")) {
			sites.fields.add(toField({ type: "number", name: "sync_claim_version", min: 0 }));
			dirty = true;
		}
		if (dirty) {
			app.save(sites);
		}
	},
	(app) => {
		// Additive — keep claim fields on down (safe).
		void app;
	},
);
