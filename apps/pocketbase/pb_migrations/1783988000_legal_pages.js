/// <reference path="../pb_data/types.d.ts" />
/**
 * Legal Pages CMS — API-only collections for Admin Console site management.
 * legal_pages: published/draft legal documents
 * legal_page_versions: immutable snapshots for restore
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

function relationField(name, collectionId, options) {
	options = options || {};
	return {
		name: name,
		type: "relation",
		required: options.required === true,
		maxSelect: options.maxSelect != null ? options.maxSelect : 1,
		collectionId: collectionId,
		cascadeDelete: options.cascadeDelete === true,
	};
}

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

const SLUGS = ["privacy", "terms", "cookies", "disclaimer", "refund"];

migrate(
	(app) => {
		if (!findCollectionSafe(app, "legal_pages")) {
			const fields = [
				{
					type: "select",
					name: "slug",
					required: true,
					maxSelect: 1,
					values: SLUGS,
				},
				{ type: "text", name: "title", required: true, max: 300 },
				{ type: "text", name: "seo_title", max: 300 },
				{ type: "text", name: "meta_description", max: 600 },
				{ type: "text", name: "content", required: true, max: 200000 },
				{
					type: "select",
					name: "status",
					required: true,
					maxSelect: 1,
					values: ["draft", "published"],
				},
				{ type: "number", name: "version", required: true, min: 1 },
				{ type: "text", name: "updated_by", max: 200 },
			].concat(AUTODATE_FIELDS).map(toField);

			const collection = new Collection({
				type: "base",
				name: "legal_pages",
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: [
					"CREATE UNIQUE INDEX `idx_legal_pages_slug` ON `legal_pages` (`slug`)",
					"CREATE INDEX `idx_legal_pages_status` ON `legal_pages` (`status`)",
				],
				fields: fields,
			});
			app.save(collection);
		}

		const pages = findCollectionSafe(app, "legal_pages");
		if (pages && !findCollectionSafe(app, "legal_page_versions")) {
			const fields = [
				relationField("page", pages.id, { required: true, cascadeDelete: true }),
				{
					type: "select",
					name: "slug",
					required: true,
					maxSelect: 1,
					values: SLUGS,
				},
				{ type: "number", name: "version", required: true, min: 1 },
				{ type: "text", name: "title", required: true, max: 300 },
				{ type: "text", name: "seo_title", max: 300 },
				{ type: "text", name: "meta_description", max: 600 },
				{ type: "text", name: "content", required: true, max: 200000 },
				{
					type: "select",
					name: "status",
					required: true,
					maxSelect: 1,
					values: ["draft", "published"],
				},
				{ type: "text", name: "updated_by", max: 200 },
				{ type: "date", name: "snapshot_at" },
			].concat(AUTODATE_FIELDS).map(toField);

			const collection = new Collection({
				type: "base",
				name: "legal_page_versions",
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: [
					"CREATE INDEX `idx_legal_page_versions_page` ON `legal_page_versions` (`page`)",
					"CREATE UNIQUE INDEX `idx_legal_page_versions_slug_ver` ON `legal_page_versions` (`slug`, `version`)",
				],
				fields: fields,
			});
			app.save(collection);
		}
	},
	(app) => {
		for (const name of ["legal_page_versions", "legal_pages"]) {
			const collection = findCollectionSafe(app, name);
			if (collection) {
				app.delete(collection);
			}
		}
	},
);
