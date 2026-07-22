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
		json: pickCtor(typeof JSONField !== "undefined" ? JSONField : null, coreNS.JSONField),
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

		const templates = new Collection({
			type: "base",
			name: "ai_pin_templates",
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
			].map(toField),
		});

		saveCollectionThenApplyOwnerRules(app, templates, ownerRules);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId("ai_pin_templates");
		app.delete(collection);
	},
);
