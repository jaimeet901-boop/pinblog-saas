/// <reference path="../pb_data/types.d.ts" />
/**
 * Template Engine Module 1 final adjustments:
 * - template_uuid: immutable public UUID (never changes on migrate/export)
 * - config_checksum: hash of configuration for change detection / preview invalidation
 * - revision: optimistic locking counter
 * - composite indexes (workspace_id, category, status) and (workspace_id, visibility, updated)
 *
 * Reversible: down removes only fields/indexes introduced here.
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

const ADDED_FIELD_NAMES = ["template_uuid", "config_checksum", "revision"];

const INDEX_SQL = [
	"CREATE UNIQUE INDEX `idx_ai_pin_templates_template_uuid` ON `ai_pin_templates` (`template_uuid`)",
	"CREATE INDEX `idx_ai_pin_templates_config_checksum` ON `ai_pin_templates` (`config_checksum`)",
	"CREATE INDEX `idx_ai_pin_templates_workspace_category_status` ON `ai_pin_templates` (`workspace_id`, `category`, `status`)",
	"CREATE INDEX `idx_ai_pin_templates_workspace_visibility_updated` ON `ai_pin_templates` (`workspace_id`, `visibility`, `updated`)",
];

const INDEX_NAME_MARKERS = [
	"idx_ai_pin_templates_template_uuid",
	"idx_ai_pin_templates_config_checksum",
	"idx_ai_pin_templates_workspace_category_status",
	"idx_ai_pin_templates_workspace_visibility_updated",
];

migrate(
	(app) => {
		const templates = findCollectionSafe(app, "ai_pin_templates");
		if (!templates) return;

		let dirty = false;
		dirty = ensureField(templates, {
			type: "text",
			name: "template_uuid",
			max: 64,
		}) || dirty;
		dirty = ensureField(templates, {
			type: "text",
			name: "config_checksum",
			max: 128,
		}) || dirty;
		dirty = ensureField(templates, {
			type: "number",
			name: "revision",
			min: 1,
		}) || dirty;

		const existing = Array.isArray(templates.indexes) ? templates.indexes.slice() : [];
		for (const sql of INDEX_SQL) {
			if (!existing.includes(sql)) {
				existing.push(sql);
				dirty = true;
			}
		}
		templates.indexes = existing;

		if (dirty) {
			app.save(templates);
		}
	},
	(app) => {
		const templates = findCollectionSafe(app, "ai_pin_templates");
		if (!templates) return;

		let dirty = false;
		for (const name of ADDED_FIELD_NAMES) {
			dirty = removeFieldSafe(templates, name) || dirty;
		}

		if (Array.isArray(templates.indexes)) {
			templates.indexes = templates.indexes.filter((sql) => {
				const text = String(sql);
				for (const marker of INDEX_NAME_MARKERS) {
					if (text.includes(marker)) return false;
				}
				return true;
			});
			dirty = true;
		}

		if (dirty) {
			app.save(templates);
		}
	},
);
