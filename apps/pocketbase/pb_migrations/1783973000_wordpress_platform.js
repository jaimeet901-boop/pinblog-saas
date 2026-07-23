/// <reference path="../pb_data/types.d.ts" />
/**
 * WordPress platform hardening:
 * - auth_type on credentials (application_password | basic)
 * - wp_version / endpoint cache on sites
 * - wordpress_api_logs for every REST attempt
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
	}
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

const AUTODATE_FIELDS = [
	{ name: "created", type: "autodate", onCreate: true, onUpdate: false },
	{ name: "updated", type: "autodate", onCreate: true, onUpdate: true },
];

migrate(
	(app) => {
		const sites = findCollectionSafe(app, "wordpress_sites");
		if (sites) {
			ensureField(sites, { type: "text", name: "wp_version", max: 80 });
			ensureField(sites, { type: "json", name: "endpoints", maxSize: 200000 });
			ensureField(sites, { type: "text", name: "auth_type", max: 40 });
			app.save(sites);
		}

		const credentials = findCollectionSafe(app, "wordpress_credentials");
		if (credentials) {
			ensureField(credentials, {
				type: "select",
				name: "auth_type",
				maxSelect: 1,
				values: ["application_password", "basic"],
			});
			app.save(credentials);
		}

		if (!findCollectionSafe(app, "wordpress_api_logs")) {
			const users = findCollectionSafe(app, "users");
			const fields = [
				...(users ? [relationField("owner", users.id, { cascadeDelete: true })] : [{ type: "text", name: "owner", max: 80 }]),
				{ type: "text", name: "workspace_key", max: 120 },
				{ type: "text", name: "site_id", max: 80 },
				{ type: "text", name: "job_id", max: 80 },
				{ type: "text", name: "method", max: 20 },
				{ type: "text", name: "path", max: 1000 },
				{ type: "number", name: "status_code", min: 0 },
				{ type: "number", name: "duration_ms", min: 0 },
				{ type: "bool", name: "ok" },
				{ type: "text", name: "error", max: 4000 },
				{ type: "json", name: "request_meta", maxSize: 100000 },
				{ type: "json", name: "response_meta", maxSize: 200000 },
			].concat(AUTODATE_FIELDS).map(toField);

			if (sites) {
				fields.splice(2, 0, toField(relationField("site", sites.id, { cascadeDelete: true })));
			}

			const collection = new Collection({
				type: "base",
				name: "wordpress_api_logs",
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: [
					"CREATE INDEX `idx_wordpress_api_logs_owner` ON `wordpress_api_logs` (`owner`)",
					"CREATE INDEX `idx_wordpress_api_logs_site` ON `wordpress_api_logs` (`site_id`)",
					"CREATE INDEX `idx_wordpress_api_logs_created` ON `wordpress_api_logs` (`created`)",
				],
				fields,
			});
			app.save(collection);
		}
	},
	(app) => {
		const logs = findCollectionSafe(app, "wordpress_api_logs");
		if (logs) app.delete(logs);
	},
);
