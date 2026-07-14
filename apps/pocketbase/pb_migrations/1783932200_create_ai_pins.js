/// <reference path="../pb_data/types.d.ts" />

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId("users");
		const websites = app.findCollectionByNameOrId("websites");
		const websiteArticles = app.findCollectionByNameOrId("website_articles");

		const aiPins = new Collection({
			type: "base",
			name: "ai_pins",
			listRule: "@request.auth.id != '' && owner = @request.auth.id",
			viewRule: "@request.auth.id != '' && owner = @request.auth.id",
			createRule: "@request.auth.id != '' && owner = @request.auth.id",
			updateRule: "@request.auth.id != '' && owner = @request.auth.id",
			deleteRule: "@request.auth.id != '' && owner = @request.auth.id",
			indexes: [
				"CREATE INDEX `idx_ai_pins_owner` ON `ai_pins` (`owner`)",
				"CREATE INDEX `idx_ai_pins_website` ON `ai_pins` (`websiteId`)",
				"CREATE INDEX `idx_ai_pins_article` ON `ai_pins` (`articleId`)",
				"CREATE INDEX `idx_ai_pins_status` ON `ai_pins` (`status`)",
			],
			fields: [
				{
					name: "articleId",
					type: "relation",
					required: true,
					maxSelect: 1,
					collectionId: websiteArticles.id,
					cascadeDelete: true,
				},
				{
					name: "websiteId",
					type: "relation",
					required: true,
					maxSelect: 1,
					collectionId: websites.id,
					cascadeDelete: true,
				},
				{
					name: "owner",
					type: "relation",
					required: true,
					maxSelect: 1,
					collectionId: users.id,
					cascadeDelete: true,
				},
				{ name: "image_prompt", type: "text", max: 4000 },
				{ name: "overlay_text", type: "text", max: 600 },
				{ name: "title", type: "text", required: true, max: 300 },
				{ name: "description", type: "text", max: 2000 },
				{ name: "suggested_keywords", type: "json", maxSize: 10000 },
				{ name: "suggested_hashtags", type: "json", maxSize: 10000 },
				{ name: "target_audience", type: "text", max: 200 },
				{ name: "tone_of_voice", type: "text", max: 100 },
				{ name: "language", type: "text", max: 60 },
				{ name: "status", type: "select", required: true, maxSelect: 1, values: ["draft"] },
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			],
		});

		app.save(aiPins);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId("ai_pins");
		app.delete(collection);
	},
);