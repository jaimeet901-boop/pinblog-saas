/**
 * Critical #2 — users privilege escalation regressions.
 * Run: node --test src/services/users-privileged-fields.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	USERS_PRIVILEGED_FIELDS,
	USERS_SAFE_CREATE_DEFAULTS,
	buildUsersCreateRule,
	buildUsersUpdateRule,
	buildAdminUserFieldUpdates,
	findPrivilegedClientFields,
	isSafeClientUserCreate,
	isSafeClientUserUpdate,
	usersRulesMatchHardened,
} from './users-privileged-fields.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../');
const migrationPath = path.join(
	repoRoot,
	'apps/pocketbase/pb_migrations/1785500000_users_privileged_fields_lockdown.js',
);
const hookPath = path.join(
	repoRoot,
	'apps/pocketbase/pb_hooks/users-privileged-fields.pb.js',
);
const ensurePath = path.join(here, '../utils/ensure-users-privileged-rules.js');
const mainPath = path.join(here, '../main.js');
const adminUsersPath = path.join(here, 'admin/users.js');

test('privileged field catalog includes role, plan, credits counters, status, verified', () => {
	for (const field of ['role', 'plan', 'status', 'ai_credits_used', 'image_credits_used', 'verified']) {
		assert.ok(USERS_PRIVILEGED_FIELDS.includes(field), `missing ${field}`);
	}
});

test('normal user cannot elevate role via client update payload', () => {
	assert.equal(isSafeClientUserUpdate({ role: 'admin' }), false);
	assert.deepEqual(findPrivilegedClientFields({ role: 'admin' }), ['role']);
	assert.match(buildUsersUpdateRule(), /@request\.body\.role:isset = false/);
});

test('normal user cannot change plan via client update payload', () => {
	assert.equal(isSafeClientUserUpdate({ plan: 'agency' }), false);
	assert.deepEqual(findPrivilegedClientFields({ plan: 'agency', name: 'Ok' }), ['plan']);
	assert.match(buildUsersUpdateRule(), /@request\.body\.plan:isset = false/);
});

test('normal user cannot modify credit counters via client update payload', () => {
	assert.equal(isSafeClientUserUpdate({ ai_credits_used: 0 }), false);
	assert.equal(isSafeClientUserUpdate({ image_credits_used: 999 }), false);
	assert.equal(isSafeClientUserUpdate({ credits: 9999 }), false);
	assert.match(buildUsersUpdateRule(), /@request\.body\.ai_credits_used:isset = false/);
	assert.match(buildUsersUpdateRule(), /@request\.body\.image_credits_used:isset = false/);
});

test('password / name-only client updates remain allowed by updateRule shape', () => {
	assert.equal(isSafeClientUserUpdate({
		oldPassword: 'x',
		password: 'y',
		passwordConfirm: 'y',
	}), true);
	assert.equal(isSafeClientUserUpdate({ name: 'Ada Lovelace' }), true);
	assert.match(buildUsersUpdateRule(), /^id = @request\.auth\.id/);
});

test('signup create with safe defaults is allowed; escalation create is blocked', () => {
	assert.equal(isSafeClientUserCreate({
		name: 'New',
		email: 'a@b.c',
		password: 'x',
		passwordConfirm: 'x',
		plan: USERS_SAFE_CREATE_DEFAULTS.plan,
		role: USERS_SAFE_CREATE_DEFAULTS.role,
	}), true);
	assert.equal(isSafeClientUserCreate({
		email: 'a@b.c',
		password: 'x',
		passwordConfirm: 'x',
		role: 'admin',
	}), false);
	assert.equal(isSafeClientUserCreate({
		email: 'a@b.c',
		password: 'x',
		passwordConfirm: 'x',
		plan: 'agency',
	}), false);
	assert.equal(isSafeClientUserCreate({
		email: 'a@b.c',
		password: 'x',
		passwordConfirm: 'x',
		ai_credits_used: 0,
	}), false);
	assert.match(buildUsersCreateRule(), /role = 'member'/);
	assert.match(buildUsersCreateRule(), /plan = 'free'/);
});

test('Admin allowlist can still set role, plan, status (server path)', () => {
	const promote = buildAdminUserFieldUpdates({
		name: 'Ops',
		role: 'admin',
		plan: 'agency',
		status: 'active',
	});
	assert.deepEqual(promote, {
		name: 'Ops',
		role: 'admin',
		plan: 'agency',
		status: 'active',
	});

	const demote = buildAdminUserFieldUpdates({ role: 'user' });
	assert.equal(demote.role, 'member');

	const ignoreCredits = buildAdminUserFieldUpdates({
		role: 'admin',
		ai_credits_used: 1,
		credits: 50,
	});
	assert.deepEqual(ignoreCredits, { role: 'admin' });
});

test('updateAdminUser persists schema role member|admin (not invalid user)', () => {
	const src = readFileSync(adminUsersPath, 'utf8');
	assert.match(src, /updates\.role = role === 'admin' \|\| role === 'super_admin' \? 'admin' : 'member'/);
	assert.doesNotMatch(src, /updates\.role = role === 'admin' \? 'admin' : 'user'/);
});

test('migration, hook, ensure, and main wiring exist and match rule builders', () => {
	assert.equal(existsSync(migrationPath), true);
	assert.equal(existsSync(hookPath), true);
	assert.equal(existsSync(ensurePath), true);

	const migration = readFileSync(migrationPath, 'utf8');
	const hook = readFileSync(hookPath, 'utf8');
	const ensure = readFileSync(ensurePath, 'utf8');
	const main = readFileSync(mainPath, 'utf8');

	assert.match(migration, /@request\.body\.role:isset = false/);
	assert.match(migration, /@request\.body\.plan:isset = false/);
	assert.match(migration, /@request\.body\.ai_credits_used:isset = false/);
	assert.match(migration, /role = 'member'/);
	assert.match(migration, /plan = 'free'/);
	assert.match(migration, /Security harden is additive/);

	assert.match(hook, /onRecordCreateRequest/);
	assert.match(hook, /onRecordUpdateRequest/);
	assert.match(hook, /hasSuperuserAuth/);
	assert.match(hook, /set\("role", "member"\)/);

	assert.match(ensure, /buildUsersUpdateRule/);
	assert.match(ensure, /buildUsersCreateRule/);
	assert.match(main, /runStartupSchemaCompat/);
	assert.match(readFileSync(path.join(here, '../utils/schema-compat-registry.js'), 'utf8'), /ensureUsersPrivilegedRules/);

	const expected = usersRulesMatchHardened({
		createRule: buildUsersCreateRule(),
		updateRule: buildUsersUpdateRule(),
	});
	assert.equal(expected.createOk, true);
	assert.equal(expected.updateOk, true);
});

test('legacy open updateRule is rejected by matcher', () => {
	const weak = usersRulesMatchHardened({
		createRule: '',
		updateRule: 'id = @request.auth.id',
	});
	assert.equal(weak.createOk, false);
	assert.equal(weak.updateOk, false);
});
