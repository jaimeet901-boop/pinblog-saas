/**
 * F6-3 — studio export profile pack resolver tests.
 * Run: node --test src/services/studio/export-profile-pack.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	normalizeStudioExportChannel,
	resolveDefaultExportProfileIdForChannel,
	resolveStudioExportDimensions,
	resolveStudioExportProfileId,
	STUDIO_DEFAULT_EXPORT_PROFILE_BY_CHANNEL,
	STUDIO_EXPORT_PROFILE_DIMENSIONS,
} from './export-profile-pack.js';

describe('normalizeStudioExportChannel', () => {
	it('defaults to pinterest', () => {
		assert.equal(normalizeStudioExportChannel(), 'pinterest');
		assert.equal(normalizeStudioExportChannel(''), 'pinterest');
	});

	it('accepts facebook', () => {
		assert.equal(normalizeStudioExportChannel('facebook'), 'facebook');
	});
});

describe('resolveDefaultExportProfileIdForChannel', () => {
	it('maps channels to product defaults', () => {
		assert.equal(STUDIO_DEFAULT_EXPORT_PROFILE_BY_CHANNEL.pinterest, 'pinterest_standard');
		assert.equal(STUDIO_DEFAULT_EXPORT_PROFILE_BY_CHANNEL.facebook, 'facebook_post');
		assert.equal(resolveDefaultExportProfileIdForChannel('pinterest'), 'pinterest_standard');
		assert.equal(resolveDefaultExportProfileIdForChannel('facebook'), 'facebook_post');
	});
});

describe('resolveStudioExportProfileId', () => {
	it('prefers explicit profileId', () => {
		assert.equal(resolveStudioExportProfileId({
			channel: 'facebook',
			profileId: 'facebook_story',
		}), 'facebook_story');
	});

	it('falls back to channel default when profile omitted', () => {
		assert.equal(resolveStudioExportProfileId({ channel: 'pinterest' }), 'pinterest_standard');
		assert.equal(resolveStudioExportProfileId({ channel: 'facebook' }), 'facebook_post');
	});

	it('uses aspect export profile before channel default', () => {
		assert.equal(resolveStudioExportProfileId({
			channel: 'facebook',
			aspectExportProfileId: 'facebook_story',
		}), 'facebook_story');
	});
});

describe('resolveStudioExportDimensions', () => {
	it('returns pinterest_standard dimensions by default', () => {
		const dims = resolveStudioExportDimensions('pinterest_standard', STUDIO_EXPORT_PROFILE_DIMENSIONS);
		assert.equal(dims.width, 1000);
		assert.equal(dims.height, 1500);
	});

	it('returns facebook_post dimensions', () => {
		const dims = resolveStudioExportDimensions('facebook_post', STUDIO_EXPORT_PROFILE_DIMENSIONS);
		assert.equal(dims.width, 1200);
		assert.equal(dims.height, 630);
	});

	it('falls back to pinterest_standard for unknown profiles', () => {
		const dims = resolveStudioExportDimensions('unknown_profile', STUDIO_EXPORT_PROFILE_DIMENSIONS);
		assert.equal(dims.width, 1000);
		assert.equal(dims.height, 1500);
	});
});
