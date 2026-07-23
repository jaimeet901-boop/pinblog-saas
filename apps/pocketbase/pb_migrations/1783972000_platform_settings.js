/// <reference path="../pb_data/types.d.ts" />
/**
 * Platform-wide Admin Console settings + notification history.
 * API-only collections — never exposed to workspace clients.
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

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

migrate(
	(app) => {
		if (!findCollectionSafe(app, "platform_settings")) {
			const fields = [
				{ type: "text", name: "config_key", required: true, max: 40 },
				{ type: "json", name: "payload", maxSize: 500000 },
				{ type: "text", name: "version", max: 40 },
				{ type: "json", name: "meta", maxSize: 100000 },
			].concat(AUTODATE_FIELDS).map(toField);

			const collection = new Collection({
				type: "base",
				name: "platform_settings",
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: [
					"CREATE UNIQUE INDEX `idx_platform_settings_key` ON `platform_settings` (`config_key`)",
				],
				fields,
			});
			app.save(collection);
		}

		if (!findCollectionSafe(app, "notification_history")) {
			const fields = [
				{ type: "text", name: "title", required: true, max: 300 },
				{ type: "text", name: "body", max: 4000 },
				{
					type: "select",
					name: "channel",
					required: true,
					maxSelect: 1,
					values: ["email", "in-app", "in_app", "system"],
				},
				{
					type: "select",
					name: "status",
					required: true,
					maxSelect: 1,
					values: ["queued", "sent", "failed", "draft", "active"],
				},
				{ type: "text", name: "audience", max: 200 },
				{ type: "text", name: "template_id", max: 80 },
				{ type: "date", name: "sent_at" },
				{ type: "json", name: "meta", maxSize: 100000 },
			].concat(AUTODATE_FIELDS).map(toField);

			const collection = new Collection({
				type: "base",
				name: "notification_history",
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: [
					"CREATE INDEX `idx_notification_history_status` ON `notification_history` (`status`)",
					"CREATE INDEX `idx_notification_history_created` ON `notification_history` (`created`)",
				],
				fields,
			});
			app.save(collection);
		}
	},
	(app) => {
		const history = findCollectionSafe(app, "notification_history");
		if (history) app.delete(history);
		const settings = findCollectionSafe(app, "platform_settings");
		if (settings) app.delete(settings);
	},
);
