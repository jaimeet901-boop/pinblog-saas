/**
 * Route mount + isolation contracts for writer-article-images (M3-A).
 * Run: node --test src/routes/writer-article-images.contract.test.js
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const routeSrc = readFileSync(join(here, 'writer-article-images.js'), 'utf8');
const indexSrc = readFileSync(join(here, 'index.js'), 'utf8');
const integratedSrc = readFileSync(join(here, 'integrated-ai.js'), 'utf8');

describe('writer-article-images route contracts', () => {
	it('is mounted separately from integrated-ai', () => {
		assert.match(indexSrc, /writer-article-images/);
		assert.match(indexSrc, /\/writer-article-images/);
		assert.doesNotMatch(integratedSrc, /writer-article-images/);
		assert.doesNotMatch(integratedSrc, /planArticleImages/);
		assert.doesNotMatch(integratedSrc, /resolveArticleImages/);
	});

	it('J. uses req.workspaceKey and ignores client workspaceKey', () => {
		assert.match(routeSrc, /req\.workspaceKey/);
		assert.match(routeSrc, /ignoring client-supplied workspaceKey/);
		assert.match(routeSrc, /assertFeatureAccess\(req, 'aiWriter'/);
		assert.match(routeSrc, /imageCount === 0/);
		assert.match(routeSrc, /skipped: true/);
	});

	it('does not import LLM prompt modules or HTML composer', () => {
		assert.doesNotMatch(routeSrc, /from ['"].*prompts\.js['"]/);
		assert.doesNotMatch(routeSrc, /from ['"].*integrated-ai\.js['"]/);
		assert.doesNotMatch(routeSrc, /composeHtml\s*\(/);
	});
});
