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
		select: pickCtor(typeof SelectField !== "undefined" ? SelectField : null, coreNS.SelectField),
		json: pickCtor(typeof JSONField !== "undefined" ? JSONField : null, coreNS.JSONField),
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
			].map(toField),
		});

		app.save(collection);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId("_integratedAiMessages");
		app.delete(collection);
	},
);
