import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	MARKETPLACE_LIBRARIES,
	buildMarketplaceGalleryOwnerFilter,
	normalizeMarketplaceLibrary,
	resolveGalleryLibraryQuery,
} from '../constants/template-marketplace.js';

describe('template-marketplace', () => {
	it('exports marketplace libraries without developer', () => {
		assert.deepEqual(MARKETPLACE_LIBRARIES, ['official', 'premium', 'community', 'user']);
		assert.equal(normalizeMarketplaceLibrary('developer'), '');
	});

	it('resolveGalleryLibraryQuery maps legacy scope to library', () => {
		assert.equal(resolveGalleryLibraryQuery({ scope: 'mine' }), 'user');
		assert.equal(resolveGalleryLibraryQuery({ scope: 'official' }), 'official');
		assert.equal(resolveGalleryLibraryQuery({ library: 'official' }), 'official');
		assert.equal(resolveGalleryLibraryQuery({ scope: 'workspace' }), '');
	});

	it('library=official excludes platform-owner union', () => {
		const filter = buildMarketplaceGalleryOwnerFilter({
			userId: 'user1',
			library: 'official',
		});
		assert.equal(filter, 'visibility = "official"');
		assert.doesNotMatch(filter, /platform/i);
		assert.doesNotMatch(filter, /owner = "user1"/);
	});

	it('default marketplace browse includes official and user without platform owner', () => {
		const filter = buildMarketplaceGalleryOwnerFilter({
			userId: 'user1',
			workspaceId: 'ws1',
		});
		assert.match(filter, /visibility = "official"/);
		assert.match(filter, /owner = "user1"/);
		assert.match(filter, /workspace_id = "ws1"/);
		assert.doesNotMatch(filter, /platform/i);
	});

	it('library=user scopes to owner only', () => {
		const filter = buildMarketplaceGalleryOwnerFilter({
			userId: 'user1',
			library: 'user',
		});
		assert.equal(filter, '(owner = "user1")');
	});

	it('scope=workspace filters workspace rows', () => {
		const filter = buildMarketplaceGalleryOwnerFilter({
			scope: 'workspace',
			workspaceId: 'ws9',
		});
		assert.equal(filter, '(workspace_id = "ws9" || workspace = "ws9")');
	});

	it('backward compat: no library and no scope uses composite marketplace default', () => {
		assert.equal(resolveGalleryLibraryQuery({}), '');
		const filter = buildMarketplaceGalleryOwnerFilter({
			userId: 'user1',
			scope: '',
			library: '',
		});
		assert.match(filter, /visibility = "official"/);
		assert.match(filter, /owner = "user1"/);
		assert.doesNotMatch(filter, /platform/i);
	});

	it('backward compat: legacy scope=official without library param', () => {
		const library = resolveGalleryLibraryQuery({ scope: 'official' });
		assert.equal(library, 'official');
		assert.equal(
			buildMarketplaceGalleryOwnerFilter({ scope: 'official', library }),
			'visibility = "official"',
		);
	});
});
