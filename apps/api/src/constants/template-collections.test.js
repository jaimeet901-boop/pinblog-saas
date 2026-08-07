import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	collectionMatchesLibraryScope,
	normalizeCollectionSlug,
	normalizeCollectionLibraryScope,
} from '../constants/template-collections.js';

describe('template-collections constants', () => {
	it('normalizes collection slug', () => {
		assert.equal(normalizeCollectionSlug('Modern Food Blog'), 'modern-food-blog');
		assert.equal(normalizeCollectionSlug('  Promotion!!  '), 'promotion');
	});

	it('defaults library scope to official', () => {
		assert.equal(normalizeCollectionLibraryScope(''), 'official');
		assert.equal(normalizeCollectionLibraryScope('premium'), 'premium');
		assert.equal(normalizeCollectionLibraryScope('invalid'), 'official');
	});

	it('matches collection library scope against gallery library', () => {
		assert.equal(collectionMatchesLibraryScope({ library_scope: 'all' }, 'official'), true);
		assert.equal(collectionMatchesLibraryScope({ library_scope: 'official' }, 'official'), true);
		assert.equal(collectionMatchesLibraryScope({ library_scope: 'premium' }, 'official'), false);
		assert.equal(collectionMatchesLibraryScope({ library_scope: 'premium' }, 'premium'), true);
	});
});
