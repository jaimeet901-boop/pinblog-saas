/// <reference path="../pb_data/types.d.ts" />
/**
 * AI Pins Studio reference images — persisted file + metadata per owner.
 * API-only (rules null); managed via apps/api superuser client.
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

migrate(
	(app) => {
		if (findCollectionSafe(app, "ai_pin_reference_images")) {
			return;
		}

		const users = app.findCollectionByNameOrId("users");

		saveSchemaCollection(
			app,
			newBaseCollection(
				"ai_pin_reference_images",
				[
					relationField("owner", users.id, { required: true, cascadeDelete: true }),
					{ type: "text", name: "name", required: true, max: 255 },
					{ type: "text", name: "original_name", max: 255 },
					{ type: "text", name: "mime_type", max: 120 },
					{ type: "number", name: "size_bytes", min: 0 },
					{
						type: "file",
						name: "file",
						required: true,
						maxSelect: 1,
						maxSize: 20971520,
						mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
					},
				],
				[
					"CREATE INDEX `idx_ai_pin_reference_images_owner` ON `ai_pin_reference_images` (`owner`)",
					"CREATE INDEX `idx_ai_pin_reference_images_owner_created` ON `ai_pin_reference_images` (`owner`, `created`)",
				],
			),
		);
	},
	(app) => {
		const collection = findCollectionSafe(app, "ai_pin_reference_images");
		if (collection) {
			app.delete(collection);
		}
	},
);
