/// <reference path="../pb_data/types.d.ts" />
/**
 * Store which Pinterest OAuth App ID issued an account's tokens,
 * and expand error text fields so raw Pinterest API dumps fit.
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

function bumpTextMax(collection, name, max) {
	const field = collection.fields.getByName(name);
	if (!field) return false;
	if (Number(field.max) >= max) return false;
	field.max = max;
	return true;
}

migrate(
	(app) => {
		const accounts = findCollectionSafe(app, "pinterest_accounts");
		if (accounts) {
			let dirty = ensureField(accounts, { type: "text", name: "oauth_app_id", max: 200 });
			if (dirty) app.save(accounts);
		}

		const jobs = findCollectionSafe(app, "pinterest_publish_jobs");
		if (jobs) {
			let dirty = bumpTextMax(jobs, "last_error", 20000);
			if (dirty) app.save(jobs);
		}

		const pins = findCollectionSafe(app, "ai_pins");
		if (pins) {
			let dirty = bumpTextMax(pins, "publish_error", 20000);
			if (dirty) app.save(pins);
		}

		const history = findCollectionSafe(app, "pinterest_publish_history");
		if (history) {
			let dirty = bumpTextMax(history, "error", 20000);
			if (dirty) app.save(history);
		}
	},
	(app) => {
		const accounts = findCollectionSafe(app, "pinterest_accounts");
		if (accounts) {
			const field = accounts.fields.getByName("oauth_app_id");
			if (field) {
				accounts.fields.removeById(field.id);
				app.save(accounts);
			}
		}
	},
);
