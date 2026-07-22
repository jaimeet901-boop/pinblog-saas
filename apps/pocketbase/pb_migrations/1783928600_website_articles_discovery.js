/// <reference path="../pb_data/types.d.ts" />

const coreNS = typeof core !== "undefined" ? core : {};

function pickCtor(...ctors) {
	for (const ctor of ctors) {
		if (typeof ctor === "function") {
			return ctor;
		}
	}

	return null;
}

function toField(def) {
	if (!def || typeof def !== "object" || typeof def.type !== "string") {
		return def;
	}

	const ctorByType = {
		text: pickCtor(typeof TextField !== "undefined" ? TextField : null, coreNS.TextField),
		relation: pickCtor(typeof RelationField !== "undefined" ? RelationField : null, coreNS.RelationField),
		select: pickCtor(typeof SelectField !== "undefined" ? SelectField : null, coreNS.SelectField),
		date: pickCtor(typeof DateField !== "undefined" ? DateField : null, coreNS.DateField),
		autodate: pickCtor(typeof AutodateField !== "undefined" ? AutodateField : null, coreNS.AutodateField),
	};

	const Ctor = ctorByType[def.type];
	if (!Ctor) {
		throw new Error(`Unsupported migration field type: ${def.type}`);
	}

	return new Ctor(def);
}

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

		const ownerRules = {
			listRule: "@request.auth.id != '' && owner = @request.auth.id",
			viewRule: "@request.auth.id != '' && owner = @request.auth.id",
			createRule: "@request.auth.id != '' && owner = @request.auth.id",
			updateRule: "@request.auth.id != '' && owner = @request.auth.id",
			deleteRule: "@request.auth.id != '' && owner = @request.auth.id",
		};

		function saveCollectionThenApplyOwnerRules(app, collection, ownerRules) {
			app.save(collection); // persist fields including owner
			let persisted = app.findCollectionByNameOrId(collection.id || collection.name);
			if (!persisted.fields.getByName("owner")) {
				throw new Error(`Collection ${persisted.name} is missing required owner field after save`);
			}
			persisted.listRule = ownerRules.listRule;
			persisted.viewRule = ownerRules.viewRule;
			persisted.createRule = ownerRules.createRule;
			persisted.updateRule = ownerRules.updateRule;
			persisted.deleteRule = ownerRules.deleteRule;
			app.save(persisted);
			return app.findCollectionByNameOrId(persisted.id || persisted.name);
		}

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
			].map(toField),
		});

		saveCollectionThenApplyOwnerRules(app, websiteArticles, ownerRules);
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