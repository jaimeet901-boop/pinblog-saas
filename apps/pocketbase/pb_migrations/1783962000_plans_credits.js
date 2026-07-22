/// <reference path="../pb_data/types.d.ts" />
/**
 * Plans, subscriptions, credit ledger, and workspace usage (Admin Console).
 * API-only — managed via apps/api superuser client.
 */

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

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

function saveSchemaCollection(app, collection) {
	collection.listRule = null;
	collection.viewRule = null;
	collection.createRule = null;
	collection.updateRule = null;
	collection.deleteRule = null;
	app.save(collection);
	return app.findCollectionByNameOrId(collection.id || collection.name);
}

function newBaseCollection(name, fields, indexes = []) {
	return new Collection({
		type: "base",
		name,
		listRule: null,
		viewRule: null,
		createRule: null,
		updateRule: null,
		deleteRule: null,
		indexes,
		fields: fields.concat(AUTODATE_FIELDS),
	});
}

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

migrate(
	(app) => {
		if (findCollectionSafe(app, "plans")) {
			return;
		}

		const plans = saveSchemaCollection(
			app,
			newBaseCollection(
				"plans",
				[
					{ type: "text", name: "name", required: true, max: 120 },
					{ type: "text", name: "slug", required: true, max: 64 },
					{ type: "text", name: "description", max: 2000 },
					{ type: "number", name: "monthly_price", min: 0 },
					{ type: "number", name: "yearly_price", min: 0 },
					{ type: "text", name: "currency", max: 8 },
					{ type: "bool", name: "active" },
					{ type: "number", name: "display_order", min: 0 },
					{ type: "number", name: "credits", min: 0 },
					{ type: "number", name: "bonus_credits", min: 0 },
					{ type: "bool", name: "rollover" },
					{ type: "bool", name: "topup_allowed" },
					{ type: "json", name: "limits", maxSize: 100000 },
					{ type: "json", name: "features", maxSize: 100000 },
					{ type: "text", name: "support", max: 120 },
					{ type: "text", name: "refill_policy", max: 500 },
					{ type: "text", name: "publishing_limits", max: 500 },
					{ type: "text", name: "ai_features", max: 500 },
					{ type: "text", name: "image_limits", max: 500 },
					{ type: "text", name: "ai_models", max: 500 },
					{ type: "bool", name: "highlight" },
					{
						type: "select",
						name: "status",
						maxSelect: 1,
						values: ["active", "deprecated", "hidden"],
					},
				],
				[
					"CREATE UNIQUE INDEX `idx_plans_slug` ON `plans` (`slug`)",
					"CREATE INDEX `idx_plans_active` ON `plans` (`active`)",
					"CREATE INDEX `idx_plans_display_order` ON `plans` (`display_order`)",
				],
			),
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"workspace_subscriptions",
				[
					{ type: "text", name: "workspace_key", required: true, max: 120 },
					{ type: "text", name: "workspace_name", required: true, max: 200 },
					{ type: "text", name: "owner_email", max: 255 },
					relationField("plan", plans.id, { required: true, cascadeDelete: false }),
					{
						type: "select",
						name: "status",
						maxSelect: 1,
						values: ["trialing", "active", "past_due", "canceled"],
					},
					{ type: "number", name: "seats", min: 1 },
					{ type: "date", name: "current_period_start" },
					{ type: "date", name: "current_period_end" },
					{ type: "number", name: "credits_balance", min: 0 },
				],
				[
					"CREATE UNIQUE INDEX `idx_workspace_subscriptions_key` ON `workspace_subscriptions` (`workspace_key`)",
					"CREATE INDEX `idx_workspace_subscriptions_plan` ON `workspace_subscriptions` (`plan`)",
					"CREATE INDEX `idx_workspace_subscriptions_status` ON `workspace_subscriptions` (`status`)",
				],
			),
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"credit_transactions",
				[
					{ type: "text", name: "workspace_key", required: true, max: 120 },
					{ type: "text", name: "workspace_name", max: 200 },
					{ type: "number", name: "amount", required: true },
					{
						type: "select",
						name: "type",
						required: true,
						maxSelect: 1,
						values: ["grant", "burn", "refund", "adjust", "expire", "topup"],
					},
					{ type: "text", name: "reason", max: 500 },
					{ type: "number", name: "balance", min: 0 },
					{ type: "text", name: "created_by", max: 120 },
					{ type: "json", name: "metadata", maxSize: 50000 },
				],
				[
					"CREATE INDEX `idx_credit_transactions_workspace` ON `credit_transactions` (`workspace_key`)",
					"CREATE INDEX `idx_credit_transactions_type` ON `credit_transactions` (`type`)",
					"CREATE INDEX `idx_credit_transactions_created` ON `credit_transactions` (`created`)",
				],
			),
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"workspace_usage",
				[
					{ type: "text", name: "workspace_key", required: true, max: 120 },
					{ type: "text", name: "workspace_name", max: 200 },
					{ type: "text", name: "period", required: true, max: 16 },
					{ type: "number", name: "articles", min: 0 },
					{ type: "number", name: "images", min: 0 },
					{ type: "number", name: "tokens", min: 0 },
					{ type: "number", name: "queue_jobs", min: 0 },
					{ type: "number", name: "publishing", min: 0 },
					{ type: "number", name: "api_calls", min: 0 },
					{ type: "number", name: "credits_burned", min: 0 },
				],
				[
					"CREATE UNIQUE INDEX `idx_workspace_usage_period` ON `workspace_usage` (`workspace_key`, `period`)",
					"CREATE INDEX `idx_workspace_usage_period_only` ON `workspace_usage` (`period`)",
				],
			),
		);
	},
	(app) => {
		for (const name of ["workspace_usage", "credit_transactions", "workspace_subscriptions", "plans"]) {
			const collection = findCollectionSafe(app, name);
			if (collection) app.delete(collection);
		}
	},
);
