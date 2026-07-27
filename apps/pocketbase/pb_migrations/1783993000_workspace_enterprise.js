/// <reference path="../pb_data/types.d.ts" />
/**
 * Enterprise Workspace Management:
 * - expand member roles (administrator, custom)
 * - suspend member status
 * - invitation fields + custom permissions
 * - workspace_roles catalog for custom roles
 *
 * Idempotent for production upgrades:
 * - Detect existing collection fields AND SQLite columns before adding
 * - Only create missing fields (never recreate)
 * - Preserve all production data
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

function fieldNameOf(field) {
	if (!field) return "";
	try {
		if (typeof field.getName === "function") return String(field.getName() || "");
	} catch (_) {
		// ignore
	}
	try {
		if (field.name != null) return String(field.name);
	} catch (_) {
		// ignore
	}
	return "";
}

/**
 * Detect whether a field already exists on the PocketBase collection schema.
 */
function collectionHasField(collection, name) {
	if (!collection || !name) return false;
	try {
		const found = collection.fields?.getByName?.(name);
		if (found) return true;
	} catch (_) {
		// ignore
	}
	try {
		const fields = collection.fields;
		const len = Number(fields?.length) || 0;
		for (let i = 0; i < len; i += 1) {
			let field = null;
			try {
				if (typeof fields.get === "function") field = fields.get(i);
				else if (typeof fields.getAt === "function") field = fields.getAt(i);
				else if (typeof fields.at === "function") field = fields.at(i);
				else field = fields[i];
			} catch (_) {
				field = null;
			}
			if (fieldNameOf(field) === name) return true;
		}
	} catch (_) {
		// ignore
	}
	return false;
}

/**
 * Detect whether a physical SQLite column already exists (partial migration / runtime ensure).
 */
function sqliteHasColumn(app, tableName, columnName) {
	if (!app || !tableName || !columnName) return false;
	try {
		if (typeof app.tableColumns === "function") {
			const cols = app.tableColumns(tableName) || [];
			return cols.some((col) => String(col) === columnName);
		}
	} catch (_) {
		// fall through to PRAGMA
	}

	try {
		const rows = arrayOf(new DynamicModel({ name: "" }));
		app.db()
			.newQuery("SELECT name FROM PRAGMA_TABLE_INFO({:table})")
			.bind({ table: tableName })
			.all(rows);
		for (let i = 0; i < rows.length; i += 1) {
			if (String(rows[i]?.name || "") === columnName) return true;
		}
		return false;
	} catch (_) {
		// ignore
	}

	try {
		const rows = arrayOf(new DynamicModel({ name: "" }));
		app.db().newQuery(`PRAGMA table_info('${String(tableName).replace(/'/g, "''")}')`).all(rows);
		for (let i = 0; i < rows.length; i += 1) {
			if (String(rows[i]?.name || "") === columnName) return true;
		}
		return false;
	} catch (_) {
		return false;
	}
}

function execSql(app, sql) {
	app.db().newQuery(sql).execute();
}

/**
 * When SQLite already has the column but collection meta does not, register the field
 * without hitting "duplicate column name" by rename → save → copy → drop.
 * Preserves all existing values.
 */
function syncExistingSqliteColumnIntoSchema(app, collectionName, def) {
	const column = def.name;
	const tmp = `${column}__pb_mig_tmp`;

	if (sqliteHasColumn(app, collectionName, tmp)) {
		throw new Error(`1783993000: temporary column ${tmp} already exists on ${collectionName}`);
	}

	execSql(
		app,
		`ALTER TABLE "${collectionName}" RENAME COLUMN "${column}" TO "${tmp}"`,
	);

	const collection = findCollectionSafe(app, collectionName);
	if (!collection) {
		throw new Error(`1783993000: collection ${collectionName} missing during field sync`);
	}
	if (!collectionHasField(collection, column)) {
		collection.fields.add(toField(def));
	}
	app.save(collection);

	execSql(
		app,
		`UPDATE "${collectionName}" SET "${column}" = "${tmp}"`,
	);

	try {
		execSql(app, `ALTER TABLE "${collectionName}" DROP COLUMN "${tmp}"`);
	} catch (_) {
		// Older SQLite without DROP COLUMN — leave tmp unused; data already copied.
	}

	return true;
}

/**
 * Idempotent field ensure:
 * 1) skip if collection schema already has the field
 * 2) skip/sync if SQLite column already exists
 * 3) otherwise add + save
 */
function ensureFieldIdempotent(app, collectionName, def) {
	const collection = findCollectionSafe(app, collectionName);
	if (!collection) return false;

	if (collectionHasField(collection, def.name)) {
		return false;
	}

	if (sqliteHasColumn(app, collectionName, def.name)) {
		return syncExistingSqliteColumnIntoSchema(app, collectionName, def);
	}

	const fresh = findCollectionSafe(app, collectionName);
	if (!fresh) return false;
	if (collectionHasField(fresh, def.name)) return false;

	fresh.fields.add(toField(def));
	try {
		app.save(fresh);
		return true;
	} catch (error) {
		const message = String(error?.message || error || "");
		if (/duplicate column name/i.test(message)) {
			// Race / partial apply — sync safely without losing data.
			return syncExistingSqliteColumnIntoSchema(app, collectionName, def);
		}
		throw error;
	}
}

function selectValuesEqual(current, next) {
	const a = Array.isArray(current) ? current.map(String) : [];
	const b = Array.isArray(next) ? next.map(String) : [];
	if (a.length !== b.length) return false;
	for (let i = 0; i < b.length; i += 1) {
		if (!a.includes(b[i])) return false;
	}
	return true;
}

function ensureSelectValues(collection, fieldName, nextValues) {
	const field = collection.fields.getByName(fieldName);
	if (!field || field.type !== "select") return false;
	const current = field.values;
	if (selectValuesEqual(current, nextValues)) return false;
	field.values = nextValues.slice();
	return true;
}

const MEMBER_FIELDS = [
	{ name: "permissions", type: "json" },
	{ name: "custom_role_name", type: "text", max: 80 },
	{ name: "invite_email", type: "text", max: 255 },
	{ name: "invite_token", type: "text", max: 120 },
	{ name: "invite_expires_at", type: "date" },
	{ name: "last_active_at", type: "date" },
	{ name: "suspended_at", type: "date" },
	{ name: "suspended_reason", type: "text", max: 500 },
];

migrate((app) => {
	const members = findCollectionSafe(app, "workspace_members");
	if (members) {
		let dirty = false;
		dirty = ensureSelectValues(
			members,
			"role",
			["owner", "administrator", "editor", "author", "viewer", "custom"],
		) || dirty;
		dirty = ensureSelectValues(
			members,
			"status",
			["active", "invited", "suspended", "removed"],
		) || dirty;
		if (dirty) app.save(members);

		// Add only fields that are missing from schema AND SQLite.
		for (const def of MEMBER_FIELDS) {
			ensureFieldIdempotent(app, "workspace_members", def);
		}
	}

	const workspaces = findCollectionSafe(app, "workspaces");
	const users = findCollectionSafe(app, "users");
	let roles = findCollectionSafe(app, "workspace_roles");
	if (!roles && workspaces) {
		roles = new Collection({
			type: "base",
			name: "workspace_roles",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				toField(relationField("workspace", workspaces.id, { required: true, cascadeDelete: true })),
				toField({ name: "name", type: "text", required: true, max: 80 }),
				toField({ name: "slug", type: "text", required: true, max: 64 }),
				toField({ name: "description", type: "text", max: 500 }),
				toField({ name: "permissions", type: "json" }),
				toField({ name: "is_system", type: "bool" }),
				toField({ name: "active", type: "bool" }),
				users ? toField(relationField("created_by", users.id)) : toField({ name: "created_by", type: "text", max: 64 }),
				toField({ name: "created", type: "autodate", onCreate: true, onUpdate: false }),
				toField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true }),
			],
			indexes: [
				"CREATE UNIQUE INDEX `idx_workspace_roles_slug` ON `workspace_roles` (`workspace`, `slug`)",
			],
		});
		app.save(roles);
	}
}, (app) => {
	// Additive — no destructive down.
});
