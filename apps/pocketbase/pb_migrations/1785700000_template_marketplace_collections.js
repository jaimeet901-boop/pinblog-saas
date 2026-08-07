/// <reference path="../pb_data/types.d.ts" />
/**
 * Phase 2 — Marketplace Collections (Admin CMS taxonomy).
 * - template_collections: channel-scoped browse groups
 * - template_collection_members: many-to-many template membership + ordering
 *
 * API-only rules (null); RBAC enforced in apps/api admin routes.
 * Phase 1 gallery isolation is unchanged — collection filter is optional on gallery API.
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

function saveSchemaCollection(app, collection) {
	collection.listRule = null;
	collection.viewRule = null;
	collection.createRule = null;
	collection.updateRule = null;
	collection.deleteRule = null;
	app.save(collection);
	return app.findCollectionByNameOrId(collection.id || collection.name);
}

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

const TEMPLATE_CHANNELS = ["pinterest", "facebook", "instagram", "linkedin", "twitter"];
const LIBRARY_SCOPES = ["official", "premium", "community", "all"];
const COLLECTION_STATUS = ["draft", "published", "archived"];

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId("users");
		const templates = findCollectionSafe(app, "ai_pin_templates");
		if (!templates) {
			throw new Error("template_marketplace_collections requires ai_pin_templates");
		}

		let collectionsCol = findCollectionSafe(app, "template_collections");
		if (!collectionsCol) {
			collectionsCol = saveSchemaCollection(
				app,
				new Collection({
					type: "base",
					name: "template_collections",
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					indexes: [
						"CREATE UNIQUE INDEX `idx_template_collections_channel_slug` ON `template_collections` (`channel`, `slug`)",
						"CREATE INDEX `idx_template_collections_channel_status_sort` ON `template_collections` (`channel`, `status`, `sort_order`)",
					],
					fields: [
						{ type: "text", name: "slug", required: true, max: 120 },
						{ type: "text", name: "name", required: true, max: 200 },
						{
							type: "select",
							name: "channel",
							required: true,
							maxSelect: 1,
							values: TEMPLATE_CHANNELS,
						},
						{
							type: "select",
							name: "library_scope",
							required: true,
							maxSelect: 1,
							values: LIBRARY_SCOPES,
						},
						{ type: "text", name: "description", max: 2000 },
						{ type: "text", name: "cover_image_url", max: 4000 },
						{ type: "number", name: "sort_order", min: 0 },
						{
							type: "select",
							name: "status",
							required: true,
							maxSelect: 1,
							values: COLLECTION_STATUS,
						},
						relationField("created_by", users.id, { required: true }),
						relationField("updated_by", users.id),
					].concat(AUTODATE_FIELDS),
				}),
			);
		}

		if (!findCollectionSafe(app, "template_collection_members")) {
			saveSchemaCollection(
				app,
				new Collection({
					type: "base",
					name: "template_collection_members",
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					indexes: [
						"CREATE UNIQUE INDEX `idx_template_collection_members_unique` ON `template_collection_members` (`collection_id`, `template_id`)",
						"CREATE INDEX `idx_template_collection_members_template` ON `template_collection_members` (`template_id`)",
						"CREATE INDEX `idx_template_collection_members_collection_sort` ON `template_collection_members` (`collection_id`, `sort_order`)",
					],
					fields: [
						relationField("collection_id", collectionsCol.id, { required: true, cascadeDelete: true }),
						relationField("template_id", templates.id, { required: true, cascadeDelete: true }),
						{ type: "number", name: "sort_order", min: 0 },
						{ type: "bool", name: "featured" },
						relationField("created_by", users.id, { required: true }),
					].concat(AUTODATE_FIELDS),
				}),
			);
		}
	},
	(app) => {
		deleteCollectionSafe(app, "template_collection_members");
		deleteCollectionSafe(app, "template_collections");
	},
);

function deleteCollectionSafe(app, name) {
	const collection = findCollectionSafe(app, name);
	if (collection) {
		app.delete(collection);
	}
}
