/// <reference path="../pb_data/types.d.ts" />

migrate(
	(app) => {
		const collection = app.findCollectionByNameOrId("_integratedAiMessages");
		if (!collection) {
			return;
		}

		collection.listRule = "@request.auth.id != '' && userId = @request.auth.id";
		collection.deleteRule = "@request.auth.id != '' && userId = @request.auth.id";
		app.save(collection);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId("_integratedAiMessages");
		if (!collection) {
			return;
		}

		collection.listRule = null;
		collection.deleteRule = null;
		app.save(collection);
	},
);
