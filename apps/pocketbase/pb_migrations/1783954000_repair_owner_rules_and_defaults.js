/// <reference path="../pb_data/types.d.ts" />

/**
 * Repair owner-readable rules and missing default fields that cause:
 * - 403 "Only superusers can perform this action" for authenticated users
 * - 400 from API sorts on missing is_default fields
 */

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
		bool: pickCtor(typeof BoolField !== "undefined" ? BoolField : null, coreNS.BoolField),
		relation: pickCtor(typeof RelationField !== "undefined" ? RelationField : null, coreNS.RelationField),
		text: pickCtor(typeof TextField !== "undefined" ? TextField : null, coreNS.TextField),
	};

	const Ctor = ctorByType[def.type];
	if (!Ctor) {
		throw new Error(`Unsupported migration field type: ${def.type}`);
	}
	return new Ctor(def);
}

function ensureField(collection, def) {
	if (!collection.fields.getByName(def.name)) {
		collection.fields.add(toField(def));
	}
}

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

function saveCollectionThenApplyOwnerRules(app, collection, ownerRules) {
	app.save(collection); // persist fields including owner
	let persisted = app.findCollectionByNameOrId(collection.id || collection.name);
	if (!persisted.fields.getByName("owner")) {
		throw new Error(`Collection ${persisted.name} is missing required owner field after save`);
	}
	persisted.listRule = ownerRules.listRule;
	persisted.viewRule = ownerRules.viewRule;
	persisted.createRule = ownerRules.createRule;
	persisted.updateRule = ownerRules.updateRule;
	persisted.deleteRule = ownerRules.deleteRule;
	app.save(persisted);
	return app.findCollectionByNameOrId(persisted.id || persisted.name);
}

migrate(
	(app) => {
		const users = findCollectionSafe(app, "users");

		const ownerRules = {
			listRule: "@request.auth.id != '' && owner = @request.auth.id",
			viewRule: "@request.auth.id != '' && owner = @request.auth.id",
			createRule: "@request.auth.id != '' && owner = @request.auth.id",
			updateRule: "@request.auth.id != '' && owner = @request.auth.id",
			deleteRule: "@request.auth.id != '' && owner = @request.auth.id",
		};

		const ownerReadApiWriteRules = {
			listRule: "@request.auth.id != '' && owner = @request.auth.id",
			viewRule: "@request.auth.id != '' && owner = @request.auth.id",
			createRule: null,
			updateRule: null,
			deleteRule: null,
		};

		const ownerCollections = [
			"ai_pins",
			"ai_pin_templates",
			"brand_kits",
			"ai_pin_generation_history",
			"pinterest_boards",
			"websites",
			"website_articles",
		];

		for (const name of ownerCollections) {
			const collection = findCollectionSafe(app, name);
			if (!collection) {
				continue;
			}

			if (users && !collection.fields.getByName("owner")) {
				ensureField(collection, {
					name: "owner",
					type: "relation",
					required: true,
					maxSelect: 1,
					collectionId: users.id,
					cascadeDelete: true,
				});
			}

			if (name === "brand_kits" || name === "ai_pin_templates") {
				ensureField(collection, { name: "is_default", type: "bool" });
			}

			if (!collection.fields.getByName("owner")) {
				app.save(collection);
				continue;
			}

			// Save fields first, reload, then apply owner rules.
			saveCollectionThenApplyOwnerRules(app, collection, ownerRules);
		}

		const accounts = findCollectionSafe(app, "pinterest_accounts");
		if (accounts) {
			if (users) {
				ensureField(accounts, {
					name: "owner",
					type: "relation",
					required: true,
					maxSelect: 1,
					collectionId: users.id,
					cascadeDelete: true,
				});
			}
			ensureField(accounts, { name: "is_default", type: "bool" });
			if (accounts.fields.getByName("owner")) {
				// Metadata readable by owner; mutations stay API-only (superuser).
				saveCollectionThenApplyOwnerRules(app, accounts, ownerReadApiWriteRules);
			} else {
				app.save(accounts);
			}
		}

		const boards = findCollectionSafe(app, "pinterest_boards");
		if (boards) {
			ensureField(boards, { name: "is_default", type: "bool" });
			if (boards.fields.getByName("owner")) {
				saveCollectionThenApplyOwnerRules(app, boards, ownerRules);
			} else {
				app.save(boards);
			}
		}

		const jobs = findCollectionSafe(app, "pinterest_publish_jobs");
		if (jobs) {
			if (users) {
				ensureField(jobs, {
					name: "owner",
					type: "relation",
					required: true,
					maxSelect: 1,
					collectionId: users.id,
					cascadeDelete: true,
				});
			}
			if (jobs.fields.getByName("owner")) {
				saveCollectionThenApplyOwnerRules(app, jobs, ownerReadApiWriteRules);
			} else {
				app.save(jobs);
			}
		}

		const secrets = findCollectionSafe(app, "pinterest_account_secrets");
		if (secrets) {
			app.save(secrets);
			let secretsPersisted = app.findCollectionByNameOrId(secrets.id || secrets.name);
			secretsPersisted.listRule = null;
			secretsPersisted.viewRule = null;
			secretsPersisted.createRule = null;
			secretsPersisted.updateRule = null;
			secretsPersisted.deleteRule = null;
			app.save(secretsPersisted);
		}

		const integrated = findCollectionSafe(app, "_integratedAiMessages");
		if (integrated) {
			app.save(integrated);
			let integratedPersisted = app.findCollectionByNameOrId(integrated.id || integrated.name);
			if (integratedPersisted.fields.getByName("userId")) {
				integratedPersisted.listRule = "@request.auth.id != '' && userId = @request.auth.id";
				integratedPersisted.viewRule = "@request.auth.id != '' && userId = @request.auth.id";
				integratedPersisted.deleteRule = "@request.auth.id != '' && userId = @request.auth.id";
				app.save(integratedPersisted);
			}
		}
	},
	(_app) => {
		// No-op: repairing rules/fields should not be undone.
	},
);
