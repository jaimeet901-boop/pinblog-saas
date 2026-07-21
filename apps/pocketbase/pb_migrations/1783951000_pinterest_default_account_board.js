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
		bool: pickCtor(typeof BoolField !== "undefined" ? BoolField : null, coreNS.BoolField),
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

migrate(
	(app) => {
		const accounts = app.findCollectionByNameOrId("pinterest_accounts");
		ensureField(accounts, { name: "is_default", type: "bool" });
		app.save(accounts);

		const boards = app.findCollectionByNameOrId("pinterest_boards");
		ensureField(boards, { name: "is_default", type: "bool" });
		app.save(boards);

		// Promote the oldest connected account to default when none exists yet.
		try {
			const allAccounts = app.findRecordsByFilter("pinterest_accounts", "id != ''", "-created", 500, 0);
			const byOwner = {};
			for (const record of allAccounts) {
				const owner = record.get("owner");
				if (!owner) continue;
				if (!byOwner[owner]) byOwner[owner] = [];
				byOwner[owner].push(record);
			}
			for (const ownerId of Object.keys(byOwner)) {
				const list = byOwner[ownerId];
				const hasDefault = list.some((item) => item.get("is_default") === true);
				if (hasDefault) continue;
				const preferred = list.find((item) => item.get("connected") === true) || list[0];
				if (!preferred) continue;
				preferred.set("is_default", true);
				app.save(preferred);
			}
		} catch (_) {
			// Best-effort backfill only.
		}

		// Promote one board per account to default when none exists yet.
		try {
			const allBoards = app.findRecordsByFilter("pinterest_boards", "id != ''", "name", 2000, 0);
			const byAccount = {};
			for (const record of allBoards) {
				const accountId = record.get("account");
				if (!accountId) continue;
				if (!byAccount[accountId]) byAccount[accountId] = [];
				byAccount[accountId].push(record);
			}
			for (const accountId of Object.keys(byAccount)) {
				const list = byAccount[accountId];
				const hasDefault = list.some((item) => item.get("is_default") === true);
				if (hasDefault) continue;
				const preferred = list[0];
				if (!preferred) continue;
				preferred.set("is_default", true);
				app.save(preferred);
			}
		} catch (_) {
			// Best-effort backfill only.
		}
	},
	(app) => {
		const accounts = app.findCollectionByNameOrId("pinterest_accounts");
		try { accounts.fields.removeByName("is_default"); } catch (_) {}
		app.save(accounts);

		const boards = app.findCollectionByNameOrId("pinterest_boards");
		try { boards.fields.removeByName("is_default"); } catch (_) {}
		app.save(boards);
	},
);
