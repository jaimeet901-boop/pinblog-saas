/// <reference path="../pb_data/types.d.ts" />
/**
 * Paddle Billing Rewrite — Phase 1
 *
 * Schema foundations only:
 * - plans.billing_type
 * - workspace_subscriptions Paddle/billing metadata fields
 * - billing_price_registry collection
 * - billing_webhook_events collection
 *
 * Does NOT change runtime checkout, webhook, or scheduler behavior.
 */

const coreNS = typeof core !== "undefined" ? core : {};

const PAID_CATALOG_SLUGS = Object.freeze(["starter", "pro", "business", "enterprise"]);

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
	const marker = String(sql).match(/`(idx_[^`]+)`/);
	if (marker && indexes.some((existing) => String(existing).includes(marker[1]))) {
		return false;
	}
	indexes.push(sql);
	collection.indexes = indexes;
	return true;
}

function applyApiOnlyRules(collection) {
	if (!collection) return;
	collection.listRule = null;
	collection.viewRule = null;
	collection.createRule = null;
	collection.updateRule = null;
	collection.deleteRule = null;
}

function resolveBillingTypeFromPlanRecord(record) {
	const slug = String(record.get("slug") || "").trim().toLowerCase();
	const monthly = Number(record.get("monthly_price")) || 0;
	const yearly = Number(record.get("yearly_price")) || 0;

	if (slug === "free") return "free";
	if (monthly > 0 || yearly > 0) return "paid";
	if (PAID_CATALOG_SLUGS.includes(slug)) return "paid";
	return "free";
}

function backfillPlanBillingTypes(app) {
	const plans = findCollectionSafe(app, "plans");
	if (!plans || !plans.fields.getByName("billing_type")) return { updated: 0, ambiguous: [] };

	let records = [];
	try {
		records = app.findRecordsByFilter("plans", "", "-created", 0, 0) || [];
	} catch (_) {
		return { updated: 0, ambiguous: [] };
	}

	let updated = 0;
	const ambiguous = [];

	for (const record of records) {
		const slug = String(record.get("slug") || "").trim().toLowerCase();
		const monthly = Number(record.get("monthly_price")) || 0;
		const yearly = Number(record.get("yearly_price")) || 0;
		const current = String(record.get("billing_type") || "").trim();

		if (current === "free" || current === "paid") continue;

		const next = resolveBillingTypeFromPlanRecord(record);
		if (
			next === "free"
			&& PAID_CATALOG_SLUGS.includes(slug)
			&& monthly <= 0
			&& yearly <= 0
		) {
			ambiguous.push(slug);
		}

		record.set("billing_type", next);
		try {
			app.save(record);
			updated += 1;
		} catch (_) {
			try {
				app.saveNoValidate(record);
				updated += 1;
			} catch (__) {
				// Skip row; do not fail migration.
			}
		}
	}

	return { updated, ambiguous };
}

const SUBSCRIPTION_BILLING_FIELDS = [
	{ name: "paddle_customer_id", type: "text", max: 120 },
	{ name: "paddle_subscription_id", type: "text", max: 120 },
	{ name: "paddle_transaction_id", type: "text", max: 120 },
	{ name: "paddle_price_id", type: "text", max: 120 },
	{
		name: "billing_interval",
		type: "select",
		maxSelect: 1,
		values: ["monthly", "yearly"],
	},
	{
		name: "billing_environment",
		type: "select",
		maxSelect: 1,
		values: ["sandbox", "live"],
	},
	{
		name: "activation_source",
		type: "select",
		maxSelect: 1,
		values: ["paddle_webhook", "admin_override", "free", "seed", "scheduler"],
	},
	{ name: "last_webhook_event_id", type: "text", max: 180 },
	{ name: "last_verified_at", type: "date" },
	{ name: "entitlement_sync_version", type: "number", min: 0 },
	{ name: "last_entitlement_sync_at", type: "date" },
	{
		name: "billing_source",
		type: "select",
		maxSelect: 1,
		values: ["paddle", "admin_override", "free", "seed", "system"],
	},
	{ name: "override_actor", type: "text", max: 120 },
	{ name: "override_reason", type: "text", max: 500 },
];

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

const REGISTRY_FIELDS = [
	{ type: "select", name: "provider", required: true, maxSelect: 1, values: ["stripe", "paddle", "lemonsqueezy", "paypal"] },
	{ type: "select", name: "environment", required: true, maxSelect: 1, values: ["sandbox", "live"] },
	// Optional in API, but writers must send '' (not omit) for the unused dimension.
	// UNIQUE index uses COALESCE so NULL/omitted values cannot bypass deduplication.
	{ type: "text", name: "plan_slug", max: 64 },
	{ type: "text", name: "pack_id", max: 64 },
	{ type: "select", name: "interval", required: true, maxSelect: 1, values: ["monthly", "yearly", "one_time"] },
	{ type: "text", name: "price_id", required: true, max: 180 },
	{ type: "bool", name: "active" },
	{ type: "text", name: "notes", max: 500 },
];

const REGISTRY_INDEXES = [
	"CREATE UNIQUE INDEX `idx_billing_price_registry_logical_key` ON `billing_price_registry` (`provider`, `environment`, COALESCE(`plan_slug`, ''), `interval`, COALESCE(`pack_id`, ''))",
	"CREATE INDEX `idx_billing_price_registry_plan` ON `billing_price_registry` (`plan_slug`, `environment`, `provider`)",
	"CREATE INDEX `idx_billing_price_registry_active` ON `billing_price_registry` (`active`)",
];

const WEBHOOK_EVENT_FIELDS = [
	{ type: "select", name: "provider", required: true, maxSelect: 1, values: ["stripe", "paddle", "lemonsqueezy", "paypal", "none"] },
	{ type: "text", name: "event_id", required: true, max: 180 },
	{ type: "text", name: "event_type", max: 120 },
	{ type: "text", name: "transaction_id", max: 120 },
	{ type: "text", name: "subscription_id", max: 120 },
	{ type: "text", name: "workspace_key", max: 120 },
	{
		type: "select",
		name: "status",
		required: true,
		maxSelect: 1,
		values: ["received", "processing", "processed", "failed", "ignored", "duplicate"],
	},
	{ type: "json", name: "payload", maxSize: 200000 },
	{ type: "date", name: "processed_at" },
	{ type: "text", name: "error", max: 1000 },
];

const WEBHOOK_EVENT_INDEXES = [
	"CREATE UNIQUE INDEX `idx_billing_webhook_events_provider_event` ON `billing_webhook_events` (`provider`, `event_id`)",
	"CREATE INDEX `idx_billing_webhook_events_workspace` ON `billing_webhook_events` (`workspace_key`, `created`)",
	"CREATE INDEX `idx_billing_webhook_events_status` ON `billing_webhook_events` (`status`, `created`)",
];

function ensureSchemaCollection(app, name, fieldDefs, indexDefs) {
	let collection = findCollectionSafe(app, name);
	let dirty = false;

	if (!collection) {
		collection = new Collection({
			type: "base",
			name,
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: fieldDefs.concat(AUTODATE_FIELDS),
			indexes: indexDefs,
		});
		app.save(collection);
		return collection;
	}

	for (const def of fieldDefs) {
		dirty = ensureField(collection, def) || dirty;
	}
	for (const sql of indexDefs) {
		dirty = ensureIndex(collection, sql) || dirty;
	}
	if (dirty) {
		applyApiOnlyRules(collection);
		app.save(collection);
	}

	return collection;
}

function ensureBillingPriceRegistry(app) {
	return ensureSchemaCollection(app, "billing_price_registry", REGISTRY_FIELDS, REGISTRY_INDEXES);
}

function ensureBillingWebhookEvents(app) {
	return ensureSchemaCollection(app, "billing_webhook_events", WEBHOOK_EVENT_FIELDS, WEBHOOK_EVENT_INDEXES);
}

migrate(
	(app) => {
		const plans = findCollectionSafe(app, "plans");
		if (plans) {
			let dirty = false;
			dirty = ensureField(plans, {
				name: "billing_type",
				type: "select",
				maxSelect: 1,
				values: ["free", "paid"],
			}) || dirty;
			if (dirty) {
				applyApiOnlyRules(plans);
				app.save(plans);
			}
		}

		const subs = findCollectionSafe(app, "workspace_subscriptions");
		if (subs) {
			let dirty = false;
			for (const def of SUBSCRIPTION_BILLING_FIELDS) {
				dirty = ensureField(subs, def) || dirty;
			}
			if (dirty) {
				applyApiOnlyRules(subs);
				app.save(subs);
			}
		}

		ensureBillingPriceRegistry(app);
		ensureBillingWebhookEvents(app);

		backfillPlanBillingTypes(app);
	},
	(app) => {
		// Additive schema — no destructive down.
		void app;
	},
);
