/// <reference path="../pb_data/types.d.ts" />
/**
 * Repair `_integratedAiMessages` / `_integratedAiImages`.
 *
 * PocketBase v0.38 drops Field class instances passed to `new Collection({ fields })`.
 * Migrations 1774828800/1774828801 used `.map(toField)`, so collections were often
 * saved with only the system `id` field. getHistory() then filters on missing `userId`
 * and PocketBase returns HTTP 400.
 *
 * Use plain field objects for Collection create, and Field constructors for fields.add().
 */

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

function ensureMessagesCollection(app) {
	let collection = findCollectionSafe(app, "_integratedAiMessages");

	if (!collection) {
		collection = new Collection({
			type: "base",
			name: "_integratedAiMessages",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			indexes: [
				"CREATE INDEX `idx_integrated_ai_messages_userId` ON `_integratedAiMessages` (`userId`)",
			],
			fields: [
				{
					autogeneratePattern: "[a-z0-9]{15}",
					hidden: false,
					id: "text3208210256",
					max: 15,
					min: 15,
					name: "id",
					pattern: "^[a-z0-9]+$",
					presentable: false,
					primaryKey: true,
					required: true,
					system: true,
					type: "text",
				},
				{
					name: "userId",
					type: "text",
					required: false,
					max: 0,
					min: 0,
					pattern: "",
				},
				{
					name: "role",
					type: "select",
					required: true,
					maxSelect: 1,
					values: ["user", "assistant"],
				},
				{
					name: "content",
					type: "json",
					required: true,
					maxSize: 5000000,
				},
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
				{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
			],
		});
		app.save(collection);
		collection = app.findCollectionByNameOrId("_integratedAiMessages");
	}

	if (!collection.fields.getByName("userId")) {
		collection.fields.add(new TextField({
			name: "userId",
			required: false,
		}));
	}
	if (!collection.fields.getByName("role")) {
		collection.fields.add(new SelectField({
			name: "role",
			required: true,
			maxSelect: 1,
			values: ["user", "assistant"],
		}));
	}
	if (!collection.fields.getByName("content")) {
		collection.fields.add(new JSONField({
			name: "content",
			required: true,
			maxSize: 5000000,
		}));
	}
	if (!collection.fields.getByName("created")) {
		collection.fields.add(new AutodateField({
			name: "created",
			onCreate: true,
			onUpdate: false,
		}));
	}
	if (!collection.fields.getByName("updated")) {
		collection.fields.add(new AutodateField({
			name: "updated",
			onCreate: true,
			onUpdate: true,
		}));
	}

	// API-managed via superuser client (apps/api).
	collection.listRule = null;
	collection.viewRule = null;
	collection.createRule = null;
	collection.updateRule = null;
	collection.deleteRule = null;

	const indexes = Array.isArray(collection.indexes) ? [...collection.indexes] : [];
	const hasUserIdIndex = indexes.some((idx) => String(idx).includes('userId'));
	if (!hasUserIdIndex && collection.fields.getByName('userId')) {
		indexes.push("CREATE INDEX `idx_integrated_ai_messages_userId` ON `_integratedAiMessages` (`userId`)");
		collection.indexes = indexes;
	}

	app.save(collection);

	const persisted = app.findCollectionByNameOrId("_integratedAiMessages");
	if (!persisted.fields.getByName("userId")) {
		throw new Error('Repair migration: _integratedAiMessages is missing userId after save');
	}
	if (!persisted.fields.getByName("role")) {
		throw new Error('Repair migration: _integratedAiMessages is missing role after save');
	}
	if (!persisted.fields.getByName("content")) {
		throw new Error('Repair migration: _integratedAiMessages is missing content after save');
	}
	if (!persisted.fields.getByName("created")) {
		throw new Error('Repair migration: _integratedAiMessages is missing created after save');
	}
}

function ensureImagesCollection(app) {
	let collection = findCollectionSafe(app, "_integratedAiImages");

	if (!collection) {
		collection = new Collection({
			type: "base",
			name: "_integratedAiImages",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				{
					autogeneratePattern: "[a-z0-9]{15}",
					hidden: false,
					id: "text3208210256",
					max: 15,
					min: 15,
					name: "id",
					pattern: "^[a-z0-9]+$",
					presentable: false,
					primaryKey: true,
					required: true,
					system: true,
					type: "text",
				},
				{
					name: "file",
					type: "file",
					required: true,
					maxSelect: 1,
					maxSize: 20971520,
					mimeTypes: ["image/jpeg", "image/png", "image/webp"],
					thumbs: [],
					protected: false,
				},
				{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
			],
		});
		app.save(collection);
		collection = app.findCollectionByNameOrId("_integratedAiImages");
	}

	if (!collection.fields.getByName("file")) {
		collection.fields.add(new FileField({
			name: "file",
			required: true,
			maxSelect: 1,
			maxSize: 20971520,
			mimeTypes: ["image/jpeg", "image/png", "image/webp"],
		}));
	}
	if (!collection.fields.getByName("created")) {
		collection.fields.add(new AutodateField({
			name: "created",
			onCreate: true,
			onUpdate: false,
		}));
	}

	collection.listRule = null;
	collection.viewRule = null;
	collection.createRule = null;
	collection.updateRule = null;
	collection.deleteRule = null;

	app.save(collection);

	const persisted = app.findCollectionByNameOrId("_integratedAiImages");
	if (!persisted.fields.getByName("file")) {
		throw new Error('Repair migration: _integratedAiImages is missing file after save');
	}
}

migrate(
	(app) => {
		ensureMessagesCollection(app);
		ensureImagesCollection(app);
	},
	(app) => {
		// Non-destructive down: keep repaired schema.
	},
);
