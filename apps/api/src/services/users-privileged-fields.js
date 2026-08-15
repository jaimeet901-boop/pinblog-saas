/**
 * Privileged `users` collection fields — server/Admin (superuser) only.
 * Client PocketBase SDK must never set these via create/update rules.
 *
 * Keep in sync with:
 * - apps/pocketbase/pb_migrations/1785500000_users_privileged_fields_lockdown.js
 * - apps/pocketbase/pb_hooks/users-privileged-fields.pb.js
 * - apps/api/src/utils/ensure-users-privileged-rules.js
 */

export const USERS_PRIVILEGED_FIELDS = Object.freeze([
	'role',
	'plan',
	'status',
	'ai_credits_used',
	'image_credits_used',
	'verified',
	'credits',
]);

/** Safe defaults allowed on public signup / OAuth createData. */
export const USERS_SAFE_CREATE_DEFAULTS = Object.freeze({
	role: 'member',
	plan: 'free',
	verified: false,
});

/**
 * PocketBase updateRule: self-only, privileged body keys forbidden.
 * PB ≥0.23 uses @request.body (this project ships 0.38).
 */
export function buildUsersUpdateRule() {
	const guards = USERS_PRIVILEGED_FIELDS.map(
		(field) => `@request.body.${field}:isset = false`,
	);
	return [`id = @request.auth.id`, ...guards].join(' && ');
}

/**
 * PocketBase createRule: public signup allowed, privileged escalation blocked.
 * When registration is closed, only superusers may create users.
 * plan/role may be omitted or set only to safe defaults (existing AuthContext/OAuth).
 */
export function buildUsersCreateRule({ allowRegistration = true } = {}) {
	if (!allowRegistration) return null;
	return [
		`(@request.body.role:isset = false || @request.body.role = '${USERS_SAFE_CREATE_DEFAULTS.role}')`,
		`(@request.body.plan:isset = false || @request.body.plan = '${USERS_SAFE_CREATE_DEFAULTS.plan}')`,
		'@request.body.status:isset = false',
		'@request.body.ai_credits_used:isset = false',
		'@request.body.image_credits_used:isset = false',
		'@request.body.credits:isset = false',
		`(@request.body.verified:isset = false || @request.body.verified = false)`,
	].join(' && ');
}

export function buildUsersListRule() {
	return `id = @request.auth.id || @request.auth.role = 'admin'`;
}

export function buildUsersViewRule() {
	return buildUsersListRule();
}

export function buildUsersDeleteRule() {
	return `id = @request.auth.id`;
}

export function buildUsersRules({ allowRegistration = true } = {}) {
	return {
		listRule: buildUsersListRule(),
		viewRule: buildUsersViewRule(),
		createRule: buildUsersCreateRule({ allowRegistration }),
		updateRule: buildUsersUpdateRule(),
		deleteRule: buildUsersDeleteRule(),
	};
}

/**
 * Detect privileged keys a normal client tried to write.
 * @returns {string[]}
 */
export function findPrivilegedClientFields(payload = {}) {
	if (!payload || typeof payload !== 'object') return [];
	return USERS_PRIVILEGED_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(payload, field));
}

/**
 * Whether a client create payload is allowed under createRule (safe defaults only).
 */
export function isSafeClientUserCreate(payload = {}) {
	if (!payload || typeof payload !== 'object') return false;
	for (const field of USERS_PRIVILEGED_FIELDS) {
		if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
		if (field === 'role' && payload.role === USERS_SAFE_CREATE_DEFAULTS.role) continue;
		if (field === 'plan' && payload.plan === USERS_SAFE_CREATE_DEFAULTS.plan) continue;
		if (field === 'verified' && payload.verified === false) continue;
		return false;
	}
	return true;
}

/**
 * Whether a client update payload is allowed under updateRule (no privileged keys).
 */
export function isSafeClientUserUpdate(payload = {}) {
	return findPrivilegedClientFields(payload).length === 0;
}

/**
 * Admin Console allowlist — mirrors updateAdminUser (server superuser path).
 * Maps API role DTO `user` → schema `member`.
 */
export function buildAdminUserFieldUpdates(payload = {}) {
	const updates = {};
	if (payload.name != null) updates.name = String(payload.name).trim();
	if (payload.plan != null) updates.plan = String(payload.plan).trim().toLowerCase();
	if (payload.role != null) {
		const role = String(payload.role).toLowerCase();
		updates.role = role === 'admin' || role === 'super_admin' ? 'admin' : 'member';
	}
	if (payload.status != null) updates.status = String(payload.status).toLowerCase();
	return updates;
}

function normalizedRule(rule) {
	return String(rule || '').replace(/\s+/g, ' ').trim();
}

export function usersCreateRuleMatches(createRule, expectedCreateRule) {
	if (expectedCreateRule === null) return createRule === null;
	return normalizedRule(createRule) === normalizedRule(expectedCreateRule);
}

/**
 * Synchronize only the users collection createRule with platform registration
 * policy. All other users rules remain untouched.
 */
export async function syncUsersRegistrationCreateRule(pocketbaseClient, allowRegistration) {
	if (!pocketbaseClient?.collections?.getOne || !pocketbaseClient?.collections?.update) {
		throw new Error('PocketBase collections client is required');
	}

	const collection = await pocketbaseClient.collections.getOne('users');
	const createRule = buildUsersCreateRule({ allowRegistration });
	if (usersCreateRuleMatches(collection.createRule, createRule)) {
		return { updated: false, allowRegistration, createRule };
	}

	await pocketbaseClient.collections.update(collection.id, { createRule });
	return { updated: true, allowRegistration, createRule };
}

export function usersRulesMatchHardened({ createRule, updateRule, allowRegistration = true } = {}) {
	const expectedCreate = buildUsersCreateRule({ allowRegistration });
	const expectedUpdate = buildUsersUpdateRule();
	return {
		createOk: usersCreateRuleMatches(createRule, expectedCreate),
		updateOk: normalizedRule(updateRule) === normalizedRule(expectedUpdate),
		expectedCreate,
		expectedUpdate,
	};
}
