/// <reference path="../pb_data/types.d.ts" />
/**
 * Workspace tenancy: workspaces, members, settings, activity, notifications, calendar.
 * API-only — managed via apps/api superuser client with membership checks.
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
		if (findCollectionSafe(app, "workspaces")) {
			return;
		}

		const users = app.findCollectionByNameOrId("users");

		const workspaces = saveSchemaCollection(
			app,
			newBaseCollection(
				"workspaces",
				[
					{ type: "text", name: "name", required: true, max: 200 },
					{ type: "text", name: "slug", required: true, max: 120 },
					{ type: "text", name: "workspace_key", required: true, max: 120 },
					relationField("owner", users.id, { required: true, cascadeDelete: false }),
					{
						type: "select",
						name: "status",
						maxSelect: 1,
						values: ["active", "trial", "suspended", "closed"],
					},
					{ type: "text", name: "plan_slug", max: 64 },
					{ type: "text", name: "billing_email", max: 255 },
					{ type: "json", name: "metadata", maxSize: 100000 },
				],
				[
					"CREATE UNIQUE INDEX `idx_workspaces_slug` ON `workspaces` (`slug`)",
					"CREATE UNIQUE INDEX `idx_workspaces_key` ON `workspaces` (`workspace_key`)",
					"CREATE INDEX `idx_workspaces_owner` ON `workspaces` (`owner`)",
					"CREATE INDEX `idx_workspaces_status` ON `workspaces` (`status`)",
				],
			),
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"workspace_members",
				[
					relationField("workspace", workspaces.id, { required: true, cascadeDelete: true }),
					relationField("user", users.id, { required: true, cascadeDelete: true }),
					{
						type: "select",
						name: "role",
						required: true,
						maxSelect: 1,
						values: ["owner", "editor", "author", "viewer"],
					},
					{
						type: "select",
						name: "status",
						maxSelect: 1,
						values: ["active", "invited", "removed"],
					},
					relationField("invited_by", users.id, { cascadeDelete: false }),
					{ type: "date", name: "joined_at" },
				],
				[
					"CREATE UNIQUE INDEX `idx_workspace_members_unique` ON `workspace_members` (`workspace`, `user`)",
					"CREATE INDEX `idx_workspace_members_user` ON `workspace_members` (`user`)",
				],
			),
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"workspace_settings",
				[
					relationField("workspace", workspaces.id, { required: true, cascadeDelete: true }),
					{ type: "json", name: "prefs", maxSize: 200000 },
					{ type: "json", name: "notification_prefs", maxSize: 50000 },
					{ type: "json", name: "defaults", maxSize: 50000 },
				],
				["CREATE UNIQUE INDEX `idx_workspace_settings_ws` ON `workspace_settings` (`workspace`)"],
			),
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"workspace_activity",
				[
					relationField("workspace", workspaces.id, { required: true, cascadeDelete: true }),
					relationField("user", users.id, { cascadeDelete: false }),
					{ type: "text", name: "type", required: true, max: 80 },
					{ type: "text", name: "title", required: true, max: 300 },
					{ type: "text", name: "summary", max: 1000 },
					{ type: "json", name: "meta", maxSize: 100000 },
					{
						type: "select",
						name: "tone",
						maxSelect: 1,
						values: ["default", "green", "amber", "red"],
					},
				],
				[
					"CREATE INDEX `idx_workspace_activity_ws_created` ON `workspace_activity` (`workspace`, `created`)",
					"CREATE INDEX `idx_workspace_activity_type` ON `workspace_activity` (`type`)",
				],
			),
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"workspace_notifications",
				[
					relationField("workspace", workspaces.id, { required: true, cascadeDelete: true }),
					relationField("user", users.id, { cascadeDelete: false }),
					{ type: "text", name: "title", required: true, max: 300 },
					{ type: "text", name: "body", max: 2000 },
					{
						type: "select",
						name: "priority",
						maxSelect: 1,
						values: ["low", "normal", "high", "critical"],
					},
					{
						type: "select",
						name: "channel",
						maxSelect: 1,
						values: ["in_app", "email"],
					},
					{ type: "date", name: "read_at" },
					{ type: "date", name: "dismissed_at" },
					{ type: "json", name: "meta", maxSize: 50000 },
				],
				[
					"CREATE INDEX `idx_workspace_notifications_ws` ON `workspace_notifications` (`workspace`, `created`)",
					"CREATE INDEX `idx_workspace_notifications_user` ON `workspace_notifications` (`user`)",
				],
			),
		);

		saveSchemaCollection(
			app,
			newBaseCollection(
				"calendar_events",
				[
					relationField("workspace", workspaces.id, { required: true, cascadeDelete: true }),
					relationField("owner", users.id, { required: true, cascadeDelete: false }),
					{ type: "text", name: "title", required: true, max: 300 },
					{ type: "text", name: "description", max: 2000 },
					{
						type: "select",
						name: "event_type",
						maxSelect: 1,
						values: ["publish", "schedule", "reminder", "other"],
					},
					{
						type: "select",
						name: "status",
						maxSelect: 1,
						values: ["scheduled", "publishing", "published", "failed", "cancelled"],
					},
					{ type: "date", name: "scheduled_at", required: true },
					{ type: "text", name: "timezone", max: 80 },
					{ type: "text", name: "ref_type", max: 80 },
					{ type: "text", name: "ref_id", max: 120 },
					{ type: "json", name: "meta", maxSize: 100000 },
				],
				[
					"CREATE INDEX `idx_calendar_events_ws_scheduled` ON `calendar_events` (`workspace`, `scheduled_at`)",
					"CREATE INDEX `idx_calendar_events_owner` ON `calendar_events` (`owner`)",
					"CREATE INDEX `idx_calendar_events_status` ON `calendar_events` (`status`)",
				],
			),
		);

		// Optional product templates catalog (categories) — complements ai_pin_templates.
		saveSchemaCollection(
			app,
			newBaseCollection(
				"templates",
				[
					relationField("workspace", workspaces.id, { required: true, cascadeDelete: true }),
					relationField("owner", users.id, { required: true, cascadeDelete: false }),
					{ type: "text", name: "name", required: true, max: 180 },
					{
						type: "select",
						name: "category",
						maxSelect: 1,
						values: ["prompt", "recipe", "seo", "pin", "custom"],
					},
					{ type: "text", name: "description", max: 1000 },
					{ type: "json", name: "content", maxSize: 300000 },
					{ type: "bool", name: "is_default" },
					{ type: "bool", name: "active" },
				],
				[
					"CREATE INDEX `idx_templates_workspace` ON `templates` (`workspace`)",
					"CREATE INDEX `idx_templates_owner` ON `templates` (`owner`)",
					"CREATE INDEX `idx_templates_category` ON `templates` (`category`)",
				],
			),
		);
	},
	(app) => {
		for (const name of [
			"templates",
			"calendar_events",
			"workspace_notifications",
			"workspace_activity",
			"workspace_settings",
			"workspace_members",
			"workspaces",
		]) {
			try {
				app.delete(app.findCollectionByNameOrId(name));
			} catch (_) {
				// ignore
			}
		}
	},
);
