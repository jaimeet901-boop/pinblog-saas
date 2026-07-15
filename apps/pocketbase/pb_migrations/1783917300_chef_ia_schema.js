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
		url: pickCtor(typeof URLField !== "undefined" ? URLField : null, typeof UrlField !== "undefined" ? UrlField : null, coreNS.URLField, coreNS.UrlField),
		relation: pickCtor(typeof RelationField !== "undefined" ? RelationField : null, coreNS.RelationField),
		select: pickCtor(typeof SelectField !== "undefined" ? SelectField : null, coreNS.SelectField),
		json: pickCtor(typeof JSONField !== "undefined" ? JSONField : null, coreNS.JSONField),
		date: pickCtor(typeof DateField !== "undefined" ? DateField : null, coreNS.DateField),
		bool: pickCtor(typeof BoolField !== "undefined" ? BoolField : null, coreNS.BoolField),
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

		// Extend users with plan + role
		if (!users.fields.getByName("plan")) {
			users.fields.add(
				new SelectField({
					name: "plan",
					maxSelect: 1,
					values: ["free", "starter", "pro", "agency"],
				}),
			);
		}
		if (!users.fields.getByName("role")) {
			users.fields.add(
				new SelectField({
					name: "role",
					maxSelect: 1,
					values: ["member", "admin"],
				}),
			);
		}
		app.save(users);

		const ownerField = () => ({
			name: "owner",
			type: "relation",
			required: true,
			maxSelect: 1,
			collectionId: users.id,
			cascadeDelete: true,
		});

		const ownerRules = {
			listRule: "@request.auth.id != '' && @request.auth.id = owner",
			viewRule: "@request.auth.id != '' && @request.auth.id = owner",
			createRule: "@request.auth.id != ''",
			updateRule: "@request.auth.id != '' && @request.auth.id = owner",
			deleteRule: "@request.auth.id != '' && @request.auth.id = owner",
		};

		const applyOwnerRules = (collection) => {
			collection.listRule = ownerRules.listRule;
			collection.viewRule = ownerRules.viewRule;
			collection.createRule = ownerRules.createRule;
			collection.updateRule = ownerRules.updateRule;
			collection.deleteRule = ownerRules.deleteRule;
			app.save(collection);
		};

		// Websites
		const websites = new Collection({
			type: "base",
			name: "websites",
			fields: [
				{ name: "name", type: "text", required: true, max: 120 },
				{ name: "url", type: "url" },
				{ name: "wp_username", type: "text", max: 120 },
				{ name: "wp_app_password", type: "text", max: 200 },
				{ name: "status", type: "select", maxSelect: 1, values: ["untested", "connected", "failed"] },
				ownerField(),
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			].map(toField),
		});
		app.save(websites);
		applyOwnerRules(websites);

		// Articles
		const articles = new Collection({
			type: "base",
			name: "articles",
			fields: [
				{ name: "keyword", type: "text", max: 200 },
				{ name: "seo_title", type: "text", max: 200 },
				{ name: "meta_description", type: "text", max: 400 },
				{ name: "slug", type: "text", max: 200 },
				{ name: "language", type: "text", max: 40 },
				{ name: "country", type: "text", max: 60 },
				{ name: "tone", type: "text", max: 60 },
				{ name: "body", type: "json", maxSize: 2000000 },
				{ name: "status", type: "select", maxSelect: 1, values: ["draft", "scheduled", "published"] },
				{ name: "scheduled_at", type: "date" },
				ownerField(),
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			].map(toField),
		});
		app.save(articles);
		applyOwnerRules(articles);

		// Pins (Pinterest images / scheduled pins)
		const pins = new Collection({
			type: "base",
			name: "pins",
			fields: [
				{ name: "title", type: "text", max: 200 },
				{ name: "image_url", type: "text", max: 500 },
				{ name: "board", type: "text", max: 120 },
				{ name: "format", type: "select", maxSelect: 1, values: ["square", "portrait", "landscape"] },
				{ name: "status", type: "select", maxSelect: 1, values: ["draft", "scheduled", "published"] },
				{ name: "scheduled_at", type: "date" },
				ownerField(),
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			].map(toField),
		});
		app.save(pins);
		applyOwnerRules(pins);

		// Per-user settings (API keys, integrations)
		const settings = new Collection({
			type: "base",
			name: "user_settings",
			fields: [
				{ name: "openai_key", type: "text", max: 300 },
				{ name: "gemini_key", type: "text", max: 300 },
				{ name: "fal_key", type: "text", max: 300 },
				{ name: "pinterest_token", type: "text", max: 500 },
				{ name: "pinterest_connected", type: "bool" },
				{ name: "email_from", type: "text", max: 200 },
				ownerField(),
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			].map(toField),
		});
		app.save(settings);
		applyOwnerRules(settings);
	},
	(app) => {
		for (const name of ["user_settings", "pins", "articles", "websites"]) {
			try {
				app.delete(app.findCollectionByNameOrId(name));
			} catch (_) {
				// ignore
			}
		}
	},
);
