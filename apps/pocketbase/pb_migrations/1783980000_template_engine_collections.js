/// <reference path="../pb_data/types.d.ts" />
/**
 * Template Engine Module 1 — new normalized collections.
 * - ai_pin_template_versions
 * - ai_pin_template_assets
 * - ai_pin_template_favorites
 * - ai_pin_template_preview_cache
 *
 * Audit columns: created_by, workspace_id, deleted_at (+ PB autodate created/updated).
 * API-only rules (null); RBAC enforced in apps/api via workspace middleware.
 * Reversible: down deletes these collections.
 */

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

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

function saveSchemaCollection(app, collection) {
	collection.listRule = null;
	collection.viewRule = null;
	collection.createRule = null;
	collection.updateRule = null;
	collection.deleteRule = null;
	app.save(collection);
	return app.findCollectionByNameOrId(collection.id || collection.name);
}

function newBaseCollection(name, fields, indexes = []) {
	return new Collection({
		type: "base",
		name,
		listRule: null,
		viewRule: null,
		createRule: null,
		updateRule: null,
		deleteRule: null,
		indexes,
		fields: fields.concat(AUTODATE_FIELDS),
	});
}

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

function deleteCollectionSafe(app, name) {
	const collection = findCollectionSafe(app, name);
	if (collection) {
		app.delete(collection);
	}
}

/** Shared select values (mirrored in pin-engine constants; keep strings identical). */
const TEMPLATE_STATUS = ["draft", "published", "archived"];
const TEMPLATE_ASSET_SOURCES = ["upload", "ai", "logo", "sticker", "watermark"];
const RENDER_TARGETS = ["png", "jpg", "webp", "pdf", "mp4"];

function auditFields(usersId, workspacesId) {
	const fields = [
		relationField("created_by", usersId, { required: true, cascadeDelete: false }),
		{ type: "date", name: "deleted_at" },
	];
	if (workspacesId) {
		fields.unshift(relationField("workspace_id", workspacesId, { required: true, cascadeDelete: false }));
	} else {
		// Fallback when workspaces collection is missing (should not happen post-tenancy).
		fields.unshift({ type: "text", name: "workspace_id", required: true, max: 80 });
	}
	return fields;
}

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId("users");
		const workspaces = findCollectionSafe(app, "workspaces");
		const workspacesId = workspaces ? workspaces.id : null;
		const templates = findCollectionSafe(app, "ai_pin_templates");
		if (!templates) {
			throw new Error("Template Engine migration requires ai_pin_templates");
		}

		const audit = auditFields(users.id, workspacesId);

		if (!findCollectionSafe(app, "ai_pin_template_versions")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"ai_pin_template_versions",
					[
						...audit,
						relationField("template_id", templates.id, { required: true, cascadeDelete: true }),
						{ type: "number", name: "version", required: true, min: 1 },
						{ type: "text", name: "label", max: 200 },
						{
							type: "select",
							name: "status_snapshot",
							maxSelect: 1,
							values: TEMPLATE_STATUS,
						},
						{ type: "json", name: "configuration", required: true, maxSize: 300000 },
						{ type: "text", name: "thumbnail", max: 4000 },
						{ type: "text", name: "checksum", max: 128 },
						{ type: "number", name: "schema_version", min: 1 },
					],
					[
						"CREATE UNIQUE INDEX `idx_ai_pin_template_versions_template_version` ON `ai_pin_template_versions` (`template_id`, `version`)",
						"CREATE INDEX `idx_ai_pin_template_versions_workspace` ON `ai_pin_template_versions` (`workspace_id`)",
						"CREATE INDEX `idx_ai_pin_template_versions_workspace_template` ON `ai_pin_template_versions` (`workspace_id`, `template_id`)",
						"CREATE INDEX `idx_ai_pin_template_versions_workspace_updated` ON `ai_pin_template_versions` (`workspace_id`, `updated`)",
						"CREATE INDEX `idx_ai_pin_template_versions_created_by` ON `ai_pin_template_versions` (`created_by`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "ai_pin_template_assets")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"ai_pin_template_assets",
					[
						...audit,
						{ type: "text", name: "name", required: true, max: 255 },
						{ type: "text", name: "original_name", max: 255 },
						{ type: "text", name: "mime_type", max: 120 },
						{ type: "number", name: "size_bytes", min: 0 },
						{
							type: "select",
							name: "source",
							maxSelect: 1,
							values: TEMPLATE_ASSET_SOURCES,
						},
						{
							type: "file",
							name: "file",
							required: true,
							maxSelect: 1,
							maxSize: 20971520,
							mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
						},
						{ type: "number", name: "width", min: 0 },
						{ type: "number", name: "height", min: 0 },
					],
					[
						"CREATE INDEX `idx_ai_pin_template_assets_workspace` ON `ai_pin_template_assets` (`workspace_id`)",
						"CREATE INDEX `idx_ai_pin_template_assets_workspace_updated` ON `ai_pin_template_assets` (`workspace_id`, `updated`)",
						"CREATE INDEX `idx_ai_pin_template_assets_workspace_source` ON `ai_pin_template_assets` (`workspace_id`, `source`)",
						"CREATE INDEX `idx_ai_pin_template_assets_created_by` ON `ai_pin_template_assets` (`created_by`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "ai_pin_template_favorites")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"ai_pin_template_favorites",
					[
						...audit,
						relationField("template_id", templates.id, { required: true, cascadeDelete: true }),
					],
					[
						"CREATE UNIQUE INDEX `idx_ai_pin_template_favorites_unique` ON `ai_pin_template_favorites` (`workspace_id`, `created_by`, `template_id`)",
						"CREATE INDEX `idx_ai_pin_template_favorites_workspace_user` ON `ai_pin_template_favorites` (`workspace_id`, `created_by`)",
						"CREATE INDEX `idx_ai_pin_template_favorites_template` ON `ai_pin_template_favorites` (`template_id`)",
						"CREATE INDEX `idx_ai_pin_template_favorites_workspace` ON `ai_pin_template_favorites` (`workspace_id`)",
					],
				),
			);
		}

		if (!findCollectionSafe(app, "ai_pin_template_preview_cache")) {
			saveSchemaCollection(
				app,
				newBaseCollection(
					"ai_pin_template_preview_cache",
					[
						...audit,
						relationField("template_id", templates.id, { required: true, cascadeDelete: true }),
						{ type: "text", name: "config_checksum", required: true, max: 128 },
						{
							type: "select",
							name: "format",
							maxSelect: 1,
							values: RENDER_TARGETS,
						},
						{ type: "text", name: "image_url", max: 4000 },
						{ type: "date", name: "expires_at" },
					],
					[
						"CREATE INDEX `idx_ai_pin_template_preview_cache_lookup` ON `ai_pin_template_preview_cache` (`template_id`, `config_checksum`, `format`)",
						"CREATE INDEX `idx_ai_pin_template_preview_cache_workspace_expires` ON `ai_pin_template_preview_cache` (`workspace_id`, `expires_at`)",
						"CREATE INDEX `idx_ai_pin_template_preview_cache_workspace` ON `ai_pin_template_preview_cache` (`workspace_id`)",
					],
				),
			);
		}
	},
	(app) => {
		deleteCollectionSafe(app, "ai_pin_template_preview_cache");
		deleteCollectionSafe(app, "ai_pin_template_favorites");
		deleteCollectionSafe(app, "ai_pin_template_assets");
		deleteCollectionSafe(app, "ai_pin_template_versions");
	},
);
