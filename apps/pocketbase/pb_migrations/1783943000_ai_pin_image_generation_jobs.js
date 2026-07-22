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
		json: pickCtor(typeof JSONField !== "undefined" ? JSONField : null, coreNS.JSONField),
		date: pickCtor(typeof DateField !== "undefined" ? DateField : null, coreNS.DateField),
		number: pickCtor(typeof NumberField !== "undefined" ? NumberField : null, coreNS.NumberField),
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
		const aiPins = app.findCollectionByNameOrId("ai_pins");
		const websites = app.findCollectionByNameOrId("websites");
		const websiteArticles = app.findCollectionByNameOrId("website_articles");

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

		if (!aiPins.fields.getByName("image_source")) {
			aiPins.fields.add(toField({
				name: "image_source",
				type: "select",
				maxSelect: 1,
				values: ["featured", "ai_generated", "featured_fallback"],
			}));
		}
		if (!aiPins.fields.getByName("image_generation_status")) {
			aiPins.fields.add(toField({
				name: "image_generation_status",
				type: "select",
				maxSelect: 1,
				values: ["idle", "queued", "processing", "completed", "failed", "fallback"],
			}));
		}
		if (!aiPins.fields.getByName("image_generation_error")) {
			aiPins.fields.add(toField({ name: "image_generation_error", type: "text", max: 3000 }));
		}
		if (!aiPins.fields.getByName("image_job_id")) {
			aiPins.fields.add(toField({ name: "image_job_id", type: "text", max: 120 }));
		}
		app.save(aiPins);

		const jobs = new Collection({
			type: "base",
			name: "ai_pin_image_jobs",
			indexes: [
				"CREATE INDEX `idx_ai_pin_image_jobs_owner_status` ON `ai_pin_image_jobs` (`owner`, `status`)",
				"CREATE INDEX `idx_ai_pin_image_jobs_status_retry` ON `ai_pin_image_jobs` (`status`, `next_retry_at`)",
				"CREATE INDEX `idx_ai_pin_image_jobs_pin` ON `ai_pin_image_jobs` (`ai_pin`)",
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
					maxSelect: 1,
					collectionId: aiPins.id,
					cascadeDelete: false,
				},
				{
					name: "websiteId",
					type: "relation",
					maxSelect: 1,
					collectionId: websites.id,
					cascadeDelete: false,
				},
				{
					name: "articleId",
					type: "relation",
					maxSelect: 1,
					collectionId: websiteArticles.id,
					cascadeDelete: false,
				},
				{ name: "client_token", type: "text", max: 120 },
				{ name: "source_type", type: "select", required: true, maxSelect: 1, values: ["preview", "pin"] },
				{ name: "image_mode", type: "select", required: true, maxSelect: 1, values: ["generate_ai", "use_featured"] },
				{ name: "prompt", type: "text", max: 5000 },
				{ name: "prompt_payload", type: "json", maxSize: 200000 },
				{ name: "featured_image_url", type: "text", max: 1000 },
				{ name: "image_url", type: "text", max: 1000 },
				{ name: "status", type: "select", required: true, maxSelect: 1, values: ["queued", "processing", "completed", "failed", "fallback"] },
				{ name: "attempt_count", type: "number", min: 0, max: 20, noDecimal: true },
				{ name: "max_attempts", type: "number", min: 1, max: 20, noDecimal: true },
				{ name: "next_retry_at", type: "date" },
				{ name: "last_error", type: "text", max: 3000 },
				{ name: "completed_at", type: "date" },
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			].map(toField),
		});

		saveCollectionThenApplyOwnerRules(app, jobs, ownerRules);
	},
	(app) => {
		try {
			const collection = app.findCollectionByNameOrId("ai_pin_image_jobs");
			app.delete(collection);
		} catch (_) {
			// ignore
		}

		const aiPins = app.findCollectionByNameOrId("ai_pins");
		for (const fieldName of ["image_source", "image_generation_status", "image_generation_error", "image_job_id"]) {
			try {
				aiPins.fields.removeByName(fieldName);
			} catch (_) {
				// ignore
			}
		}
		app.save(aiPins);
	},
);
