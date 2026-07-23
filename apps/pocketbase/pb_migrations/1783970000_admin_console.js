/// <reference path="../pb_data/types.d.ts" />
/**
 * Admin console support: user status field + notification_templates.
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
		text: pickCtor(typeof TextField !== "undefined" ? TextField : null, coreNS.TextField),
		number: pickCtor(typeof NumberField !== "undefined" ? NumberField : null, coreNS.NumberField),
		bool: pickCtor(typeof BoolField !== "undefined" ? BoolField : null, coreNS.BoolField),
		select: pickCtor(typeof SelectField !== "undefined" ? SelectField : null, coreNS.SelectField),
		date: pickCtor(typeof DateField !== "undefined" ? DateField : null, coreNS.DateField),
		json: pickCtor(typeof JSONField !== "undefined" ? JSONField : null, coreNS.JSONField),
		autodate: pickCtor(typeof AutodateField !== "undefined" ? AutodateField : null, coreNS.AutodateField),
	};

	const Ctor = ctorByType[def.type];
	if (!Ctor) {
		throw new Error(`Unsupported migration field type: ${def.type}`);
	}
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
			ensureField(users, {
				type: "select",
				name: "status",
				maxSelect: 1,
				values: ["active", "invited", "suspended"],
			});
			app.save(users);
		}

		if (!findCollectionSafe(app, "notification_templates")) {
			const fields = [
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
			].concat(AUTODATE_FIELDS).map(toField);

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
				fields,
			});
			app.save(collection);
		}
	},
	(app) => {
		const templates = findCollectionSafe(app, "notification_templates");
		if (templates) app.delete(templates);

		const users = findCollectionSafe(app, "users");
		if (users) {
			const statusField = users.fields.getByName("status");
			if (statusField) {
				users.fields.removeByName("status");
				app.save(users);
			}
		}
	},
);
