/**
 * Phase 2 rebrand — public SEO asset path defaults.
 * Run: node --test src/lib/marketing/r0Copy.assets.test.js
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { R0_OG_IMAGE_PATH } from './r0Copy.js';
import { LLMS_CONTENT, resolveLlmsBody } from '../../../tools/generate-llms.js';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Phase 2 public brand assets', () => {
	it('points OG path at Seodeva asset', () => {
		assert.equal(R0_OG_IMAGE_PATH, '/og-seodeva.png');
		assert.ok(existsSync(path.join(webRoot, 'public/og-seodeva.png')));
		assert.equal(existsSync(path.join(webRoot, 'public/og-chef-ia.png')), false);
	});

	it('ships favicon.svg and Seodeva llms generator content', () => {
		assert.ok(existsSync(path.join(webRoot, 'public/favicon.svg')));

		const llms = resolveLlmsBody();
		assert.equal(llms, LLMS_CONTENT);
		assert.match(llms, /Seodeva/);
		assert.doesNotMatch(llms, /Chef IA|PinBlog|tbuy\.store/i);
	});

	it('index.html and favicon defaults use Seodeva assets', () => {
		const index = readFileSync(path.join(webRoot, 'index.html'), 'utf8');
		assert.match(index, /href="\/favicon\.svg"/);
		assert.match(index, /og:image" content="https:\/\/seodeva\.com\/og-seodeva\.png"/);
		assert.doesNotMatch(index, /vite\.svg|og-chef-ia/);

		const fav = readFileSync(path.join(webRoot, 'src/components/PlatformFavicon.jsx'), 'utf8');
		assert.match(fav, /DEFAULT_FAVICON_HREF = '\/favicon\.svg'/);
	});
});
