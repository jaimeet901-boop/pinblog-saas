/// <reference path="../pb_data/types.d.ts" />
/**
 * Credits Engine foundation:
 * - plan credit costs / trial / upgrade / downgrade / topup packs (JSON on plans)
 * - credit_transactions extras (feature, reservation, idempotency)
 * - credit_reservations collection
 * - billing_events for upgrade history
 *
 * Production upgrade note:
 * Existing credit_transactions may contain duplicate idempotency_key values.
 * Dedupe (keep first, UUID the rest) before creating the UNIQUE index.
 */

const coreNS = typeof core !== "undefined" ? core : {};

function pickCtor(...ctors) {
	for (const ctor of ctors) {
		if (typeof ctor === "function") return ctor;
	}
	return null;
}

function toField(def) {
	if (!def || typeof def !== "object" || typeof def.type !== "string") return def;
	const ctorByType = {
		text: pickCtor(typeof TextField !== "undefined" ? TextField : null, coreNS.TextField),
		number: pickCtor(typeof NumberField !== "undefined" ? NumberField : null, coreNS.NumberField),
		bool: pickCtor(typeof BoolField !== "undefined" ? BoolField : null, coreNS.BoolField),
		select: pickCtor(typeof SelectField !== "undefined" ? SelectField : null, coreNS.SelectField),
		date: pickCtor(typeof DateField !== "undefined" ? DateField : null, coreNS.DateField),
		json: pickCtor(typeof JSONField !== "undefined" ? JSONField : null, coreNS.JSONField),
		relation: pickCtor(typeof RelationField !== "undefined" ? RelationField : null, coreNS.RelationField),
		autodate: pickCtor(typeof AutodateField !== "undefined" ? AutodateField : null, coreNS.AutodateField),
	};
	const Ctor = ctorByType[def.type];
	if (!Ctor) throw new Error(`Unsupported migration field type: ${def.type}`);
	return new Ctor(def);
}

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

function ensureField(collection, def) {
	if (!collection.fields.getByName(def.name)) {
		collection.fields.add(toField(def));
		return true;
	}
	return false;
}

function ensureIndex(collection, sql) {
	const indexes = Array.isArray(collection.indexes) ? collection.indexes.slice() : [];
	if (indexes.includes(sql)) return false;
	indexes.push(sql);
	collection.indexes = indexes;
	return true;
}

function relationField(name, collectionId, options = {}) {
	return {
		name,
		type: "relation",
		required: options.required === true,
		maxSelect: options.maxSelect ?? 1,
		collectionId,
		cascadeDelete: options.cascadeDelete === true,
	};
}

const CREDIT_TX_IDEMPOTENCY_INDEX_SQL =
	"CREATE UNIQUE INDEX `idx_credit_tx_idempotency` ON `credit_transactions` (`idempotency_key`)";
const CREDIT_TX_IDEMPOTENCY_INDEX_MARKER = "idx_credit_tx_idempotency";
const CREDIT_TX_FEATURE_INDEX_SQL =
	"CREATE INDEX `idx_credit_tx_feature` ON `credit_transactions` (`workspace_key`, `feature`)";

function recordString(record, field) {
	try {
		const v = record.get(field);
		if (v == null) return "";
		return String(v).trim();
	} catch (_) {
		return "";
	}
}

function recordTimestampMs(record) {
	try {
		const updated = record.get("updated");
		const created = record.get("created");
		const t = Date.parse(String(updated || created || ""));
		return Number.isFinite(t) ? t : 0;
	} catch (_) {
		return 0;
	}
}

function generateUuidV4() {
	// Prefer runtime crypto when available (PocketBase goja / host).
	try {
		if (typeof $security !== "undefined" && typeof $security.randomString === "function") {
			// Fall through to deterministic-style builder below if no UUID helper.
		}
	} catch (_) {
		// ignore
	}
	try {
		if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
			return crypto.randomUUID();
		}
	} catch (_) {
		// ignore
	}

	// Deterministic-enough UUID v4 from time + Math.random for migration repair.
	const bytes = [];
	for (let i = 0; i < 16; i += 1) {
		bytes.push(Math.floor(Math.random() * 256));
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.map((x) => x.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function findAllRecordsSafe(app, collectionName) {
	try {
		return app.findRecordsByFilter(collectionName, "", "-created,-updated", 0, 0) || [];
	} catch (_) {
		try {
			return app.findAllRecords(collectionName) || [];
		} catch {
			return [];
		}
	}
}

/**
 * Preserve all credit_transactions rows.
 * For each duplicated idempotency_key: keep the first record, assign a new UUID to the rest.
 * Empty/blank keys are treated as a duplicate group as well (SQLite UNIQUE treats '' as equal).
 */
function dedupeCreditTransactionIdempotencyKeys(app, txsCollection) {
	if (!txsCollection || !txsCollection.fields.getByName("idempotency_key")) {
		return { changed: 0, duplicatesFixed: 0 };
	}

	const collectionName = txsCollection.name || "credit_transactions";
	const records = findAllRecordsSafe(app, collectionName);
	if (!Array.isArray(records) || !records.length) {
		return { changed: 0, duplicatesFixed: 0 };
	}

	const groups = {};
	for (const record of records) {
		const key = recordString(record, "idempotency_key");
		if (!groups[key]) groups[key] = [];
		groups[key].push(record);
	}

	const dirtyRecords = [];
	let duplicatesFixed = 0;
	const usedKeys = new Set(Object.keys(groups).filter((k) => k !== ""));

	for (const key of Object.keys(groups)) {
		const group = groups[key];
		if (!Array.isArray(group) || group.length < 2) continue;

		// Keep the earliest/first record; re-key the rest.
		group.sort((a, b) => {
			const ta = recordTimestampMs(a);
			const tb = recordTimestampMs(b);
			if (ta !== tb) return ta - tb;
			return String(a.id || "").localeCompare(String(b.id || ""));
		});

		for (let i = 1; i < group.length; i += 1) {
			const record = group[i];
			let nextKey = generateUuidV4();
			// Extremely unlikely, but avoid colliding with an existing key in this batch.
			while (usedKeys.has(nextKey)) {
				nextKey = generateUuidV4();
			}
			usedKeys.add(nextKey);
			record.set("idempotency_key", nextKey);
			dirtyRecords.push(record);
			duplicatesFixed += 1;
		}
	}

	for (const record of dirtyRecords) {
		if (typeof app.saveNoValidate === "function") {
			app.saveNoValidate(record);
		} else {
			app.save(record);
		}
	}

	return { changed: dirtyRecords.length, duplicatesFixed };
}

function collectionHasIndexMarker(collection, marker) {
	const indexes = Array.isArray(collection?.indexes) ? collection.indexes : [];
	return indexes.some((sql) => String(sql).includes(marker));
}

migrate((app) => {
	const plans = findCollectionSafe(app, "plans");
	if (plans) {
		let dirty = false;
		dirty = ensureField(plans, { name: "credit_costs", type: "json" }) || dirty;
		dirty = ensureField(plans, { name: "trial_config", type: "json" }) || dirty;
		dirty = ensureField(plans, { name: "upgrade_rules", type: "json" }) || dirty;
		dirty = ensureField(plans, { name: "downgrade_rules", type: "json" }) || dirty;
		dirty = ensureField(plans, { name: "topup_packs", type: "json" }) || dirty;
		if (dirty) app.save(plans);
	}

	const txs = findCollectionSafe(app, "credit_transactions");
	if (txs) {
		let dirty = false;
		dirty = ensureField(txs, { name: "feature", type: "text", max: 80 }) || dirty;
		dirty = ensureField(txs, { name: "idempotency_key", type: "text", max: 120 }) || dirty;
		dirty = ensureField(txs, { name: "reservation_id", type: "text", max: 64 }) || dirty;
		dirty = ensureField(txs, { name: "reference_id", type: "text", max: 120 }) || dirty;

		const existingIndexes = Array.isArray(txs.indexes) ? txs.indexes.slice() : [];
		const hasUniqueIdempotency = existingIndexes.some((sql) =>
			String(sql).includes(CREDIT_TX_IDEMPOTENCY_INDEX_MARKER),
		);

		if (!hasUniqueIdempotency) {
			// Save schema + non-unique indexes first (UNIQUE must wait for dedupe).
			const indexesWithoutUnique = existingIndexes.filter(
				(sql) => !String(sql).includes(CREDIT_TX_IDEMPOTENCY_INDEX_MARKER),
			);
			if (!indexesWithoutUnique.includes(CREDIT_TX_FEATURE_INDEX_SQL)) {
				indexesWithoutUnique.push(CREDIT_TX_FEATURE_INDEX_SQL);
			}
			txs.indexes = indexesWithoutUnique;
			app.save(txs);

			dedupeCreditTransactionIdempotencyKeys(app, txs);

			const post = findCollectionSafe(app, "credit_transactions");
			if (post && !collectionHasIndexMarker(post, CREDIT_TX_IDEMPOTENCY_INDEX_MARKER)) {
				ensureIndex(post, CREDIT_TX_IDEMPOTENCY_INDEX_SQL);
				app.save(post);
			}
		} else {
			dirty = ensureIndex(txs, CREDIT_TX_FEATURE_INDEX_SQL) || dirty;
			if (dirty) app.save(txs);
		}
	}

	const subs = findCollectionSafe(app, "workspace_subscriptions");
	if (subs) {
		let dirty = false;
		dirty = ensureField(subs, { name: "purchased_credits", type: "number", min: 0 }) || dirty;
		dirty = ensureField(subs, { name: "bonus_credits_balance", type: "number", min: 0 }) || dirty;
		dirty = ensureField(subs, { name: "credits_used_total", type: "number", min: 0 }) || dirty;
		dirty = ensureField(subs, { name: "credits_suspended", type: "bool" }) || dirty;
		dirty = ensureField(subs, { name: "last_credit_reset_at", type: "date" }) || dirty;
		dirty = ensureField(subs, { name: "billing_status", type: "text", max: 40 }) || dirty;
		if (dirty) app.save(subs);
	}

	let reservations = findCollectionSafe(app, "credit_reservations");
	if (!reservations) {
		const users = findCollectionSafe(app, "users");
		reservations = new Collection({
			type: "base",
			name: "credit_reservations",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				toField({ name: "workspace_key", type: "text", required: true, max: 120 }),
				toField({ name: "workspace_name", type: "text", max: 200 }),
				toField({ name: "amount", type: "number", required: true, min: 0 }),
				toField({ name: "feature", type: "text", max: 80 }),
				toField({
					name: "status",
					type: "select",
					required: true,
					maxSelect: 1,
					values: ["reserved", "committed", "released", "expired"],
				}),
				toField({ name: "reason", type: "text", max: 500 }),
				toField({ name: "reference_id", type: "text", max: 120 }),
				toField({ name: "idempotency_key", type: "text", max: 120 }),
				toField({ name: "expires_at", type: "date" }),
				toField({ name: "metadata", type: "json" }),
				users ? toField(relationField("created_by_user", users.id)) : toField({ name: "created_by_user", type: "text", max: 64 }),
				toField({ name: "created", type: "autodate", onCreate: true, onUpdate: false }),
				toField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true }),
			],
			indexes: [
				"CREATE INDEX `idx_credit_reservations_ws` ON `credit_reservations` (`workspace_key`, `status`)",
				"CREATE UNIQUE INDEX `idx_credit_reservations_idem` ON `credit_reservations` (`idempotency_key`)",
			],
		});
		app.save(reservations);
	}

	let billingEvents = findCollectionSafe(app, "billing_events");
	if (!billingEvents) {
		billingEvents = new Collection({
			type: "base",
			name: "billing_events",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				toField({ name: "workspace_key", type: "text", required: true, max: 120 }),
				toField({ name: "workspace_name", type: "text", max: 200 }),
				toField({
					name: "event_type",
					type: "select",
					required: true,
					maxSelect: 1,
					values: ["upgrade", "downgrade", "trial_start", "trial_end", "plan_assign", "reset", "suspend", "unsuspend", "topup"],
				}),
				toField({ name: "from_plan", type: "text", max: 80 }),
				toField({ name: "to_plan", type: "text", max: 80 }),
				toField({ name: "actor", type: "text", max: 120 }),
				toField({ name: "message", type: "text", max: 1000 }),
				toField({ name: "metadata", type: "json" }),
				toField({ name: "occurred_at", type: "date" }),
				toField({ name: "created", type: "autodate", onCreate: true, onUpdate: false }),
				toField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true }),
			],
			indexes: [
				"CREATE INDEX `idx_billing_events_ws` ON `billing_events` (`workspace_key`, `occurred_at`)",
			],
		});
		app.save(billingEvents);
	}
}, (app) => {
	// Additive migration — no destructive down.
});
