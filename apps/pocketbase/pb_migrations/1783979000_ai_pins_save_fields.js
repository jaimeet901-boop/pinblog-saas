/// <reference path="../pb_data/types.d.ts" />
/**
 * AI Pins save fixes:
 * - Allow image_source = featured_composed (local canvas compose uploads)
 * - Allow image_generation_status = rendering (legacy in-flight UI state)
 * - Raise image_url max length for PocketBase file URLs
 * - Ensure pinterest_account_* fields exist
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
		select: pickCtor(typeof SelectField !== "undefined" ? SelectField : null, coreNS.SelectField),
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

function ensureTextField(collection, name, max) {
	const existing = collection.fields.getByName(name);
	if (existing) {
		if (typeof existing.max === "number" && existing.max < max) {
			existing.max = max;
			return true;
		}
		return false;
	}
	collection.fields.add(toField({ type: "text", name, max }));
	return true;
}

function ensureSelectValues(collection, name, values) {
	const field = collection.fields.getByName(name);
	if (!field) return false;
	const current = Array.isArray(field.values) ? field.values.slice() : [];
	let changed = false;
	for (const value of values) {
		if (!current.includes(value)) {
			current.push(value);
			changed = true;
		}
	}
	if (changed) {
		field.values = current;
	}
	return changed;
}

migrate(
	(app) => {
		const aiPins = findCollectionSafe(app, "ai_pins");
		if (!aiPins) return;

		let dirty = false;
		dirty = ensureSelectValues(aiPins, "image_source", [
			"featured",
			"ai_generated",
			"featured_fallback",
			"featured_composed",
		]) || dirty;
		dirty = ensureSelectValues(aiPins, "image_generation_status", [
			"idle",
			"queued",
			"processing",
			"completed",
			"failed",
			"fallback",
			"rendering",
		]) || dirty;
		dirty = ensureTextField(aiPins, "image_url", 4000) || dirty;
		dirty = ensureTextField(aiPins, "pinterest_account_id", 80) || dirty;
		dirty = ensureTextField(aiPins, "pinterest_account_label", 255) || dirty;

		if (dirty) {
			app.save(aiPins);
		}
	},
	(_app) => {
		// non-destructive
	},
);
