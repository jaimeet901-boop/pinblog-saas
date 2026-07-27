/// <reference path="../pb_data/types.d.ts" />
/**
 * Billing automation schema:
 * - subscription lifecycle fields
 * - billing_idempotency collection
 * - broaden billing_events event types
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

migrate((app) => {
	const subs = findCollectionSafe(app, "workspace_subscriptions");
	if (subs) {
		let dirty = false;
		dirty = ensureField(subs, { name: "trial_ends_at", type: "date" }) || dirty;
		dirty = ensureField(subs, { name: "grace_period_ends_at", type: "date" }) || dirty;
		dirty = ensureField(subs, { name: "cancel_at_period_end", type: "bool" }) || dirty;
		dirty = ensureField(subs, { name: "pending_plan", type: "text", max: 64 }) || dirty;
		dirty = ensureField(subs, { name: "last_payment_status", type: "text", max: 40 }) || dirty;
		dirty = ensureField(subs, { name: "last_payment_at", type: "date" }) || dirty;
		dirty = ensureField(subs, { name: "provider", type: "text", max: 40 }) || dirty;
		dirty = ensureField(subs, { name: "provider_subscription_id", type: "text", max: 120 }) || dirty;
		dirty = ensureField(subs, { name: "monthly_credits_balance", type: "number", min: 0 }) || dirty;
		dirty = ensureField(subs, { name: "notified_credit_thresholds", type: "text", max: 120 }) || dirty;
		dirty = ensureField(subs, { name: "owner_user", type: "text", max: 64 }) || dirty;
		if (dirty) app.save(subs);
	}

	const events = findCollectionSafe(app, "billing_events");
	if (events) {
		const field = events.fields.getByName("event_type");
		if (field && field.type === "select") {
			field.values = [
				"upgrade", "downgrade", "trial_start", "trial_end", "plan_assign",
				"reset", "suspend", "unsuspend", "topup",
				"renewed", "cancelled", "payment_failed", "credits_purchased",
				"credits_expired", "manual_adjustment", "grace_start", "grace_end",
			];
			app.save(events);
		}
	}

	let idem = findCollectionSafe(app, "billing_idempotency");
	if (!idem) {
		idem = new Collection({
			type: "base",
			name: "billing_idempotency",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				toField({ name: "idempotency_key", type: "text", required: true, max: 180 }),
				toField({ name: "scope", type: "text", max: 40 }),
				toField({ name: "workspace_key", type: "text", max: 120 }),
				toField({ name: "provider", type: "text", max: 40 }),
				toField({ name: "event_type", type: "text", max: 120 }),
				toField({
					name: "status",
					type: "select",
					required: true,
					maxSelect: 1,
					values: ["processing", "completed", "failed"],
				}),
				toField({ name: "payload", type: "json" }),
				toField({ name: "result", type: "json" }),
				toField({ name: "processed_at", type: "date" }),
				toField({ name: "created", type: "autodate", onCreate: true, onUpdate: false }),
				toField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true }),
			],
			indexes: [
				"CREATE UNIQUE INDEX `idx_billing_idempotency_key` ON `billing_idempotency` (`idempotency_key`)",
				"CREATE INDEX `idx_billing_idempotency_ws` ON `billing_idempotency` (`workspace_key`, `created`)",
			],
		});
		app.save(idem);
	}
}, (app) => {
	// Additive — no destructive down.
});
