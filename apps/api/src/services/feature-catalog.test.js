import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	FEATURE_CATALOG,
	getFeatureCatalogDto,
	getFeatureCatalogEntry,
	getFeatureDependencyClosure,
	getFeatureDependencies,
	hasFeatureCatalogKey,
	listFeatureCatalog,
	listFeatureCatalogGroups,
	validateFeatureCatalog,
} from './feature-catalog.js';

describe('feature-catalog', () => {
	it('passes invariant validation', () => {
		const result = validateFeatureCatalog();
		assert.equal(result.ok, true, result.errors?.join('; '));
	});

	it('lists unique keys and known groups', () => {
		const items = listFeatureCatalog();
		const keys = items.map((item) => item.key);
		assert.equal(new Set(keys).size, keys.length);
		assert.ok(keys.includes('templates.premium'));
		assert.ok(keys.includes('features.ai_layout'));
		assert.ok(keys.includes('aiImages'));
		assert.ok(keys.includes('facebook'));
		assert.ok(keys.includes('pinterest'));

		const groups = listFeatureCatalogGroups();
		assert.ok(groups.some((group) => group.id === 'templates'));
		assert.ok(groups.some((group) => group.id === 'ai'));
	});

	it('resolves entries and direct dependencies', () => {
		const entry = getFeatureCatalogEntry('features.ai_layout');
		assert.ok(entry);
		assert.equal(entry.label, 'AI Layout');
		assert.deepEqual(getFeatureDependencies('features.ai_layout').sort(), ['aiImages', 'templates.premium'].sort());
		assert.equal(hasFeatureCatalogKey('features.ab_variations'), true);
		assert.equal(hasFeatureCatalogKey('features.not_real'), false);
	});

	it('builds transitive dependency closure (deps before feature)', () => {
		const closure = getFeatureDependencyClosure('features.ab_variations');
		assert.ok(closure.includes('templates.premium'));
		assert.ok(closure.includes('aiImages'));
		assert.ok(closure.includes('features.ai_layout'));
		assert.ok(closure.includes('features.ab_variations'));
		assert.equal(closure[closure.length - 1], 'features.ab_variations');
		assert.ok(closure.indexOf('features.ai_layout') < closure.indexOf('features.ab_variations'));
	});

	it('throws on unknown feature key for closure', () => {
		assert.throws(() => getFeatureDependencyClosure('features.missing'), /Unknown feature catalog key/);
	});

	it('exposes admin DTO with invariants ok', () => {
		const dto = getFeatureCatalogDto();
		assert.equal(dto.version, 1);
		assert.equal(dto.invariants.ok, true);
		assert.ok(dto.keys.length === FEATURE_CATALOG.length);
		assert.ok(dto.groups.every((group) => Array.isArray(group.features)));
	});
});
