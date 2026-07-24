/// <reference path="../pb_data/types.d.ts" />
/**
 * Create `_integratedAiImages` with plain field objects (PocketBase v0.38).
 * Do NOT pass Field class instances into `new Collection({ fields })` — they are dropped on save.
 */

migrate(
	(app) => {
		const collection = new Collection({
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
					hidden: false,
					id: "file1542800728",
					maxSelect: 1,
					maxSize: 20971520,
					mimeTypes: [
						"image/jpeg",
						"image/png",
						"image/webp",
					],
					name: "file",
					presentable: false,
					protected: false,
					required: true,
					system: false,
					thumbs: [],
					type: "file",
				},
				{
					hidden: false,
					id: "autodate3332085495",
					name: "created",
					onCreate: true,
					onUpdate: false,
					presentable: false,
					system: false,
					type: "autodate",
				},
			],
		});

		app.save(collection);

		const persisted = app.findCollectionByNameOrId("_integratedAiImages");
		if (!persisted.fields.getByName("file")) {
			throw new Error('_integratedAiImages missing file after create');
		}
	},
	(app) => {
		const collection = app.findCollectionByNameOrId("_integratedAiImages");
		app.delete(collection);
	},
);
