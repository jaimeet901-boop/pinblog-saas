/// <reference path="../pb_data/types.d.ts" />
/**
 * Enterprise Workspace Management:
 * - expand member roles (administrator, custom)
 * - suspend member status
 * - invitation fields + custom permissions
 * - workspace_roles catalog for custom roles
 *
 * Fully idempotent for EXISTING production databases:
 * - Before adding a field, detect it in collection schema AND SQLite
 * - If it already exists anywhere, skip (never recreate / never ALTER)
 * - Same for indexes
 * - Never delete/recreate collections
 * - Never modify production row data
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
		if (typeof field.getName === "function") {
			const n = field.getName();
			if (n != null && String(n) !== "") return String(n);
		}
	} catch (_) {
		// ignore
	}
	try {
		if (field.name != null && String(field.name) !== "") return String(field.name);
	} catch (_) {
		// ignore
	}
	return "";
}

function collectionHasField(collection, name) {
	if (!collection || !name) return false;
	try {
		if (collection.fields?.getByName?.(name)) return true;
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

function addColumnName(set, name) {
	const key = String(name || "").trim();
	if (key) set[key] = true;
}

/**
 * Build a set of existing SQLite column names for a table.
 * Uses several detection strategies so production upgrades never miss columns.
 */
function listSqliteColumns(app, tableName) {
	const set = {};
	if (!app || !tableName) return set;

	try {
		if (typeof app.tableColumns === "function") {
			const cols = app.tableColumns(tableName) || [];
			for (let i = 0; i < cols.length; i += 1) addColumnName(set, cols[i]);
		}
	} catch (_) {
		// ignore
	}

	try {
		if (typeof app.tableInfo === "function") {
			const info = app.tableInfo(tableName) || [];
			for (let i = 0; i < info.length; i += 1) addColumnName(set, info[i]?.name);
		}
	} catch (_) {
		// ignore
	}

	const pragmaQueries = [
		"SELECT name FROM PRAGMA_TABLE_INFO({:table})",
		"SELECT name FROM pragma_table_info({:table})",
	];
	for (let q = 0; q < pragmaQueries.length; q += 1) {
		try {
			const rows = arrayOf(new DynamicModel({ name: "" }));
			app.db().newQuery(pragmaQueries[q]).bind({ table: tableName }).all(rows);
			for (let i = 0; i < rows.length; i += 1) addColumnName(set, rows[i]?.name);
		} catch (_) {
			// ignore
		}
	}

	try {
		const safeTable = String(tableName).replace(/'/g, "''");
		const rows = arrayOf(new DynamicModel({ name: "" }));
		app.db().newQuery(`PRAGMA table_info('${safeTable}')`).all(rows);
		for (let i = 0; i < rows.length; i += 1) addColumnName(set, rows[i]?.name);
	} catch (_) {
		// ignore
	}

	return set;
}

/**
 * Probe a single column via SELECT. If the statement prepares/runs, the column exists.
 */
function sqliteColumnSelectable(app, tableName, columnName) {
	try {
		const safeTable = String(tableName).replace(/"/g, '""');
		const safeColumn = String(columnName).replace(/"/g, '""');
		app.db().newQuery(`SELECT "${safeColumn}" FROM "${safeTable}" LIMIT 0`).all(arrayOf(new DynamicModel({})));
		return true;
	} catch (_) {
		try {
			const safeTable = String(tableName).replace(/"/g, '""');
			const safeColumn = String(columnName).replace(/"/g, '""');
			app.db().newQuery(`SELECT "${safeColumn}" FROM "${safeTable}" LIMIT 0`).one();
			return true;
		} catch (__) {
			return false;
		}
	}
}

function columnAlreadyExists(app, collection, tableName, columnName, sqliteColumns) {
	if (collectionHasField(collection, columnName)) return true;
	if (sqliteColumns && sqliteColumns[columnName]) return true;
	if (sqliteColumnSelectable(app, tableName, columnName)) return true;
	return false;
}

function collectionHasIndexMarker(collection, marker) {
	const indexes = Array.isArray(collection?.indexes) ? collection.indexes : [];
	return indexes.some((sql) => String(sql).includes(marker));
}

function ensureIndexIdempotent(collection, sql) {
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
	let field = null;
	try {
		field = collection.fields.getByName(fieldName);
	} catch (_) {
		field = null;
	}
	if (!field || field.type !== "select") return false;
	if (selectValuesEqual(field.values, nextValues)) return false;
	field.values = nextValues.slice();
	return true;
}

const MEMBER_TABLE = "workspace_members";
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

const WORKSPACE_ROLES_INDEX_SQL =
	"CREATE UNIQUE INDEX `idx_workspace_roles_slug` ON `workspace_roles` (`workspace`, `slug`)";

/**
 * Add only fields that are missing from BOTH schema and SQLite.
 * Saves one field at a time. On duplicate-column errors, skips (idempotent).
 * Never renames/drops columns and never mutates row data.
 */
function ensureMemberFieldsIdempotent(app) {
	const sqliteColumns = listSqliteColumns(app, MEMBER_TABLE);

	// Pre-probe known fields so detection is reliable even if PRAGMA fails.
	for (let i = 0; i < MEMBER_FIELDS.length; i += 1) {
		const name = MEMBER_FIELDS[i].name;
		if (sqliteColumnSelectable(app, MEMBER_TABLE, name)) {
			sqliteColumns[name] = true;
		}
	}

	for (let i = 0; i < MEMBER_FIELDS.length; i += 1) {
		const def = MEMBER_FIELDS[i];

		// Always reload so in-memory adds from a failed save cannot accumulate.
		const collection = findCollectionSafe(app, MEMBER_TABLE);
		if (!collection) return;

		if (columnAlreadyExists(app, collection, MEMBER_TABLE, def.name, sqliteColumns)) {
			continue;
		}

		collection.fields.add(toField(def));
		try {
			app.save(collection);
			sqliteColumns[def.name] = true;
		} catch (error) {
			const message = String(error?.message || error || "");
			if (/duplicate column name/i.test(message)) {
				// Column already present in SQLite — treat as applied, do not modify data.
				sqliteColumns[def.name] = true;
				continue;
			}
			throw error;
		}
	}
}

migrate((app) => {
	const members = findCollectionSafe(app, MEMBER_TABLE);
	if (members) {
		// Reload a clean collection instance for select-value updates only.
		const forSelects = findCollectionSafe(app, MEMBER_TABLE);
		let selectDirty = false;
		selectDirty = ensureSelectValues(
			forSelects,
			"role",
			["owner", "administrator", "editor", "author", "viewer", "custom"],
		) || selectDirty;
		selectDirty = ensureSelectValues(
			forSelects,
			"status",
			["active", "invited", "suspended", "removed"],
		) || selectDirty;
		if (selectDirty) {
			try {
				app.save(forSelects);
			} catch (error) {
				const message = String(error?.message || error || "");
				// Select-only updates must never fail the upgrade on duplicate columns.
				if (!/duplicate column name/i.test(message)) throw error;
			}
		}

		ensureMemberFieldsIdempotent(app);
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
				users
					? toField(relationField("created_by", users.id))
					: toField({ name: "created_by", type: "text", max: 64 }),
				toField({ name: "created", type: "autodate", onCreate: true, onUpdate: false }),
				toField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true }),
			],
			indexes: [WORKSPACE_ROLES_INDEX_SQL],
		});
		app.save(roles);
	} else if (roles) {
		// Existing collection: only add missing index, never recreate collection.
		if (!collectionHasIndexMarker(roles, "idx_workspace_roles_slug")) {
			if (ensureIndexIdempotent(roles, WORKSPACE_ROLES_INDEX_SQL)) {
				try {
					app.save(roles);
				} catch (error) {
					const message = String(error?.message || error || "");
					if (!/already exists|duplicate/i.test(message)) throw error;
				}
			}
		}
	}
}, (app) => {
	// Additive — no destructive down.
});
