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
		number: pickCtor(typeof NumberField !== "undefined" ? NumberField : null, coreNS.NumberField),
		relation: pickCtor(typeof RelationField !== "undefined" ? RelationField : null, coreNS.RelationField),
		select: pickCtor(typeof SelectField !== "undefined" ? SelectField : null, coreNS.SelectField),
		json: pickCtor(typeof JSONField !== "undefined" ? JSONField : null, coreNS.JSONField),
		bool: pickCtor(typeof BoolField !== "undefined" ? BoolField : null, coreNS.BoolField),
		file: pickCtor(typeof FileField !== "undefined" ? FileField : null, coreNS.FileField),
		autodate: pickCtor(typeof AutodateField !== "undefined" ? AutodateField : null, coreNS.AutodateField),
	};

	const Ctor = ctorByType[def.type];
	if (!Ctor) {
		throw new Error(`Unsupported migration field type: ${def.type}`);
	}
	return new Ctor(def);
}

function ensureField(collection, def) {
	if (!collection.fields.getByName(def.name)) {
		collection.fields.add(toField(def));
	}
}

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId("users");
		const websites = app.findCollectionByNameOrId("websites");
		const websiteArticles = app.findCollectionByNameOrId("website_articles");
		const aiPins = app.findCollectionByNameOrId("ai_pins");

		ensureField(aiPins, { name: "analysis", type: "json", maxSize: 100000 });
		ensureField(aiPins, { name: "cta", type: "text", max: 300 });
		ensureField(aiPins, { name: "pinterest_category", type: "text", max: 120 });
		ensureField(aiPins, { name: "style", type: "text", max: 64 });
		ensureField(aiPins, { name: "editor_state", type: "json", maxSize: 200000 });
		ensureField(aiPins, { name: "ai_credits_used", type: "number", min: 0 });
		ensureField(aiPins, { name: "image_credits_used", type: "number", min: 0 });
		app.save(aiPins);

		ensureField(users, { name: "ai_credits_used", type: "number", min: 0 });
		ensureField(users, { name: "image_credits_used", type: "number", min: 0 });
		app.save(users);

		const ownerRules = {
			listRule: "@request.auth.id != '' && owner = @request.auth.id",
			viewRule: "@request.auth.id != '' && owner = @request.auth.id",
			createRule: "@request.auth.id != '' && owner = @request.auth.id",
			updateRule: "@request.auth.id != '' && owner = @request.auth.id",
			deleteRule: "@request.auth.id != '' && owner = @request.auth.id",
		};

		let brandKits;
		try {
			brandKits = app.findCollectionByNameOrId("brand_kits");
		} catch (_) {
			brandKits = new Collection({
				type: "base",
				name: "brand_kits",
				indexes: [
					"CREATE INDEX `idx_brand_kits_owner` ON `brand_kits` (`owner`)",
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
					{ name: "name", type: "text", required: true, max: 120 },
					{ name: "logo_url", type: "text", max: 1000 },
					{ name: "primary_color", type: "text", max: 32 },
					{ name: "secondary_color", type: "text", max: 32 },
					{ name: "accent_color", type: "text", max: 32 },
					{ name: "font_heading", type: "text", max: 120 },
					{ name: "font_body", type: "text", max: 120 },
					{ name: "watermark_text", type: "text", max: 120 },
					{ name: "watermark_url", type: "text", max: 1000 },
					{ name: "website_url", type: "text", max: 500 },
					{ name: "is_default", type: "bool" },
					{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
					{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
				].map(toField),
			});
			app.save(brandKits);
			brandKits = app.findCollectionByNameOrId("brand_kits");
			brandKits.listRule = ownerRules.listRule;
			brandKits.viewRule = ownerRules.viewRule;
			brandKits.createRule = ownerRules.createRule;
			brandKits.updateRule = ownerRules.updateRule;
			brandKits.deleteRule = ownerRules.deleteRule;
			app.save(brandKits);
		}

		ensureField(aiPins, {
			name: "brand_kit",
			type: "relation",
			required: false,
			maxSelect: 1,
			collectionId: brandKits.id,
			cascadeDelete: false,
		});
		app.save(aiPins);

		let history;
		try {
			history = app.findCollectionByNameOrId("ai_pin_generation_history");
		} catch (_) {
			history = new Collection({
				type: "base",
				name: "ai_pin_generation_history",
				indexes: [
					"CREATE INDEX `idx_ai_pin_history_owner` ON `ai_pin_generation_history` (`owner`)",
					"CREATE INDEX `idx_ai_pin_history_pin` ON `ai_pin_generation_history` (`ai_pin`)",
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
					{
						name: "ai_pin",
						type: "relation",
						required: false,
						maxSelect: 1,
						collectionId: aiPins.id,
						cascadeDelete: false,
					},
					{
						name: "articleId",
						type: "relation",
						required: false,
						maxSelect: 1,
						collectionId: websiteArticles.id,
						cascadeDelete: false,
					},
					{
						name: "websiteId",
						type: "relation",
						required: false,
						maxSelect: 1,
						collectionId: websites.id,
						cascadeDelete: false,
					},
					{ name: "event_type", type: "select", required: true, maxSelect: 1, values: ["analyze", "prompt", "image", "save", "edit", "bulk"] },
					{ name: "prompt", type: "text", max: 8000 },
					{ name: "image_url", type: "text", max: 1000 },
					{ name: "analysis", type: "json", maxSize: 100000 },
					{ name: "metadata", type: "json", maxSize: 100000 },
					{ name: "ai_credits_used", type: "number", min: 0 },
					{ name: "image_credits_used", type: "number", min: 0 },
					{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
					{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
				].map(toField),
			});
			app.save(history);
			history = app.findCollectionByNameOrId("ai_pin_generation_history");
			history.listRule = ownerRules.listRule;
			history.viewRule = ownerRules.viewRule;
			history.createRule = ownerRules.createRule;
			history.updateRule = ownerRules.updateRule;
			history.deleteRule = ownerRules.deleteRule;
			app.save(history);
		}
	},
	(app) => {
		try { app.delete(app.findCollectionByNameOrId("ai_pin_generation_history")); } catch (_) {}
		try { app.delete(app.findCollectionByNameOrId("brand_kits")); } catch (_) {}
		const aiPins = app.findCollectionByNameOrId("ai_pins");
		["analysis", "cta", "pinterest_category", "style", "editor_state", "ai_credits_used", "image_credits_used", "brand_kit"].forEach((name) => {
			try { aiPins.fields.removeByName(name); } catch (_) {}
		});
		app.save(aiPins);
		const users = app.findCollectionByNameOrId("users");
		try { users.fields.removeByName("ai_credits_used"); } catch (_) {}
		try { users.fields.removeByName("image_credits_used"); } catch (_) {}
		app.save(users);
	},
);
