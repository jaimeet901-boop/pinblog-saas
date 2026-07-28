/// <reference path="../pb_data/types.d.ts" />
/**
 * Phase 3 — Backfill blank ai_pin_templates.visibility
 *
 * Phase 2 gallery/API treat blank visibility as legacy private (not global).
 * Official seed writes visibility = "official". Older rows may still have "".
 *
 * Safe mapping:
 * - marketplace_meta.official === true OR marketplace_meta.library === chefia-pin-library-v1
 *   → visibility = "official"
 * - otherwise → visibility = "private"
 *
 * Does not change non-blank visibility values. Idempotent.
 */

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

function parseMeta(raw) {
	if (!raw) return {};
	if (typeof raw === "object" && !Array.isArray(raw)) return raw;
	if (typeof raw === "string") {
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
		} catch (_) {
			return {};
		}
	}
	return {};
}

function isOfficialMeta(meta) {
	if (!meta || typeof meta !== "object") return false;
	if (meta.official === true) return true;
	if (String(meta.library || "") === "chefia-pin-library-v1") return true;
	return false;
}

migrate(
	(app) => {
		const collection = findCollectionSafe(app, "ai_pin_templates");
		if (!collection) return;
		if (!collection.fields.getByName("visibility")) return;

		let records = [];
		try {
			records = app.findRecordsByFilter("ai_pin_templates", "", "-created", 0, 0) || [];
		} catch (_) {
			return;
		}

		for (const record of records) {
			const current = String(record.get("visibility") || "").trim();
			if (current) continue;

			const meta = parseMeta(record.get("marketplace_meta"));
			const next = isOfficialMeta(meta) ? "official" : "private";
			record.set("visibility", next);
			try {
				app.save(record);
			} catch (_) {
				try {
					app.saveNoValidate(record);
				} catch (__) {
					// Skip unsalvageable row; do not fail entire migration.
				}
			}
		}
	},
	(app) => {
		// Data backfill — no reverse (would reintroduce blank visibility ambiguity).
		void app;
	},
);
