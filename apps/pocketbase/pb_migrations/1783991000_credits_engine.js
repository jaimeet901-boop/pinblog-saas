/// <reference path="../pb_data/types.d.ts" />
/**
 * Credits Engine foundation:
 * - plan credit costs / trial / upgrade / downgrade / topup packs (JSON on plans)
 * - credit_transactions extras (feature, reservation, idempotency)
 * - credit_reservations collection
 * - billing_events for upgrade history
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
		dirty = ensureIndex(txs, "CREATE INDEX `idx_credit_tx_feature` ON `credit_transactions` (`workspace_key`, `feature`)") || dirty;
		dirty = ensureIndex(txs, "CREATE UNIQUE INDEX `idx_credit_tx_idempotency` ON `credit_transactions` (`idempotency_key`)") || dirty;
		if (dirty) app.save(txs);
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
