/// <reference path="../pb_data/types.d.ts" />
/**
 * Enterprise Workspace Management:
 * - expand member roles (administrator, custom)
 * - suspend member status
 * - invitation fields + custom permissions
 * - workspace_roles catalog for custom roles
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
		return true;
	}
	return false;
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

migrate((app) => {
	const members = findCollectionSafe(app, "workspace_members");
	if (members) {
		let dirty = false;
		const roleField = members.fields.getByName("role");
		if (roleField && roleField.type === "select") {
			roleField.values = ["owner", "administrator", "editor", "author", "viewer", "custom"];
			dirty = true;
		}
		const statusField = members.fields.getByName("status");
		if (statusField && statusField.type === "select") {
			statusField.values = ["active", "invited", "suspended", "removed"];
			dirty = true;
		}
		dirty = ensureField(members, { name: "permissions", type: "json" }) || dirty;
		dirty = ensureField(members, { name: "custom_role_name", type: "text", max: 80 }) || dirty;
		dirty = ensureField(members, { name: "invite_email", type: "text", max: 255 }) || dirty;
		dirty = ensureField(members, { name: "invite_token", type: "text", max: 120 }) || dirty;
		dirty = ensureField(members, { name: "invite_expires_at", type: "date" }) || dirty;
		dirty = ensureField(members, { name: "last_active_at", type: "date" }) || dirty;
		dirty = ensureField(members, { name: "suspended_at", type: "date" }) || dirty;
		dirty = ensureField(members, { name: "suspended_reason", type: "text", max: 500 }) || dirty;
		if (dirty) app.save(members);
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
