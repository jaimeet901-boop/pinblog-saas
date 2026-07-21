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

function applyOwnerRules(collection) {
	if (!collection || !collection.fields.getByName("owner")) {
		return false;
	}

	collection.listRule = "@request.auth.id != '' && owner = @request.auth.id";
	collection.viewRule = "@request.auth.id != '' && owner = @request.auth.id";
	collection.createRule = "@request.auth.id != '' && owner = @request.auth.id";
	collection.updateRule = "@request.auth.id != '' && owner = @request.auth.id";
	collection.deleteRule = "@request.auth.id != '' && owner = @request.auth.id";
	return true;
}

migrate(
	(app) => {
		const users = findCollectionSafe(app, "users");

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

			applyOwnerRules(collection);
			app.save(collection);
		}

		const accounts = findCollectionSafe(app, "pinterest_accounts");
		if (accounts) {
			ensureField(accounts, { name: "is_default", type: "bool" });
			// Metadata readable by owner; mutations stay API-only (superuser).
			accounts.listRule = "@request.auth.id != '' && owner = @request.auth.id";
			accounts.viewRule = "@request.auth.id != '' && owner = @request.auth.id";
			accounts.createRule = null;
			accounts.updateRule = null;
			accounts.deleteRule = null;
			app.save(accounts);
		}

		const boards = findCollectionSafe(app, "pinterest_boards");
		if (boards) {
			ensureField(boards, { name: "is_default", type: "bool" });
			applyOwnerRules(boards);
			app.save(boards);
		}

		const jobs = findCollectionSafe(app, "pinterest_publish_jobs");
		if (jobs) {
			jobs.listRule = "@request.auth.id != '' && owner = @request.auth.id";
			jobs.viewRule = "@request.auth.id != '' && owner = @request.auth.id";
			jobs.createRule = null;
			jobs.updateRule = null;
			jobs.deleteRule = null;
			app.save(jobs);
		}

		const secrets = findCollectionSafe(app, "pinterest_account_secrets");
		if (secrets) {
			secrets.listRule = null;
			secrets.viewRule = null;
			secrets.createRule = null;
			secrets.updateRule = null;
			secrets.deleteRule = null;
			app.save(secrets);
		}

		const integrated = findCollectionSafe(app, "_integratedAiMessages");
		if (integrated && integrated.fields.getByName("userId")) {
			integrated.listRule = "@request.auth.id != '' && userId = @request.auth.id";
			integrated.viewRule = "@request.auth.id != '' && userId = @request.auth.id";
			integrated.deleteRule = "@request.auth.id != '' && userId = @request.auth.id";
			app.save(integrated);
		}
	},
	(_app) => {
		// No-op: repairing rules/fields should not be undone.
	},
);
