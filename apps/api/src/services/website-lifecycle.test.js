import test from 'node:test';
import assert from 'node:assert/strict';
import {
	deriveDomainFromUrl,
	isWebsiteActive,
	isWebsiteSoftRemoved,
	normalizeDomainKey,
} from './website-lifecycle.js';

test('normalizeDomainKey strips www and lowercases', () => {
	assert.equal(normalizeDomainKey('WWW.MOCRECIPES.com'), 'mocrecipes.com');
	assert.equal(normalizeDomainKey('https://www.mocrecipes.com/path'), 'mocrecipes.com');
	assert.equal(normalizeDomainKey('mocrecipes.com'), 'mocrecipes.com');
});

test('deriveDomainFromUrl uses hostname', () => {
	assert.equal(deriveDomainFromUrl('https://www.mocrecipes.com/blog'), 'mocrecipes.com');
});

test('soft-removed detection', () => {
	assert.equal(isWebsiteSoftRemoved({ lifecycle_state: 'active' }), false);
	assert.equal(isWebsiteActive({ lifecycle_state: 'active' }), true);
	assert.equal(isWebsiteSoftRemoved({ lifecycle_state: 'disconnected' }), true);
	assert.equal(isWebsiteSoftRemoved({ lifecycle_state: 'purging' }), true);
	assert.equal(isWebsiteSoftRemoved({ removed_at: '2026-07-28T00:00:00.000Z' }), true);
	assert.equal(isWebsiteActive({ removed_at: '2026-07-28T00:00:00.000Z' }), false);
});
