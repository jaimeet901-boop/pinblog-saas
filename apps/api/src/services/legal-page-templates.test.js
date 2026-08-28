/**
 * Phase 1 rebrand — legal template defaults (seed/quick-start only).
 * Run: node --test src/services/legal-page-templates.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	PLATFORM_NAME,
	SITE_URL,
	SUPPORT_EMAIL,
	PRIVACY_EMAIL,
	getLegalPageTemplate,
	resolveLegalBrandContext,
} from './legal-page-templates.js';

describe('legal-page-templates Seodeva defaults', () => {
	it('uses Seodeva identity constants', () => {
		assert.equal(PLATFORM_NAME, 'Seodeva');
		assert.equal(SITE_URL, 'https://seodeva.com');
		assert.equal(SUPPORT_EMAIL, 'contact@seodeva.com');
		assert.equal(PRIVACY_EMAIL, 'contact@seodeva.com');
	});

	it('materializes privacy template without Chef IA or tbuy.store', () => {
		const page = getLegalPageTemplate('privacy');
		assert.ok(page);
		assert.match(page.seoTitle, /Seodeva/);
		assert.doesNotMatch(page.content, /Chef IA|tbuy\.store|chef-ia/i);
		assert.doesNotMatch(page.metaDescription, /Chef IA|tbuy\.store/i);
		assert.match(page.content, /Seodeva/);
		assert.match(page.content, /seodeva\.com/);
	});

	it('resolveLegalBrandContext falls back to Seodeva', () => {
		const brand = resolveLegalBrandContext({});
		assert.equal(brand.platformName, 'Seodeva');
		assert.equal(brand.siteUrl, 'https://seodeva.com');
	});
});
