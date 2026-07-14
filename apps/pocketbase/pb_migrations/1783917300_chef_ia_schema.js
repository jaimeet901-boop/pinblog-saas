/// <reference path="../pb_data/types.d.ts" />

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

		// Websites
		const websites = new Collection({
			type: "base",
			name: "websites",
			...ownerRules,
			fields: [
				{ name: "name", type: "text", required: true, max: 120 },
				{ name: "url", type: "url" },
				{ name: "wp_username", type: "text", max: 120 },
				{ name: "wp_app_password", type: "text", max: 200 },
				{ name: "status", type: "select", maxSelect: 1, values: ["untested", "connected", "failed"] },
				ownerField(),
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			],
		});
		app.save(websites);

		// Articles
		const articles = new Collection({
			type: "base",
			name: "articles",
			...ownerRules,
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
			],
		});
		app.save(articles);

		// Pins (Pinterest images / scheduled pins)
		const pins = new Collection({
			type: "base",
			name: "pins",
			...ownerRules,
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
			],
		});
		app.save(pins);

		// Per-user settings (API keys, integrations)
		const settings = new Collection({
			type: "base",
			name: "user_settings",
			...ownerRules,
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
			],
		});
		app.save(settings);
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
