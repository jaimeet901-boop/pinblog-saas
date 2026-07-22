/// <reference path="../pb_data/types.d.ts" />

migrate(
	(app) => {
		const collection = app.findCollectionByNameOrId("_integratedAiMessages");
		if (!collection) {
			return;
		}

		// Persist first, then reload so userId is available for rule parsing.
		app.save(collection);
		const persisted = app.findCollectionByNameOrId(collection.id || collection.name);
		if (!persisted.fields.getByName("userId")) {
			throw new Error(`Collection ${persisted.name} is missing required userId field after save`);
		}

		persisted.listRule = "@request.auth.id != '' && userId = @request.auth.id";
		persisted.deleteRule = "@request.auth.id != '' && userId = @request.auth.id";
		app.save(persisted);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId("_integratedAiMessages");
		if (!collection) {
			return;
		}

		app.save(collection);
		const persisted = app.findCollectionByNameOrId(collection.id || collection.name);
		if (!persisted) {
			return;
		}

		persisted.listRule = null;
		persisted.deleteRule = null;
		app.save(persisted);
	},
);
