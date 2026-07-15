/// <reference path="../pb_data/types.d.ts" />

migrate(
	(app) => {
		const collection = app.findCollectionByNameOrId("_integratedAiMessages");
		if (!collection) {
			return;
		}

		// Persist first, then reload to make sure field metadata is available.
		app.save(collection);
		const persisted = app.findCollectionByNameOrId(collection.id || collection.name);
		if (!persisted || !persisted.fields.getByName("userId")) {
			return;
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
