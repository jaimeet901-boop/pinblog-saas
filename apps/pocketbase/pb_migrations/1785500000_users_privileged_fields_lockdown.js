/// <reference path="../pb_data/types.d.ts" />
/**
 * Critical #2 — Lock privileged users fields from client PocketBase SDK.
 *
 * Direct authenticated PATCH/CREATE must not set role, plan, status, credit
 * counters, or verified. Express API uses the superuser client and bypasses rules.
 *
 * Keep rule strings aligned with apps/api/src/services/users-privileged-fields.js
 */

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

const LIST_RULE = "id = @request.auth.id || @request.auth.role = 'admin'";
const VIEW_RULE = LIST_RULE;
const DELETE_RULE = "id = @request.auth.id";

const UPDATE_RULE = [
	"id = @request.auth.id",
	"@request.body.role:isset = false",
	"@request.body.plan:isset = false",
	"@request.body.status:isset = false",
	"@request.body.ai_credits_used:isset = false",
	"@request.body.image_credits_used:isset = false",
	"@request.body.verified:isset = false",
	"@request.body.credits:isset = false",
].join(" && ");

const CREATE_RULE = [
	"(@request.body.role:isset = false || @request.body.role = 'member')",
	"(@request.body.plan:isset = false || @request.body.plan = 'free')",
	"@request.body.status:isset = false",
	"@request.body.ai_credits_used:isset = false",
	"@request.body.image_credits_used:isset = false",
	"@request.body.credits:isset = false",
	"(@request.body.verified:isset = false || @request.body.verified = false)",
].join(" && ");

function applyFieldDefaults(collection) {
	const plan = collection.fields.getByName("plan");
	if (plan) {
		try {
			plan.required = false;
			if (typeof plan.defaultValue !== "undefined") {
				plan.defaultValue = "free";
			}
		} catch (_) {
			/* ignore */
		}
	}
	const role = collection.fields.getByName("role");
	if (role) {
		try {
			role.required = false;
			if (typeof role.defaultValue !== "undefined") {
				role.defaultValue = "member";
			}
		} catch (_) {
			/* ignore */
		}
	}
}

migrate(
	(app) => {
		const users = findCollectionSafe(app, "users");
		if (!users) {
			throw new Error("users collection missing — cannot apply privileged-field lockdown");
		}

		applyFieldDefaults(users);

		users.listRule = LIST_RULE;
		users.viewRule = VIEW_RULE;
		users.createRule = CREATE_RULE;
		users.updateRule = UPDATE_RULE;
		users.deleteRule = DELETE_RULE;

		app.save(users);
	},
	(app) => {
		// Security harden is additive — do not restore weaker public create / open update.
		const users = findCollectionSafe(app, "users");
		if (!users) return;
		users.createRule = CREATE_RULE;
		users.updateRule = UPDATE_RULE;
		app.save(users);
	},
);
