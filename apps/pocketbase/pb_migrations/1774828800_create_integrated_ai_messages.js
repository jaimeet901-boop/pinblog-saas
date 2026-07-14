/// <reference path="../pb_data/types.d.ts" />
migrate(
	(app) => {
		const collection = new Collection({
			type: "base",
			name: "_integratedAiMessages",
			indexes: [
				"CREATE INDEX `idx_WPAhfnyyQ7` ON `_integratedAiMessages` (`userId`)"
			],
			deleteRule: "@request.auth.id != '' && userId = @request.auth.id",
			listRule: "@request.auth.id != '' && userId = @request.auth.id",
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
					maxSize: 0,
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
				}
			],
		});

		app.save(collection);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId("_integratedAiMessages");
		app.delete(collection);
	},
);
