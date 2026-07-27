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

const UNIQUE_TEMPLATE_UUID_INDEX_SQL = "CREATE UNIQUE INDEX `idx_ai_pin_templates_template_uuid` ON `ai_pin_templates` (`template_uuid`)";

const NON_UNIQUE_INDEX_SQL = [
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

function recordString(record, field) {
	try {
		const v = record.get(field);
		if (v == null) return "";
		return String(v).trim();
	} catch {
		return "";
	}
}

function recordTimestampMs(record) {
	try {
		const updated = record.get("updated");
		const created = record.get("created");
		const t = Date.parse(String(updated || created || ""));
		return Number.isFinite(t) ? t : 0;
	} catch {
		return 0;
	}
}

function deterministicUuidV4FromString(seed) {
	// Deterministic, v4-like string for migration repair.
	// Stable across retries and unique per record.id.
	function fnv1a(input, state) {
		let h = 0x811c9dc5 ^ state;
		for (let i = 0; i < input.length; i += 1) {
			h ^= input.charCodeAt(i);
			h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
		}
		return h >>> 0;
	}

	const s = String(seed || "");
	const a = fnv1a(s, 0);
	const b = fnv1a(s, 1);
	const c = fnv1a(s, 2);
	const d = fnv1a(s, 3);

	const bytes = [
		a & 0xff,
		(a >>> 8) & 0xff,
		(a >>> 16) & 0xff,
		(a >>> 24) & 0xff,
		b & 0xff,
		(b >>> 8) & 0xff,
		(b >>> 16) & 0xff,
		(b >>> 24) & 0xff,
		c & 0xff,
		(c >>> 8) & 0xff,
		(c >>> 16) & 0xff,
		(c >>> 24) & 0xff,
		d & 0xff,
		(d >>> 8) & 0xff,
		(d >>> 16) & 0xff,
		(d >>> 24) & 0xff,
	];

	// UUID v4: set version bits (4) and variant bits (10xx).
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	const hex = bytes.map((x) => x.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function findAllRecordsSafe(app, collectionName) {
	try {
		return app.findRecordsByFilter(collectionName, "", "-updated,-created", 0, 0) || [];
	} catch (_) {
		try {
			return app.findAllRecords(collectionName) || [];
		} catch {
			return [];
		}
	}
}

function dedupeTemplateUuidRecords(app, templatesCollection) {
	// Idempotent: only touches records when duplicates/empty exist.
	if (!templatesCollection.fields.getByName("template_uuid")) return { changed: 0, duplicatesFixed: 0 };

	const collectionName = templatesCollection.name || "ai_pin_templates";
	const records = findAllRecordsSafe(app, collectionName);
	if (!Array.isArray(records) || !records.length) return { changed: 0, duplicatesFixed: 0 };

	// Group by current template_uuid (empty treated as empty string).
	const groups = {};
	for (const record of records) {
		const key = recordString(record, "template_uuid"); // '' allowed
		if (!groups[key]) groups[key] = [];
		groups[key].push(record);
	}

	let changed = 0;
	let duplicatesFixed = 0;

	// 1) Fix empty template_uuid: regenerate for *all* empty-string records.
	const emptyGroup = groups[""] || [];
	for (const record of emptyGroup) {
		const newUuid = deterministicUuidV4FromString(`${collectionName}:${record.id || ""}:template_uuid:empty`);
		record.set("template_uuid", newUuid);
		changed += 1;
	}
	delete groups[""];

	// 2) Fix duplicates for non-empty template_uuid.
	for (const key of Object.keys(groups)) {
		const group = groups[key];
		if (!Array.isArray(group) || group.length < 2) continue;

		// Sort newest-first for keeper selection.
		group.sort((a, b) => {
			const ta = recordTimestampMs(a);
			const tb = recordTimestampMs(b);
			if (tb !== ta) return tb - ta;
			return String(b.id || "").localeCompare(String(a.id || ""));
		});

		// Keep group[0] as-is; regenerate others deterministically.
		for (let i = 1; i < group.length; i += 1) {
			const record = group[i];
			const newUuid = deterministicUuidV4FromString(`${collectionName}:${record.id || ""}:template_uuid:dup`);
			record.set("template_uuid", newUuid);
			duplicatesFixed += 1;
			changed += 1;

			// Bump revision to reflect an identity change.
			try {
				const current = Number(record.get("revision") || 0);
				record.set("revision", Number.isFinite(current) && current >= 1 ? current + 1 : 1);
			} catch {
				// ignore revision bump if field isn't writable
			}
		}
	}

	// Save updates (if any).
	if (changed === 0) return { changed: 0, duplicatesFixed };

	for (const record of records) {
		if (recordString(record, "template_uuid") === "") continue;
		if (typeof app.saveNoValidate === "function") {
			app.saveNoValidate(record);
		} else {
			app.save(record);
		}
	}

	return { changed, duplicatesFixed };
}

migrate(
	(app) => {
		const templates = findCollectionSafe(app, "ai_pin_templates");
		if (!templates) return;

		const uniqueMarker = "idx_ai_pin_templates_template_uuid";

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

		const existingIndexes = Array.isArray(templates.indexes) ? templates.indexes.slice() : [];
		const hasUnique = existingIndexes.some((sql) => String(sql).includes(uniqueMarker));

		const indexesToSave = hasUnique
			? existingIndexes
			: existingIndexes.filter((sql) => !String(sql).includes(uniqueMarker));

		for (const sql of NON_UNIQUE_INDEX_SQL) {
			if (!indexesToSave.includes(sql)) {
				indexesToSave.push(sql);
				dirty = true;
			}
		}

		templates.indexes = indexesToSave;
		if (dirty) app.save(templates);

		// Crash case: duplicates exist and UNIQUE index isn't present yet.
		// Repair data first, then create UNIQUE index.
		if (!hasUnique) {
			dedupeTemplateUuidRecords(app, templates);

			const post = findCollectionSafe(app, "ai_pin_templates");
			const postIndexes = Array.isArray(post?.indexes) ? post.indexes.slice() : [];
			const postHasUnique = postIndexes.some((sql) => String(sql).includes(uniqueMarker));

			if (!postHasUnique) {
				post.indexes = postIndexes.concat([UNIQUE_TEMPLATE_UUID_INDEX_SQL]);
				app.save(post);
			}
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
