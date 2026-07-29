/// <reference path="../pb_data/types.d.ts" />
/**
 * Website lifecycle: soft-remove vs permanent delete.
 *
 * - removed_at: set when disconnected (soft remove); cleared on reconnect
 * - lifecycle_state: active | disconnected | purging
 *
 * Soft remove keeps related data. Permanent delete purges dependents then the row.
 * Domain uniqueness within a workspace is enforced in the API (not a global unique index).
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
		relation: pickCtor(typeof RelationField !== "undefined" ? RelationField : null, coreNS.RelationField),
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

migrate(
	(app) => {
		const websites = findCollectionSafe(app, "websites");
		if (!websites) return;

		let dirty = false;
		dirty = ensureField(websites, { type: "date", name: "removed_at" }) || dirty;

		if (!websites.fields.getByName("lifecycle_state")) {
			websites.fields.add(toField({
				type: "select",
				name: "lifecycle_state",
				maxSelect: 1,
				values: ["active", "disconnected", "purging"],
			}));
			dirty = true;
		} else {
			const field = websites.fields.getByName("lifecycle_state");
			const values = Array.isArray(field.values) ? field.values.slice() : [];
			for (const value of ["active", "disconnected", "purging"]) {
				if (!values.includes(value)) values.push(value);
			}
			if (values.length !== (field.values || []).length) {
				field.values = values;
				dirty = true;
			}
		}

		if (dirty) app.save(websites);
	},
	(app) => {
		const websites = findCollectionSafe(app, "websites");
		if (!websites) return;
		const removedAt = websites.fields.getByName("removed_at");
		if (removedAt) websites.fields.remove(removedAt.id);
		const lifecycle = websites.fields.getByName("lifecycle_state");
		if (lifecycle) websites.fields.remove(lifecycle.id);
		app.save(websites);
	},
);
