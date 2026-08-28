import test from 'node:test';
import assert from 'node:assert/strict';
import {
	buildRevenueSnapshotMetadata,
	mergeRecognitionSources,
	resolveRecognizedAmount,
} from './revenue-recognition.js';
import {
	normalizePriceMappings,
	validatePriceMappings,
} from './price-mapping-helpers.js';

test('resolveRecognizedAmount prefers event snapshot over catalog', () => {
	const event = {
		to_plan: 'pro',
		metadata: {
			amountSnapshot: 19,
			currencySnapshot: 'USD',
			intervalSnapshot: 'monthly',
			planSnapshot: { slug: 'pro', name: 'Pro' },
			providerSnapshot: 'stripe',
			amount: 99,
		},
	};
	const catalog = { plans: { pro: { monthlyPrice: 49 } }, packs: {} };
	const result = resolveRecognizedAmount(event, catalog);
	assert.equal(result.recognitionSource, 'event_snapshot');
	assert.equal(result.amount, 19);
});

test('resolveRecognizedAmount uses provider amount then catalog', () => {
	const providerResult = resolveRecognizedAmount({
		metadata: { providerAmount: 29, provider: 'paddle' },
	}, { plans: { pro: { monthlyPrice: 49 } }, packs: {} });
	assert.equal(providerResult.recognitionSource, 'provider_amount');
	assert.equal(providerResult.amount, 29);

	const catalogResult = resolveRecognizedAmount({
		to_plan: 'pro',
		metadata: { intervalSnapshot: 'monthly' },
	}, { plans: { pro: { monthlyPrice: 49 } }, packs: {} });
	assert.equal(catalogResult.recognitionSource, 'catalog_price');
	assert.equal(catalogResult.amount, 49);

	const unavailable = resolveRecognizedAmount({ metadata: {} }, { plans: {}, packs: {} });
	assert.equal(unavailable.recognitionSource, 'unavailable');
	assert.equal(unavailable.amount, null);
});

test('catalog price change does not affect snapshot amount', () => {
	const event = {
		metadata: {
			amountSnapshot: 19,
			planSnapshot: { slug: 'pro' },
		},
	};
	const before = resolveRecognizedAmount(event, { plans: { pro: { monthlyPrice: 19 } }, packs: {} });
	const after = resolveRecognizedAmount(event, { plans: { pro: { monthlyPrice: 99 } }, packs: {} });
	assert.equal(before.amount, 19);
	assert.equal(after.amount, 19);
	assert.equal(after.recognitionSource, 'event_snapshot');
});

test('buildRevenueSnapshotMetadata is additive and does not overwrite', () => {
	const meta = buildRevenueSnapshotMetadata({
		amount: 10,
		currency: 'USD',
		interval: 'monthly',
		plan: { slug: 'pro', name: 'Pro' },
		provider: 'stripe',
		existingMetadata: { amountSnapshot: 5, custom: true },
	});
	assert.equal(meta.amountSnapshot, 5);
	assert.equal(meta.custom, true);
	assert.equal(meta.providerSnapshot, 'stripe');
});

test('mergeRecognitionSources returns mixed for multiple sources', () => {
	assert.equal(mergeRecognitionSources(['event_snapshot']), 'event_snapshot');
	assert.equal(mergeRecognitionSources(['event_snapshot', 'catalog_price']), 'mixed');
	assert.equal(mergeRecognitionSources([]), 'unavailable');
});

test('validatePriceMappings detects missing and duplicates', () => {
	const catalog = {
		plans: [{ slug: 'pro', name: 'Pro', monthlyPrice: 19, active: true, paid: true }],
		packs: [],
	};
	const missing = validatePriceMappings({ plans: {}, packs: {} }, catalog, { activeProvider: 'stripe' });
	assert.equal(missing.result, 'FAIL');
	assert.ok(missing.diagnostics.some((d) => d.code === 'missing_monthly_mapping'));

	const dup = validatePriceMappings({
		plans: {
			pro: {
				status: 'active',
				monthly: { stripe: 'price_1', paddle: '', lemonsqueezy: '' },
				yearly: { stripe: 'price_1', paddle: '', lemonsqueezy: '' },
				trial: { stripe: '', paddle: '', lemonsqueezy: '' },
			},
		},
		packs: {},
	}, catalog, { activeProvider: 'stripe' });
	assert.ok(dup.diagnostics.some((d) => d.code === 'duplicate_price_id' || d.code === 'interval_conflict'));
});

test('validatePriceMappings does not warn for unused provider monthly gaps', () => {
	const catalog = {
		plans: [
			{ slug: 'free', name: 'Free', monthlyPrice: 0, active: true, paid: false },
			{ slug: 'starter', name: 'Starter', monthlyPrice: 19, active: true, paid: true },
			{ slug: 'pro', name: 'Pro', monthlyPrice: 49, active: true, paid: true },
		],
		packs: [
			{ id: 'pack-100', name: 'Starter Pack', active: true },
		],
	};
	const mappings = {
		plans: {
			starter: {
				status: 'active',
				monthly: { paddle: 'pri_starter_mo' },
				yearly: { paddle: 'pri_starter_yr' },
			},
			pro: {
				status: 'active',
				monthly: { paddle: 'pri_pro_mo' },
				yearly: { paddle: 'pri_pro_yr' },
			},
		},
		packs: {
			'pack-100': { status: 'active', oneTime: { paddle: 'pri_pack_100' } },
		},
	};

	const ok = validatePriceMappings(mappings, catalog, { activeProvider: 'paddle' });
	assert.equal(ok.result, 'PASS');
	assert.equal(ok.summary.missing, 0);
	assert.equal(ok.diagnostics.some((d) => d.code === 'missing_optional_mapping'), false);
	assert.equal(ok.diagnostics.some((d) => d.provider === 'stripe' || d.provider === 'lemonsqueezy' || d.provider === 'paypal'), false);

	const requiredGap = validatePriceMappings({ plans: {}, packs: {} }, catalog, { activeProvider: 'paddle' });
	assert.equal(requiredGap.result, 'FAIL');
	assert.equal(requiredGap.summary.missing, 3);
	assert.equal(requiredGap.diagnostics.filter((d) => d.code === 'missing_monthly_mapping').length, 2);
	assert.equal(requiredGap.diagnostics.filter((d) => d.code === 'missing_pack_mapping').length, 1);
	assert.equal(requiredGap.diagnostics.some((d) => d.code === 'missing_optional_mapping'), false);
});

test('normalizePriceMappings fills provider keys', () => {
	const normalized = normalizePriceMappings({
		plans: { pro: { monthly: { stripe: ' price_x ' } } },
	});
	assert.equal(normalized.plans.pro.monthly.stripe, 'price_x');
	assert.equal(normalized.plans.pro.monthly.paddle, '');
	assert.equal(normalized.version, 1);
});
