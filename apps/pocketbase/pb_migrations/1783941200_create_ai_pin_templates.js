/// <reference path="../pb_data/types.d.ts" />

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId("users");

		const templates = new Collection({
			type: "base",
			name: "ai_pin_templates",
			listRule: "@request.auth.id != '' && owner = @request.auth.id",
			viewRule: "@request.auth.id != '' && owner = @request.auth.id",
			createRule: "@request.auth.id != '' && owner = @request.auth.id",
			updateRule: "@request.auth.id != '' && owner = @request.auth.id",
			deleteRule: "@request.auth.id != '' && owner = @request.auth.id",
			indexes: [
				"CREATE INDEX `idx_ai_pin_templates_owner` ON `ai_pin_templates` (`owner`)",
				"CREATE INDEX `idx_ai_pin_templates_owner_default` ON `ai_pin_templates` (`owner`, `is_default`)",
			],
			fields: [
				{
					name: "owner",
					type: "relation",
					required: true,
					maxSelect: 1,
					collectionId: users.id,
					cascadeDelete: true,
				},
				{ name: "name", type: "text", required: true, max: 180 },
				{ name: "thumbnail", type: "text", max: 4000 },
				{ name: "configuration", type: "json", required: true, maxSize: 300000 },
				{ name: "is_default", type: "bool" },
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			],
		});

		app.save(templates);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId("ai_pin_templates");
		app.delete(collection);
	},
);
