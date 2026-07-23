/// <reference path="../pb_data/types.d.ts" />
/**
 * Admin console support: user status field + notification_templates.
 */

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

migrate(
	(app) => {
		const users = findCollectionSafe(app, "users");
		if (users) {
			const hasStatus = (users.fields || []).some((field) => field.name === "status");
			if (!hasStatus) {
				users.fields.push({
					type: "select",
					name: "status",
					maxSelect: 1,
					values: ["active", "invited", "suspended"],
				});
				app.save(users);
			}
		}

		if (!findCollectionSafe(app, "notification_templates")) {
			const collection = new Collection({
				type: "base",
				name: "notification_templates",
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: [
					"CREATE INDEX `idx_notification_templates_status` ON `notification_templates` (`status`)",
					"CREATE INDEX `idx_notification_templates_channel` ON `notification_templates` (`channel`)",
				],
				fields: [
					{ type: "text", name: "title", required: true, max: 300 },
					{ type: "text", name: "body", max: 4000 },
					{
						type: "select",
						name: "channel",
						required: true,
						maxSelect: 1,
						values: ["email", "in-app", "in_app"],
					},
					{
						type: "select",
						name: "status",
						required: true,
						maxSelect: 1,
						values: ["draft", "scheduled", "active"],
					},
					{ type: "date", name: "scheduled_at" },
					{ type: "json", name: "meta", maxSize: 100000 },
				].concat(AUTODATE_FIELDS),
			});
			app.save(collection);
		}
	},
	(app) => {
		const templates = findCollectionSafe(app, "notification_templates");
		if (templates) app.delete(templates);
	},
);
