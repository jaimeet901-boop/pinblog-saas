/**
 * generate_ai must never soft-succeed with featured_image_url.
 * Run: node --test src/services/ai-pin-image-queue.generate-ai-no-fallback.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const queueSource = readFileSync(
	join(root, 'apps/api/src/services/ai-pin-image-queue.js'),
	'utf8',
);

describe('ai-pin-image-queue generate_ai no featured fallback', () => {
	it('use_featured still completes with featured image before provider calls', () => {
		assert.match(queueSource, /image_mode === 'use_featured'/);
		const featuredBlock = queueSource.slice(
			queueSource.indexOf("if (job.image_mode === 'use_featured')"),
			queueSource.indexOf('resolveAdminConfiguredImageProvider'),
		);
		assert.match(featuredBlock, /status: 'completed'/);
		assert.match(featuredBlock, /imageUrl: fallbackImage/);
	});

	it('missing provider keys throw instead of status fallback with featured URL', () => {
		assert.match(queueSource, /Image generation is unavailable/);
		assert.doesNotMatch(
			queueSource,
			/if \(provider === 'openai' && !openaiKey\) \{\s*if \(fallbackImage\)/,
		);
		assert.doesNotMatch(
			queueSource,
			/if \(\(provider === 'fal' \|\| provider === 'flux'\) && !falKey\) \{\s*if \(fallbackImage\)/,
		);
	});

	it('catch path no longer writes status fallback with featured image', () => {
		assert.doesNotMatch(queueSource, /AI pin image job fallback used/);
		assert.doesNotMatch(queueSource, /isImmediateImageFallbackError/);
		assert.doesNotMatch(
			queueSource,
			/status: 'fallback',\s*imageUrl: fallbackImage/,
		);
	});

	it('successful AI path still uploads then completes', () => {
		assert.match(queueSource, /uploadGeneratedImage/);
		assert.match(queueSource, /generateImagesWithProvider/);
		const successIdx = queueSource.indexOf('const imageUrl = await uploadGeneratedImage');
		const completeIdx = queueSource.indexOf("status: 'completed'", successIdx);
		assert.ok(successIdx >= 0 && completeIdx > successIdx);
	});
});
