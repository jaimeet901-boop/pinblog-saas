import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	ARTICLE_IMAGE_FALLBACK,
	GENERIC_IMAGE_ERROR,
	GENERIC_TEXT_ERROR,
	userSafeImageError,
	userSafeTextError,
} from './ai-user-safe-errors.js';

describe('user-safe AI errors', () => {
	it('never returns a provider-specific image failure', () => {
		assert.equal(userSafeImageError({ hasError: true }), GENERIC_IMAGE_ERROR);
		assert.equal(userSafeImageError({ status: 'fallback', hasError: true }), ARTICLE_IMAGE_FALLBACK);
	});

	it('uses one opaque text failure message', () => {
		assert.equal(userSafeTextError(), GENERIC_TEXT_ERROR);
	});
});
