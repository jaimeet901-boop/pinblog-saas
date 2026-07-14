/// <reference path="../pb_data/types.d.ts" />

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId("users");
		const websites = app.findCollectionByNameOrId("websites");

		const ownerField = {
			name: "owner",
			type: "relation",
			required: true,
			maxSelect: 1,
			collectionId: users.id,
			cascadeDelete: true,
		};

		if (!websites.fields.getByName("last_scan_at")) {
			websites.fields.add(new DateField({ name: "last_scan_at" }));
		}

		if (!websites.fields.getByName("next_scan_at")) {
			websites.fields.add(new DateField({ name: "next_scan_at" }));
		}

		if (!websites.fields.getByName("last_scan_summary")) {
			websites.fields.add(new JSONField({ name: "last_scan_summary", maxSize: 200000 }));
		}

		app.save(websites);

		const websiteArticles = new Collection({
			type: "base",
			name: "website_articles",
			listRule: "@request.auth.id != '' && @request.auth.id = owner",
			viewRule: "@request.auth.id != '' && @request.auth.id = owner",
			createRule: "@request.auth.id != '' && @request.auth.id = owner",
			updateRule: "@request.auth.id != '' && @request.auth.id = owner",
			deleteRule: "@request.auth.id != '' && @request.auth.id = owner",
			indexes: [
				"CREATE UNIQUE INDEX `idx_website_articles_unique_url` ON `website_articles` (`websiteId`, `url`)",
				"CREATE INDEX `idx_website_articles_owner_website` ON `website_articles` (`owner`, `websiteId`)",
				"CREATE INDEX `idx_website_articles_status` ON `website_articles` (`status`)",
				"CREATE INDEX `idx_website_articles_published_at` ON `website_articles` (`publish_date`)",
			],
			fields: [
				{
					name: "websiteId",
					type: "relation",
					required: true,
					maxSelect: 1,
					collectionId: websites.id,
					cascadeDelete: true,
				},
				ownerField,
				{ name: "url", type: "text", required: true, max: 1000 },
				{ name: "slug", type: "text", max: 255 },
				{ name: "title", type: "text", max: 500 },
				{ name: "meta_description", type: "text", max: 2000 },
				{ name: "featured_image", type: "text", max: 1000 },
				{ name: "publish_date", type: "date" },
				{ name: "last_modified_date", type: "date" },
				{ name: "category", type: "text", max: 255 },
				{ name: "author", type: "text", max: 255 },
				{ name: "language", type: "text", max: 32 },
				{ name: "status", type: "select", required: true, maxSelect: 1, values: ["new", "imported", "published"] },
				{ name: "source", type: "text", max: 64 },
				{ name: "scan_run_id", type: "text", max: 64 },
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			],
		});

		app.save(websiteArticles);
	},
	(app) => {
		try {
			app.delete(app.findCollectionByNameOrId("website_articles"));
		} catch (_) {}

		const websites = app.findCollectionByNameOrId("websites");
		try { websites.fields.removeByName("last_scan_at"); } catch (_) {}
		try { websites.fields.removeByName("next_scan_at"); } catch (_) {}
		try { websites.fields.removeByName("last_scan_summary"); } catch (_) {}
		app.save(websites);
	},
);