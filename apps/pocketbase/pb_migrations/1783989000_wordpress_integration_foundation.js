/// <reference path="../pb_data/types.d.ts" />
/**
 * WordPress Integration Foundation (Chef IA):
 * - Richer wordpress_sites profile / discovery / sync fields
 * - Expanded website_articles fields for WP post sync
 * - wordpress_sync_runs audit trail
 *
 * Additive + idempotent. Does not remove existing fields or change API rules.
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
		url: pickCtor(typeof URLField !== "undefined" ? URLField : null, coreNS.URLField),
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
	if (!collection.fields.getByName(def.name)) {
		collection.fields.add(toField(def));
		return true;
	}
	return false;
}

function ensureIndex(collection, sql) {
	const indexes = Array.isArray(collection.indexes) ? collection.indexes.slice() : [];
	if (indexes.includes(sql)) return false;
	indexes.push(sql);
	collection.indexes = indexes;
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

migrate(
	(app) => {
		const sites = findCollectionSafe(app, "wordpress_sites");
		if (sites) {
			let dirty = false;
			dirty = ensureField(sites, { type: "json", name: "site_profile", maxSize: 500000 }) || dirty;
			dirty = ensureField(sites, { type: "json", name: "discovery", maxSize: 2000000 }) || dirty;
			dirty = ensureField(sites, { type: "text", name: "language", max: 32 }) || dirty;
			dirty = ensureField(sites, { type: "text", name: "timezone", max: 120 }) || dirty;
			dirty = ensureField(sites, { type: "text", name: "permalink_structure", max: 255 }) || dirty;
			dirty = ensureField(sites, { type: "bool", name: "https_validated" }) || dirty;
			dirty = ensureField(sites, { type: "date", name: "last_discovered_at" }) || dirty;
			dirty = ensureField(sites, { type: "date", name: "last_synced_at" }) || dirty;
			dirty = ensureField(sites, { type: "date", name: "next_sync_at" }) || dirty;
			dirty = ensureField(sites, { type: "json", name: "sync_cursor", maxSize: 100000 }) || dirty;
			dirty = ensureField(sites, {
				type: "select",
				name: "sync_status",
				maxSelect: 1,
				values: ["idle", "running", "success", "failed", "partial"],
			}) || dirty;
			dirty = ensureField(sites, { type: "text", name: "last_sync_error", max: 3000 }) || dirty;
			if (dirty) app.save(sites);
		}

		const articles = findCollectionSafe(app, "website_articles");
		if (articles) {
			let dirty = false;
			dirty = ensureField(articles, { type: "number", name: "wp_post_id", min: 0 }) || dirty;
			dirty = ensureField(articles, { type: "text", name: "excerpt", max: 5000 }) || dirty;
			dirty = ensureField(articles, { type: "text", name: "content", max: 0 }) || dirty;
			dirty = ensureField(articles, { type: "json", name: "categories", maxSize: 100000 }) || dirty;
			dirty = ensureField(articles, { type: "json", name: "tags", maxSize: 100000 }) || dirty;
			dirty = ensureField(articles, { type: "text", name: "seo_title", max: 500 }) || dirty;
			dirty = ensureField(articles, { type: "text", name: "seo_description", max: 2000 }) || dirty;
			dirty = ensureField(articles, { type: "number", name: "reading_time", min: 0 }) || dirty;
			dirty = ensureField(articles, { type: "number", name: "word_count", min: 0 }) || dirty;
			dirty = ensureField(articles, { type: "url", name: "canonical_url" }) || dirty;
			dirty = ensureField(articles, { type: "bool", name: "featured" }) || dirty;
			dirty = ensureField(articles, { type: "text", name: "wp_status", max: 40 }) || dirty;
			dirty = ensureField(articles, { type: "text", name: "sync_hash", max: 128 }) || dirty;
			dirty = ensureField(articles, { type: "date", name: "deleted_at" }) || dirty;
			dirty = ensureField(articles, { type: "text", name: "author_id", max: 80 }) || dirty;
			dirty = ensureIndex(
				articles,
				"CREATE INDEX `idx_website_articles_wp_post` ON `website_articles` (`websiteId`, `wp_post_id`)",
			) || dirty;
			dirty = ensureIndex(
				articles,
				"CREATE INDEX `idx_website_articles_sync_hash` ON `website_articles` (`websiteId`, `sync_hash`)",
			) || dirty;
			if (dirty) app.save(articles);
		}

		if (!findCollectionSafe(app, "wordpress_sync_runs")) {
			const users = findCollectionSafe(app, "users");
			const wpSites = findCollectionSafe(app, "wordpress_sites");
			const websites = findCollectionSafe(app, "websites");
			const fields = [];
			if (users) fields.push(relationField("owner", users.id, { required: true, cascadeDelete: true }));
			else fields.push({ type: "text", name: "owner", max: 80, required: true });
			if (wpSites) fields.push(relationField("site", wpSites.id, { cascadeDelete: true }));
			else fields.push({ type: "text", name: "site_id", max: 80 });
			if (websites) fields.push(relationField("website", websites.id, { cascadeDelete: false }));
			else fields.push({ type: "text", name: "website_id", max: 80 });
			fields.push(
				{
					type: "select",
					name: "mode",
					maxSelect: 1,
					values: ["full", "incremental", "manual", "scheduled"],
				},
				{
					type: "select",
					name: "status",
					maxSelect: 1,
					values: ["running", "success", "failed", "partial"],
				},
				{ type: "date", name: "started_at" },
				{ type: "date", name: "finished_at" },
				{ type: "number", name: "fetched", min: 0 },
				{ type: "number", name: "created", min: 0 },
				{ type: "number", name: "updated", min: 0 },
				{ type: "number", name: "deleted", min: 0 },
				{ type: "number", name: "unchanged", min: 0 },
				{ type: "text", name: "error", max: 4000 },
				{ type: "json", name: "summary", maxSize: 500000 },
				{ type: "autodate", name: "created", onCreate: true, onUpdate: false },
				{ type: "autodate", name: "updated", onCreate: true, onUpdate: true },
			);

			const collection = new Collection({
				type: "base",
				name: "wordpress_sync_runs",
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: [
					"CREATE INDEX `idx_wordpress_sync_runs_owner` ON `wordpress_sync_runs` (`owner`)",
					"CREATE INDEX `idx_wordpress_sync_runs_site` ON `wordpress_sync_runs` (`site`)",
					"CREATE INDEX `idx_wordpress_sync_runs_started` ON `wordpress_sync_runs` (`started_at`)",
				],
				fields,
			});
			app.save(collection);
		}
	},
	(app) => {
		// Non-destructive down: keep data; only drop sync runs if present.
		const runs = findCollectionSafe(app, "wordpress_sync_runs");
		if (runs) {
			app.delete(runs);
		}
	},
);
