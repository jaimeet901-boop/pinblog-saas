/// <reference path="../pb_data/types.d.ts" />
/**
 * Create `_integratedAiMessages` with plain field objects (PocketBase v0.38).
 * Do NOT pass Field class instances into `new Collection({ fields })` — they are dropped on save.
 */

migrate(
	(app) => {
		const collection = new Collection({
			type: "base",
			name: "_integratedAiMessages",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			indexes: [
				"CREATE INDEX `idx_WPAhfnyyQ7` ON `_integratedAiMessages` (`userId`)",
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
					hidden: false,
					id: "text2504183744",
					max: 0,
					min: 0,
					name: "userId",
					pattern: "",
					presentable: false,
					primaryKey: false,
					required: false,
					system: false,
					type: "text",
				},
				{
					hidden: false,
					id: "select1847655498",
					maxSelect: 1,
					name: "role",
					presentable: false,
					required: true,
					system: false,
					type: "select",
					values: ["user", "assistant"],
				},
				{
					hidden: false,
					id: "json4129592018",
					maxSize: 5000000,
					name: "content",
					presentable: false,
					required: true,
					system: false,
					type: "json",
				},
				{
					hidden: false,
					id: "autodate2990389176",
					name: "created",
					onCreate: true,
					onUpdate: false,
					presentable: false,
					system: false,
					type: "autodate",
				},
				{
					hidden: false,
					id: "autodate3332085495",
					name: "updated",
					onCreate: true,
					onUpdate: true,
					presentable: false,
					system: false,
					type: "autodate",
				},
			],
		});

		app.save(collection);

		const persisted = app.findCollectionByNameOrId("_integratedAiMessages");
		if (!persisted.fields.getByName("userId")) {
			throw new Error('_integratedAiMessages missing userId after create');
		}
	},
	(app) => {
		const collection = app.findCollectionByNameOrId("_integratedAiMessages");
		app.delete(collection);
	},
);
