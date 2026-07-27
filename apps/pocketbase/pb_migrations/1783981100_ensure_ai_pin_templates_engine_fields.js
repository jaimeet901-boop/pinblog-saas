/// <reference path="../pb_data/types.d.ts" />
/**
 * Ensure Template Engine fields exist on ai_pin_templates.
 *
 * Production can be missing visibility/status/deleted_at while still having
 * hundreds of rows (pre–Module 1 schema). 1783981000 is the original adder;
 * this migration re-applies the same fields idempotently and FAILS if they
 * are still absent after save — so the migration cannot be recorded as
 * applied without the schema actually changing.
 *
 * Also hardens against the silent early-return in 1783981000
 * (`if (!templates) return`), which marks a migration applied with no work.
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

function relationField(name, collectionId, options = {}) {
	return {
		name,
		type: "relation",
		required: options.required === true,
		maxSelect: options.maxSelect ?? 1,
		collectionId,
		cascadeDelete: options.cascadeDelete === true,
	};
}

const TEMPLATE_CATEGORIES = [
	"recipes",
	"dinner",
	"breakfast",
	"desserts",
	"snacks",
	"drinks",
	"healthy",
	"lifestyle",
	"home",
	"fitness",
	"travel",
	"finance",
	"technology",
	"diy",
	"general",
];
const TEMPLATE_STATUS = ["draft", "published", "archived"];
const TEMPLATE_VISIBILITY = ["private", "workspace", "public", "official", "community"];

const REQUIRED_AFTER_SAVE = ["status", "visibility", "deleted_at", "workspace_id", "category"];

migrate(
	(app) => {
		const templates = findCollectionSafe(app, "ai_pin_templates");
		if (!templates) {
			throw new Error(
				"1783981100: ai_pin_templates is required before Template Engine fields can be applied",
			);
		}

		const users = app.findCollectionByNameOrId("users");
		const workspaces = findCollectionSafe(app, "workspaces");
		const brandKits = findCollectionSafe(app, "brand_kits");

		let dirty = false;

		if (workspaces) {
			dirty = ensureField(templates, relationField("workspace_id", workspaces.id, { required: false })) || dirty;
		} else {
			dirty = ensureField(templates, { type: "text", name: "workspace_id", max: 80 }) || dirty;
		}

		dirty = ensureField(templates, relationField("created_by", users.id, { required: false })) || dirty;
		dirty = ensureField(templates, { type: "date", name: "deleted_at" }) || dirty;
		dirty = ensureField(templates, {
			type: "select",
			name: "category",
			maxSelect: 1,
			values: TEMPLATE_CATEGORIES,
		}) || dirty;
		dirty = ensureField(templates, { type: "number", name: "editor_version", min: 1 }) || dirty;
		dirty = ensureField(templates, { type: "number", name: "schema_version", min: 1 }) || dirty;
		dirty = ensureField(templates, {
			type: "select",
			name: "status",
			maxSelect: 1,
			values: TEMPLATE_STATUS,
		}) || dirty;
		dirty = ensureField(templates, {
			type: "select",
			name: "visibility",
			maxSelect: 1,
			values: TEMPLATE_VISIBILITY,
		}) || dirty;
		dirty = ensureField(templates, { type: "date", name: "last_used_at" }) || dirty;
		dirty = ensureField(templates, { type: "number", name: "use_count", min: 0 }) || dirty;
		dirty = ensureField(templates, { type: "text", name: "variant_group_id", max: 80 }) || dirty;

		if (brandKits) {
			dirty = ensureField(templates, relationField("brand_kit", brandKits.id, { required: false })) || dirty;
		}

		dirty = ensureField(templates, { type: "json", name: "marketplace_meta", maxSize: 100000 }) || dirty;

		const indexSql = [
			"CREATE INDEX `idx_ai_pin_templates_workspace` ON `ai_pin_templates` (`workspace_id`)",
			"CREATE INDEX `idx_ai_pin_templates_workspace_category` ON `ai_pin_templates` (`workspace_id`, `category`)",
			"CREATE INDEX `idx_ai_pin_templates_workspace_visibility` ON `ai_pin_templates` (`workspace_id`, `visibility`)",
			"CREATE INDEX `idx_ai_pin_templates_workspace_status` ON `ai_pin_templates` (`workspace_id`, `status`)",
			"CREATE INDEX `idx_ai_pin_templates_workspace_updated` ON `ai_pin_templates` (`workspace_id`, `updated`)",
			"CREATE INDEX `idx_ai_pin_templates_workspace_last_used` ON `ai_pin_templates` (`workspace_id`, `last_used_at`)",
			"CREATE INDEX `idx_ai_pin_templates_variant_group` ON `ai_pin_templates` (`variant_group_id`)",
			"CREATE INDEX `idx_ai_pin_templates_created_by` ON `ai_pin_templates` (`created_by`)",
		];
		const existing = Array.isArray(templates.indexes) ? templates.indexes.slice() : [];
		for (const sql of indexSql) {
			if (!existing.includes(sql)) {
				existing.push(sql);
				dirty = true;
			}
		}
		templates.indexes = existing;

		if (dirty) {
			app.save(templates);
		}

		const persisted = app.findCollectionByNameOrId("ai_pin_templates");
		const missing = REQUIRED_AFTER_SAVE.filter((name) => !persisted.fields.getByName(name));
		if (missing.length) {
			throw new Error(
				`1783981100: ai_pin_templates still missing fields after ensure: ${missing.join(", ")}`,
			);
		}
	},
	(app) => {
		// Non-destructive down: do not strip fields that older migrations also own.
		const templates = findCollectionSafe(app, "ai_pin_templates");
		if (!templates) return;
	},
);
