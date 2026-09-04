/**
 * Writer composeArticleHtml (M3-B1) — pure unit tests.
 * Run: node --test apps/web/src/lib/__tests__/writerComposeHtml.test.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	composeArticleHtml,
	composeLegacyArticleHtml,
	escapeHtmlAttr,
	isAllowedComposerImageUrl,
	normalizeHeadingFingerprint,
} from '../writerComposeHtml.js';

const BASE = {
	introduction: '<p>Creamy weeknight pasta.</p>',
	sections: [
		{ heading: 'Ingredients', level: 'h2', content: '<p>Chicken, pasta, cream.</p>' },
		{ heading: 'Cooking the chicken', level: 'h2', content: '<p>Season and sear.</p>' },
		{ heading: 'Combining pasta and sauce', level: 'h2', content: '<p>Toss well.</p>' },
	],
	faq: [{ question: 'Can I freeze it?', answer: 'Yes.' }],
	conclusion: '<p>Enjoy.</p>',
	recipe_schema: { '@type': 'Recipe', name: 'Alfredo' },
	featured_image: 'https://cdn.example/manual-featured.jpg',
	gallery_images: ['https://cdn.example/g1.jpg'],
};

function inlineAsset(overrides = {}) {
	return {
		status: 'resolved',
		source: 'stock_pexels',
		slotId: 'slot-2-cand-section-1',
		type: 'inline',
		sectionIndex: 1,
		after: 'section:1',
		headingFingerprint: 'cooking the chicken',
		url: 'https://images.pexels.com/photos/101/large.jpeg',
		width: 1200,
		height: 800,
		alt: 'Cooking the chicken',
		attribution: 'Ada / Pexels',
		license: 'pexels',
		confidence: 0.9,
		providerMeta: { photoId: '101' },
		...overrides,
	};
}

describe('writerComposeHtml helpers', () => {
	it('D. heading normalization matches M3-B0', () => {
		assert.equal(normalizeHeadingFingerprint('  Cooking the   Chicken '), 'cooking the chicken');
		assert.equal(normalizeHeadingFingerprint('EASY CHICKEN ALFREDO'), 'easy chicken alfredo');
		assert.equal(normalizeHeadingFingerprint(''), null);
		assert.equal(normalizeHeadingFingerprint('   '), null);
	});

	it('URL allow/reject policy', () => {
		assert.equal(isAllowedComposerImageUrl('https://images.pexels.com/x.jpg'), true);
		assert.equal(isAllowedComposerImageUrl('data:image/png;base64,abc'), true);
		assert.equal(isAllowedComposerImageUrl('data:image/jpeg;base64,abc'), true);
		assert.equal(isAllowedComposerImageUrl('data:image/jpg;base64,abc'), true);
		assert.equal(isAllowedComposerImageUrl('data:image/webp;base64,abc'), true);
		assert.equal(isAllowedComposerImageUrl('data:image/gif;base64,abc'), true);
		assert.equal(isAllowedComposerImageUrl('javascript:alert(1)'), false);
		assert.equal(isAllowedComposerImageUrl('data:text/html;base64,abc'), false);
		assert.equal(isAllowedComposerImageUrl('//images.pexels.com/x.jpg'), false);
		assert.equal(isAllowedComposerImageUrl('http://images.pexels.com/x.jpg'), false);
		assert.equal(isAllowedComposerImageUrl('not a url'), false);
	});

	it('escapeHtmlAttr escapes specials', () => {
		assert.equal(
			escapeHtmlAttr(`a & b <c> "d" 'e'`),
			'a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;',
		);
	});
});

describe('composeArticleHtml legacy identity', () => {
	it('A. legacy article without images → exact legacy output', () => {
		const out = composeArticleHtml(BASE);
		assert.equal(out, composeLegacyArticleHtml(BASE));
	});

	it('B. article.images absent → exact legacy output', () => {
		const article = { ...BASE };
		assert.equal(composeArticleHtml(article), composeLegacyArticleHtml(article));
	});

	it('C. empty assets → exact legacy output', () => {
		const article = { ...BASE, images: { assets: [], requestedCount: 0 } };
		assert.equal(composeArticleHtml(article), composeLegacyArticleHtml(article));
	});
});

describe('composeArticleHtml placement', () => {
	it('D. one valid inline image → after correct section content', () => {
		const article = {
			...BASE,
			images: { assets: [inlineAsset()] },
		};
		const out = composeArticleHtml(article);
		assert.match(out, /Cooking the chicken[\s\S]*Season and sear\.[\s\S]*<figure class="seodeva-article-image">/);
		assert.match(
			out,
			/<figure class="seodeva-article-image">\n {2}<img src="https:\/\/images\.pexels\.com\/photos\/101\/large\.jpeg" alt="Cooking the chicken" loading="lazy" width="1200" height="800" \/>\n<\/figure>/,
		);
		const cookIdx = out.indexOf('Cooking the chicken');
		const figureIdx = out.indexOf('seodeva-article-image');
		const combineIdx = out.indexOf('Combining pasta and sauce');
		assert.ok(cookIdx < figureIdx && figureIdx < combineIdx);
	});

	it('E. multiple valid inline images → correct sections', () => {
		const article = {
			...BASE,
			images: {
				assets: [
					inlineAsset({
						slotId: 'slot-a',
						sectionIndex: 1,
						headingFingerprint: 'cooking the chicken',
						url: 'https://images.pexels.com/photos/a.jpg',
						alt: 'Cook',
					}),
					inlineAsset({
						slotId: 'slot-b',
						sectionIndex: 2,
						headingFingerprint: 'combining pasta and sauce',
						url: 'https://images.pexels.com/photos/b.jpg',
						alt: 'Combine',
					}),
				],
			},
		};
		const out = composeArticleHtml(article);
		assert.equal((out.match(/seodeva-article-image/g) || []).length, 2);
		assert.match(out, /photos\/a\.jpg/);
		assert.match(out, /photos\/b\.jpg/);
	});

	it('F. featured image → never in body; media fields untouched', () => {
		const article = {
			...BASE,
			images: {
				assets: [
					{
						status: 'resolved',
						type: 'featured',
						slotId: 'slot-featured',
						sectionIndex: null,
						after: 'hero',
						headingFingerprint: null,
						url: 'https://images.pexels.com/photos/featured.jpg',
						alt: 'Featured',
					},
					inlineAsset(),
				],
			},
		};
		const out = composeArticleHtml(article);
		assert.doesNotMatch(out, /photos\/featured\.jpg/);
		assert.match(out, /photos\/101\/large\.jpeg/);
		assert.equal(article.featured_image, 'https://cdn.example/manual-featured.jpg');
		assert.deepEqual(article.gallery_images, ['https://cdn.example/g1.jpg']);
	});

	it('G. sectionIndex mismatch → skipped', () => {
		const article = {
			...BASE,
			images: {
				assets: [inlineAsset({ sectionIndex: 99, headingFingerprint: 'cooking the chicken' })],
			},
		};
		assert.equal(composeArticleHtml(article), composeLegacyArticleHtml(article));
	});

	it('H. headingFingerprint mismatch → skipped', () => {
		const article = {
			...BASE,
			images: {
				assets: [inlineAsset({ headingFingerprint: 'totally different heading' })],
			},
		};
		assert.equal(composeArticleHtml(article), composeLegacyArticleHtml(article));
	});

	it('I. missing fingerprint → skipped', () => {
		const article = {
			...BASE,
			images: {
				assets: [inlineAsset({ headingFingerprint: null })],
			},
		};
		assert.equal(composeArticleHtml(article), composeLegacyArticleHtml(article));
	});

	it('J. introduction placement → skipped', () => {
		const article = {
			...BASE,
			images: {
				assets: [inlineAsset({
					slotId: 'slot-intro',
					type: 'inline',
					sectionIndex: null,
					after: 'introduction',
					headingFingerprint: null,
					url: 'https://images.pexels.com/photos/intro.jpg',
				})],
			},
		};
		assert.equal(composeArticleHtml(article), composeLegacyArticleHtml(article));
		assert.doesNotMatch(composeArticleHtml(article), /photos\/intro\.jpg/);
	});

	it('K. FAQ/conclusion → no accidental insertion', () => {
		const article = {
			...BASE,
			images: { assets: [inlineAsset()] },
		};
		const out = composeArticleHtml(article);
		const faqIdx = out.indexOf('Frequently Asked Questions');
		const conclusionIdx = out.indexOf('<h2>Conclusion</h2>');
		const figureIdx = out.indexOf('seodeva-article-image');
		assert.ok(figureIdx > 0 && figureIdx < faqIdx);
		assert.ok(faqIdx < conclusionIdx);
		assert.doesNotMatch(out.slice(faqIdx), /seodeva-article-image/);
	});

	it('L. duplicate slotId → first wins', () => {
		const article = {
			...BASE,
			images: {
				assets: [
					inlineAsset({
						slotId: 'same-slot',
						sectionIndex: 1,
						url: 'https://images.pexels.com/photos/first.jpg',
						headingFingerprint: 'cooking the chicken',
					}),
					inlineAsset({
						slotId: 'same-slot',
						sectionIndex: 2,
						url: 'https://images.pexels.com/photos/second.jpg',
						headingFingerprint: 'combining pasta and sauce',
					}),
				],
			},
		};
		const out = composeArticleHtml(article);
		assert.match(out, /photos\/first\.jpg/);
		assert.doesNotMatch(out, /photos\/second\.jpg/);
	});

	it('M. duplicate URL → first wins', () => {
		const sameUrl = 'https://images.pexels.com/photos/dup.jpg';
		const article = {
			...BASE,
			images: {
				assets: [
					inlineAsset({
						slotId: 'slot-1',
						sectionIndex: 1,
						url: sameUrl,
						headingFingerprint: 'cooking the chicken',
					}),
					inlineAsset({
						slotId: 'slot-2',
						sectionIndex: 2,
						url: sameUrl,
						headingFingerprint: 'combining pasta and sauce',
					}),
				],
			},
		};
		const out = composeArticleHtml(article);
		assert.equal((out.match(/photos\/dup\.jpg/g) || []).length, 1);
		assert.equal((out.match(/seodeva-article-image/g) || []).length, 1);
	});

	it('N. two assets same section → first wins', () => {
		const article = {
			...BASE,
			images: {
				assets: [
					inlineAsset({
						slotId: 'slot-1',
						sectionIndex: 1,
						url: 'https://images.pexels.com/photos/one.jpg',
						headingFingerprint: 'cooking the chicken',
					}),
					inlineAsset({
						slotId: 'slot-2',
						sectionIndex: 1,
						url: 'https://images.pexels.com/photos/two.jpg',
						headingFingerprint: 'cooking the chicken',
					}),
				],
			},
		};
		const out = composeArticleHtml(article);
		assert.match(out, /photos\/one\.jpg/);
		assert.doesNotMatch(out, /photos\/two\.jpg/);
	});

	it('O. failed asset → skipped', () => {
		const article = {
			...BASE,
			images: { assets: [inlineAsset({ status: 'failed' })] },
		};
		assert.equal(composeArticleHtml(article), composeLegacyArticleHtml(article));
	});

	it('P. skipped asset → skipped', () => {
		const article = {
			...BASE,
			images: { assets: [inlineAsset({ status: 'skipped' })] },
		};
		assert.equal(composeArticleHtml(article), composeLegacyArticleHtml(article));
	});

	it('Q. invalid javascript URL → skipped', () => {
		const article = {
			...BASE,
			images: { assets: [inlineAsset({ url: 'javascript:alert(1)' })] },
		};
		assert.equal(composeArticleHtml(article), composeLegacyArticleHtml(article));
	});

	it('R. arbitrary data URL → skipped', () => {
		const article = {
			...BASE,
			images: { assets: [inlineAsset({ url: 'data:text/html;base64,PGgxPmhpPC9oMT4=' })] },
		};
		assert.equal(composeArticleHtml(article), composeLegacyArticleHtml(article));
	});

	it('S. allowed HTTPS URL → inserted', () => {
		const article = {
			...BASE,
			images: { assets: [inlineAsset({ url: 'https://images.pexels.com/ok.jpg' })] },
		};
		assert.match(composeArticleHtml(article), /https:\/\/images\.pexels\.com\/ok\.jpg/);
	});

	it('T. allowed Fal data:image URL → inserted', () => {
		const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
		const article = {
			...BASE,
			images: { assets: [inlineAsset({ url: dataUrl, source: 'fal' })] },
		};
		assert.match(composeArticleHtml(article), /data:image\/png;base64,iVBORw0KGgo=/);
	});

	it('U. malicious alt text → escaped safely', () => {
		const article = {
			...BASE,
			images: {
				assets: [inlineAsset({ alt: '"><img src=x onerror=alert(1)>' })],
			},
		};
		const out = composeArticleHtml(article);
		assert.match(out, /alt="&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;"/);
		assert.doesNotMatch(out, /alt=""><img/);
	});

	it('V. missing alt → alt=""', () => {
		const article = {
			...BASE,
			images: { assets: [inlineAsset({ alt: null })] },
		};
		assert.match(composeArticleHtml(article), /alt=""/);
	});

	it('W. missing dimensions → width/height omitted', () => {
		const article = {
			...BASE,
			images: { assets: [inlineAsset({ width: null, height: null })] },
		};
		const out = composeArticleHtml(article);
		assert.match(out, /loading="lazy" \/>/);
		assert.doesNotMatch(out, /\swidth=/);
		assert.doesNotMatch(out, /\sheight=/);
	});

	it('X. valid dimensions → width/height included', () => {
		const article = {
			...BASE,
			images: { assets: [inlineAsset({ width: 1200, height: 800 })] },
		};
		assert.match(composeArticleHtml(article), /width="1200" height="800"/);
	});

	it('Y. malformed URL → skipped', () => {
		const article = {
			...BASE,
			images: { assets: [inlineAsset({ url: 'ht!tp://bad' })] },
		};
		assert.equal(composeArticleHtml(article), composeLegacyArticleHtml(article));
	});

	it('Z. old asset without B0 placement → skipped', () => {
		const article = {
			...BASE,
			images: {
				assets: [{
					status: 'resolved',
					source: 'stock_pexels',
					slotId: 'orphan',
					url: 'https://images.pexels.com/photos/old.jpg',
					alt: 'Old',
				}],
			},
		};
		assert.equal(composeArticleHtml(article), composeLegacyArticleHtml(article));
		assert.doesNotMatch(composeArticleHtml(article), /photos\/old\.jpg/);
	});
});
