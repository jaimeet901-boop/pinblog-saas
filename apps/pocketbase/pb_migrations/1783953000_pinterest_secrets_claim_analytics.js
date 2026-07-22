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
		relation: pickCtor(typeof RelationField !== "undefined" ? RelationField : null, coreNS.RelationField),
		number: pickCtor(typeof NumberField !== "undefined" ? NumberField : null, coreNS.NumberField),
		date: pickCtor(typeof DateField !== "undefined" ? DateField : null, coreNS.DateField),
		bool: pickCtor(typeof BoolField !== "undefined" ? BoolField : null, coreNS.BoolField),
		autodate: pickCtor(typeof AutodateField !== "undefined" ? AutodateField : null, coreNS.AutodateField),
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

function lockApiOnly(collection) {
	collection.listRule = null;
	collection.viewRule = null;
	collection.createRule = null;
	collection.updateRule = null;
	collection.deleteRule = null;
}

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId("users");
		let accounts = app.findCollectionByNameOrId("pinterest_accounts");
		const jobs = app.findCollectionByNameOrId("pinterest_publish_jobs");

		// Ensure owner exists, persist, reload, then apply owner list/view rules.
		ensureField(accounts, {
			name: "owner",
			type: "relation",
			required: true,
			maxSelect: 1,
			collectionId: users.id,
			cascadeDelete: true,
		});
		accounts = saveCollectionThenApplyOwnerRules(app, accounts, {
			listRule: "@request.auth.id != '' && owner = @request.auth.id",
			viewRule: "@request.auth.id != '' && owner = @request.auth.id",
			createRule: null,
			updateRule: null,
			deleteRule: null,
		});

		let secrets;
		try {
			secrets = app.findCollectionByNameOrId("pinterest_account_secrets");
		} catch (_) {
			secrets = null;
		}

		if (!secrets) {
			secrets = new Collection({
				type: "base",
				name: "pinterest_account_secrets",
				indexes: [
					"CREATE UNIQUE INDEX `idx_pinterest_account_secrets_account` ON `pinterest_account_secrets` (`account`)",
					"CREATE INDEX `idx_pinterest_account_secrets_owner` ON `pinterest_account_secrets` (`owner`)",
				],
				fields: [
					{
						name: "owner",
						type: "relation",
						required: true,
						maxSelect: 1,
						collectionId: users.id,
						cascadeDelete: true,
					},
					{
						name: "account",
						type: "relation",
						required: true,
						maxSelect: 1,
						collectionId: accounts.id,
						cascadeDelete: true,
					},
					{ name: "access_token", type: "text", max: 4000 },
					{ name: "refresh_token", type: "text", max: 4000 },
					{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
					{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
				].map(toField),
			});
			app.save(secrets);
		}

		lockApiOnly(secrets);
		app.save(secrets);

		// Move tokens off the client-readable accounts collection.
		try {
			const accountRecords = app.findRecordsByFilter("pinterest_accounts", "id != ''", "-created", 2000, 0);
			for (const record of accountRecords) {
				const access = String(record.get("access_token") || "").trim();
				const refresh = String(record.get("refresh_token") || "").trim();
				if (!access && !refresh) {
					continue;
				}

				let secretRecord = null;
				try {
					secretRecord = app.findFirstRecordByFilter(
						"pinterest_account_secrets",
						`account = "${record.id}"`,
					);
				} catch (_) {
					secretRecord = null;
				}

				if (!secretRecord) {
					secretRecord = new Record(secrets);
					secretRecord.set("owner", record.get("owner"));
					secretRecord.set("account", record.id);
				}

				if (access) secretRecord.set("access_token", access);
				if (refresh) secretRecord.set("refresh_token", refresh);
				app.save(secretRecord);

				record.set("access_token", "");
				record.set("refresh_token", "");
				app.save(record);
			}
		} catch (_) {
			// Best-effort token migration.
		}

		ensureField(jobs, { name: "claim_token", type: "text", max: 120 });
		ensureField(jobs, { name: "claim_version", type: "number", min: 0, max: 1000000000, noDecimal: true });
		ensureField(jobs, { name: "analytics_synced_at", type: "date" });
		app.save(jobs);

		// Jobs remain readable by owner; mutations are API-only.
		let jobsPersisted = app.findCollectionByNameOrId(jobs.id || jobs.name);
		jobsPersisted.createRule = null;
		jobsPersisted.updateRule = null;
		jobsPersisted.deleteRule = null;
		app.save(jobsPersisted);
	},
	(app) => {
		try {
			app.delete(app.findCollectionByNameOrId("pinterest_account_secrets"));
		} catch (_) {}

		try {
			const jobs = app.findCollectionByNameOrId("pinterest_publish_jobs");
			try { jobs.fields.removeByName("claim_token"); } catch (_) {}
			try { jobs.fields.removeByName("claim_version"); } catch (_) {}
			try { jobs.fields.removeByName("analytics_synced_at"); } catch (_) {}
			app.save(jobs);
		} catch (_) {}
	},
);
