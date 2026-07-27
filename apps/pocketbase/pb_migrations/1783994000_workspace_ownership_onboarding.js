/// <reference path="../pb_data/types.d.ts" />
/**
 * Enterprise Workspace Phase 2:
 * - workspace / created_by / last_edited_by on content collections
 * - optional user on invitations (invite-before-signup)
 * - workspace_onboarding + workspace_audit collections
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

const CONTENT_COLLECTIONS = [
	"articles",
	"pins",
	"ai_pins",
	"ai_pin_image_jobs",
	"ai_pin_generation_history",
	"ai_pin_templates",
	"brand_kits",
	"websites",
	"wordpress_sites",
	"pinterest_accounts",
	"pinterest_boards",
	"pinterest_publish_jobs",
	"pinterest_publish_history",
	"publish_jobs",
	"publish_history",
	"queue_jobs",
];

migrate((app) => {
	const workspaces = findCollectionSafe(app, "workspaces");
	const users = findCollectionSafe(app, "users");
	if (!workspaces || !users) return;

	// Make membership.user optional so invites work before signup.
	const members = findCollectionSafe(app, "workspace_members");
	if (members) {
		let dirty = false;
		const userField = members.fields.getByName("user");
		if (userField && userField.required) {
			userField.required = false;
			dirty = true;
		}
		dirty = ensureField(members, { name: "invite_sent_at", type: "date" }) || dirty;
		dirty = ensureField(members, { name: "invite_resent_count", type: "number" }) || dirty;
		if (dirty) app.save(members);
	}

	for (const name of CONTENT_COLLECTIONS) {
		const collection = findCollectionSafe(app, name);
		if (!collection) continue;
		let dirty = false;
		dirty = ensureField(collection, relationField("workspace", workspaces.id, { required: false })) || dirty;
		dirty = ensureField(collection, relationField("created_by", users.id, { required: false })) || dirty;
		dirty = ensureField(collection, relationField("last_edited_by", users.id, { required: false })) || dirty;
		if (dirty) app.save(collection);
	}

	// Onboarding progress (one row per workspace)
	if (!findCollectionSafe(app, "workspace_onboarding")) {
		const onboarding = new Collection({
			type: "base",
			name: "workspace_onboarding",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				toField(relationField("workspace", workspaces.id, { required: true, cascadeDelete: true })),
				toField({ name: "steps", type: "json" }),
				toField({ name: "completed_percent", type: "number" }),
				toField({ name: "skipped", type: "bool" }),
				toField({ name: "completed_at", type: "date" }),
				toField(relationField("updated_by", users.id)),
				toField({ name: "created", type: "autodate", onCreate: true, onUpdate: false }),
				toField({ name: "updated", type: "autodate", onCreate: true, onUpdate: true }),
			],
			indexes: [
				"CREATE UNIQUE INDEX `idx_workspace_onboarding_ws` ON `workspace_onboarding` (`workspace`)",
			],
		});
		app.save(onboarding);
	}

	// Structured audit trail
	if (!findCollectionSafe(app, "workspace_audit")) {
		const audit = new Collection({
			type: "base",
			name: "workspace_audit",
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				toField(relationField("workspace", workspaces.id, { required: true, cascadeDelete: true })),
				toField(relationField("actor", users.id)),
				toField({
					name: "action",
					type: "select",
					maxSelect: 1,
					values: [
						"created",
						"updated",
						"deleted",
						"published",
						"credits_used",
						"billing",
						"role_change",
						"invitation",
						"ownership_transfer",
						"login",
						"other",
					],
				}),
				toField({ name: "resource_type", type: "text", max: 80 }),
				toField({ name: "resource_id", type: "text", max: 64 }),
				toField({ name: "title", type: "text", max: 300 }),
				toField({ name: "summary", type: "text", max: 1000 }),
				toField({ name: "meta", type: "json" }),
				toField({ name: "created", type: "autodate", onCreate: true, onUpdate: false }),
			],
			indexes: [
				"CREATE INDEX `idx_workspace_audit_ws_created` ON `workspace_audit` (`workspace`, `created`)",
				"CREATE INDEX `idx_workspace_audit_action` ON `workspace_audit` (`workspace`, `action`)",
			],
		});
		app.save(audit);
	}

	// Health cache fields on workspaces metadata already JSON — add optional columns
	let wsDirty = false;
	wsDirty = ensureField(workspaces, { name: "health_score", type: "number" }) || wsDirty;
	wsDirty = ensureField(workspaces, { name: "health_label", type: "text", max: 32 }) || wsDirty;
	wsDirty = ensureField(workspaces, { name: "onboarding_completed", type: "bool" }) || wsDirty;
	if (wsDirty) app.save(workspaces);
}, (app) => {
	// Additive — no destructive down.
});
