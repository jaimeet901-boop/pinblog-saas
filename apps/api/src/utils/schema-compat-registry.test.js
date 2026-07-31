/**
 * High Priority #4 — schema authority / dual ensure+migration registry.
 * Run: node --test src/utils/schema-compat-registry.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	SCHEMA_COMPAT_REGISTRY,
	listAllEnsureModuleFilenames,
	listStartupSchemaCompatEntries,
	listLazySchemaCompatEntries,
	migrationFilenamesForEntry,
} from './schema-compat-registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSrc = path.resolve(here, '..');
const repoRoot = path.resolve(apiSrc, '../../..');
const migrationsDir = path.join(repoRoot, 'apps/pocketbase/pb_migrations');
const hooksDir = path.join(repoRoot, 'apps/pocketbase/pb_hooks');
const utilsDir = path.join(apiSrc, 'utils');
const mainPath = path.join(apiSrc, 'main.js');
const authorityDoc = path.join(repoRoot, 'docs/schema-authority.md');

test('schema-authority policy doc exists and declares migrations primary', () => {
	assert.equal(existsSync(authorityDoc), true);
	const doc = readFileSync(authorityDoc, 'utf8');
	assert.match(doc, /pb_migrations/);
	assert.match(doc, /Primary/i);
	assert.match(doc, /Compat only/i);
	assert.match(doc, /schema-compat-registry/);
});

test('every registry entry has existing migration files (migrations authoritative)', () => {
	assert.ok(SCHEMA_COMPAT_REGISTRY.length >= 10);
	for (const entry of SCHEMA_COMPAT_REGISTRY) {
		assert.ok(entry.migrationIds?.length, `${entry.id} missing migrationIds`);
		for (const file of migrationFilenamesForEntry(entry)) {
			const full = path.join(migrationsDir, file);
			assert.equal(existsSync(full), true, `${entry.id}: missing migration ${file}`);
		}
		if (entry.hookPath) {
			assert.equal(
				existsSync(path.join(repoRoot, 'apps/pocketbase', entry.hookPath)),
				true,
				`${entry.id}: missing hook ${entry.hookPath}`,
			);
		}
	}
});

test('every ensure-*.js schema module is registered (no orphan ensures)', () => {
	const onDisk = readdirSync(utilsDir)
		.filter((name) => /^ensure-.*\.js$/.test(name))
		.sort();
	// include ensure-users-privileged-rules.js (rules) and all schema ensures
	const registered = new Set(listAllEnsureModuleFilenames());
	const missingFromRegistry = onDisk.filter((name) => !registered.has(name));
	assert.deepEqual(
		missingFromRegistry,
		[],
		`ensure modules not in registry: ${missingFromRegistry.join(', ')}`,
	);

	for (const name of registered) {
		assert.equal(existsSync(path.join(utilsDir, name)), true, `registered ensure missing on disk: ${name}`);
		const src = readFileSync(path.join(utilsDir, name), 'utf8');
		const entry = SCHEMA_COMPAT_REGISTRY.find((e) => e.ensureModule === name);
		assert.ok(entry, name);
		assert.match(src, new RegExp(`export async function ${entry.ensureExport}`));
	}
});

test('startup ensures are wired through runStartupSchemaCompat in main.js', () => {
	const main = readFileSync(mainPath, 'utf8');
	assert.match(main, /runStartupSchemaCompat/);
	assert.match(main, /migrations are authoritative/);
	// Direct per-ensure calls removed from boot (registry is the single runner).
	for (const entry of listStartupSchemaCompatEntries()) {
		assert.doesNotMatch(
			main,
			new RegExp(`${entry.ensureExport}\\(pocketbaseClient\\)`),
			`main.js still calls ${entry.ensureExport} directly`,
		);
	}
	assert.ok(listStartupSchemaCompatEntries().length >= 8);
	assert.ok(listLazySchemaCompatEntries().length >= 2);
});

test('website_articles ensure uses API-only rules (matches isolation migration)', () => {
	const src = readFileSync(path.join(utilsDir, 'ensure-website-articles-schema.js'), 'utf8');
	assert.match(src, /listRule:\s*null/);
	assert.match(src, /createRule:\s*null/);
	assert.match(src, /Hardening website_articles to API-only rules/);
	assert.doesNotMatch(src, /owner = @request\.auth\.id/);
});

test('fresh install model: ensures are written to no-op when fields already exist', () => {
	const src = readFileSync(path.join(utilsDir, 'ensure-credits-engine-schema.js'), 'utf8');
	assert.match(src, /missing\.length/);
	assert.match(src, /if \(!missing\.length\) return collection/);
	assert.match(src, /getOne\('credit_reservations'\)/);
	assert.match(src, /getOne\('billing_events'\)/);
	// Create only when collection is missing — already-present collections skip create.
	assert.match(src, /if \(!reservations\)/);
	assert.match(src, /if \(!billingEvents\)/);
});

test('existing install model: ensures only add missing fields (compat additive)', () => {
	const src = readFileSync(path.join(utilsDir, 'ensure-credits-engine-schema.js'), 'utf8');
	assert.match(src, /requiredFields\.filter\(\(field\) => !hasField/);
	assert.match(src, /Adding missing credits engine fields/);
	assert.match(src, /collections\.update\(/);
});

test('runStartupSchemaCompat is the single startup runner for registry entries', () => {
	const runner = readFileSync(path.join(utilsDir, 'run-schema-compat.js'), 'utf8');
	assert.match(runner, /export function runStartupSchemaCompat/);
	assert.match(runner, /listStartupSchemaCompatEntries/);
	for (const entry of listStartupSchemaCompatEntries()) {
		assert.match(
			runner,
			new RegExp(`${entry.ensureExport}:`),
			`runner missing loader for ${entry.ensureExport}`,
		);
	}
});
