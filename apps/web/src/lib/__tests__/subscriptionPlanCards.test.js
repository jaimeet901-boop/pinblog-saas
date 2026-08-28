/**
 * Upgrade modal plan cards + checkout helper contracts.
 * Run: node --test src/lib/__tests__/subscriptionPlanCards.test.js
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildUpgradeModalPlanCards,
	mapPlanCard,
	planPriceDisplay,
	startSubscriptionCheckout,
} from '../subscriptionPlanCards.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, '../..');

function readSrc(relativePath) {
	return readFileSync(path.join(webSrc, relativePath), 'utf8');
}

const CATALOG = [
	{
		slug: 'free',
		name: 'Free',
		monthlyPrice: 0,
		credits: 50,
		highlight: false,
		limits: { articlesPerMonth: 10, wordpressSites: 1, imagesPerMonth: 10 },
		support: 'Community',
		features: { history: { enabled: true } },
	},
	{
		slug: 'starter',
		name: 'Starter',
		monthlyPrice: 19,
		credits: 500,
		highlight: false,
		limits: { articlesPerMonth: 100, wordpressSites: 3, imagesPerMonth: 200 },
		support: 'Email',
		features: { aiWriter: { enabled: true }, aiImages: { enabled: true } },
	},
	{
		slug: 'pro',
		name: 'Pro',
		monthlyPrice: 49,
		credits: 2000,
		highlight: true,
		limits: { articlesPerMonth: 500, wordpressSites: 10, imagesPerMonth: 1000 },
		support: 'Priority',
		features: { aiWriter: { enabled: true }, aiImages: { enabled: true }, analytics: { enabled: true } },
	},
];

describe('subscriptionPlanCards', () => {
	it('maps plan cards from subscription DTO without hardcoding display prices', () => {
		const card = mapPlanCard(CATALOG[1]);
		assert.equal(card.id, 'starter');
		assert.equal(card.monthlyPrice, 19);
		assert.equal(card.credits, 500);
		assert.equal(planPriceDisplay(card, 'monthly').amountLabel, '$19');
	});

	it('buildUpgradeModalPlanCards excludes Free and current plan; marks Pro popular', () => {
		const cards = buildUpgradeModalPlanCards(CATALOG, { currentPlanSlug: 'free' });
		const ids = cards.map((plan) => plan.id);
		assert.ok(!ids.includes('free'));
		assert.ok(ids.includes('starter'));
		assert.ok(ids.includes('pro'));
		assert.ok(ids.includes('business'));
		assert.ok(ids.includes('enterprise'));
		const pro = cards.find((plan) => plan.id === 'pro');
		assert.equal(pro.popular, true);
		assert.equal(pro.monthlyPrice, 49);
	});

	it('when highlight missing, Pro still gets Most Popular emphasis', () => {
		const noHighlight = CATALOG.map((plan) => ({ ...plan, highlight: false }));
		const cards = buildUpgradeModalPlanCards(noHighlight, { currentPlanSlug: 'free' });
		assert.equal(cards.find((plan) => plan.id === 'pro')?.popular, true);
		assert.equal(cards.find((plan) => plan.id === 'starter')?.popular, false);
	});

	it('startSubscriptionCheckout posts to existing checkout endpoint', async () => {
		let called;
		const result = await startSubscriptionCheckout({
			planSlug: 'pro',
			billingInterval: 'monthly',
			fetchFn: async (url, options) => {
				called = { url, body: JSON.parse(options.body) };
				return {
					ok: true,
					json: async () => ({
						status: 'checkout_pending',
						checkoutUrl: 'https://checkout.example/paddle',
					}),
				};
			},
		});
		assert.equal(called.url, '/workspace/v1/subscription/checkout');
		assert.equal(called.body.planSlug, 'pro');
		assert.equal(result.status, 'checkout_pending');
		assert.equal(result.checkoutUrl, 'https://checkout.example/paddle');
	});
});

describe('UpgradeModal UX wiring', () => {
	it('renders paid plan cards from subscription data and uses shared checkout helper', () => {
		const modal = readSrc('components/billing/UpgradeModal.jsx');
		assert.match(modal, /buildUpgradeModalPlanCards/);
		assert.match(modal, /startSubscriptionCheckout/);
		assert.match(modal, /\/workspace\/v1\/subscription/);
		assert.match(modal, /Most Popular/);
		assert.match(modal, /Upgrade to unlock/);
		assert.match(modal, /Choose the plan that fits your needs/);
		assert.match(modal, /resolveLockedFeatureIdentity/);
		assert.match(modal, /data-locked-feature/);
		assert.doesNotMatch(modal, /Locked feature/);
		assert.doesNotMatch(modal, /No credits are consumed while this feature is locked/);
		assert.doesNotMatch(modal, /\$19/);
		assert.doesNotMatch(modal, /\$49/);
		assert.doesNotMatch(modal, /suggestUpgradePlan/);
	});

	it('FEATURE_LOCKED callers resolve identity from context (no default AI Writer)', () => {
		const studio = readSrc('pages/app/ContentStudioPage.jsx');
		assert.match(studio, /resolveLockedFeatureIdentity/);
		assert.match(studio, /openFeatureLockedUpgradeModal|UpgradeModal/);
		assert.match(studio, /openAiImagesUpgradeModal/);
		assert.match(studio, /sourcePage:\s*'ai_pins_images'/);
		assert.doesNotMatch(
			studio,
			/setUpgradeModal\(\{\s*templateId:\s*'aiWriter',\s*templateName:\s*'AI Writer'/,
		);
		const writer = readSrc('pages/app/WriterPage.jsx');
		assert.match(writer, /UpgradeModal/);
		assert.match(writer, /openWriterUpgrade/);
		assert.match(writer, /templateName="AI Writer"/);
		assert.match(writer, /requiredFeatureKeys=\{\['aiWriter'\]\}/);
	});
});
