/// <reference path="../pb_data/types.d.ts" />
migrate(
	(app) => {
		const collection = new Collection({
			type: "base",
			name: "_integratedAiImages",
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
	},
	(app) => {
		const collection = app.findCollectionByNameOrId("_integratedAiImages");
		app.delete(collection);
	},
);
