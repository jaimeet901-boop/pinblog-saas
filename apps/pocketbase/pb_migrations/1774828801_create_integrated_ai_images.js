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
		file: pickCtor(typeof FileField !== "undefined" ? FileField : null, coreNS.FileField),
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
			].map(toField),
		});

		app.save(collection);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId("_integratedAiImages");
		app.delete(collection);
	},
);
