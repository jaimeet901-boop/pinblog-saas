/**
 * Paddle Billing Rewrite — Phase 1 billing model tests.
 * Run: node --test src/services/billing/billing-model.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	ACTIVATION_SOURCES,
	BILLING_ENVIRONMENTS,
	BILLING_INTERVALS,
	PLAN_BILLING_TYPES,
	planRequiresPaidCheckout,
	resolveAuthoritativePlanBillingType,
	resolveBillingTypeFromPlan,
	validateActivationSource,
	validateBillingEnvironment,
	validateBillingInterval,
	validatePlanBillingType,
} from './billing-model.js';

describe('validatePlanBillingType', () => {
	for (const value of PLAN_BILLING_TYPES) {
		it(`accepts ${value}`, () => {
			assert.equal(validatePlanBillingType(value).ok, true);
		});
	}

	it('rejects invalid value', () => {
		const result = validatePlanBillingType('enterprise');
		assert.equal(result.ok, false);
		assert.equal(result.error, 'invalid_plan_billing_type');
	});
});

describe('validateBillingInterval', () => {
	for (const value of BILLING_INTERVALS) {
		it(`accepts ${value}`, () => {
			assert.equal(validateBillingInterval(value).ok, true);
		});
	}

	it('allows empty when allowEmpty', () => {
		assert.equal(validateBillingInterval('').ok, true);
	});

	it('rejects invalid interval', () => {
		const result = validateBillingInterval('weekly');
		assert.equal(result.ok, false);
		assert.equal(result.error, 'invalid_billing_interval');
	});

	it('accepts case-insensitive interval values', () => {
		assert.equal(validateBillingInterval('Yearly').ok, true);
		assert.equal(validateBillingInterval('Yearly').value, 'yearly');
		assert.equal(validateBillingInterval('MONTHLY').ok, true);
		assert.equal(validateBillingInterval('MONTHLY').value, 'monthly');
	});
});

describe('validateBillingEnvironment', () => {
	for (const value of BILLING_ENVIRONMENTS) {
		it(`accepts ${value}`, () => {
			assert.equal(validateBillingEnvironment(value).ok, true);
		});
	}

	it('allows empty when allowEmpty', () => {
		assert.equal(validateBillingEnvironment('').ok, true);
	});

	it('rejects invalid environment', () => {
		const result = validateBillingEnvironment('staging');
		assert.equal(result.ok, false);
		assert.equal(result.error, 'invalid_billing_environment');
	});
});

describe('validateActivationSource', () => {
	for (const value of ACTIVATION_SOURCES) {
		it(`accepts ${value}`, () => {
			assert.equal(validateActivationSource(value).ok, true);
		});
	}

	it('rejects invalid activation source', () => {
		const result = validateActivationSource('manual_checkout');
		assert.equal(result.ok, false);
		assert.equal(result.error, 'invalid_activation_source');
	});
});

describe('resolveBillingTypeFromPlan', () => {
	it('classifies free slug as free', () => {
		assert.equal(resolveBillingTypeFromPlan({ slug: 'free', monthly_price: 0 }), 'free');
	});

	it('classifies paid pricing as paid', () => {
		assert.equal(resolveBillingTypeFromPlan({ slug: 'pro', monthly_price: 49 }), 'paid');
	});

	it('classifies known paid slug with zero price as paid', () => {
		assert.equal(resolveBillingTypeFromPlan({ slug: 'pro', monthly_price: 0, yearly_price: 0 }), 'paid');
	});

	it('classifies custom zero-price slug as free', () => {
		assert.equal(resolveBillingTypeFromPlan({ slug: 'internal', monthly_price: 0 }), 'free');
	});
});

describe('Phase 4.1 resolveAuthoritativePlanBillingType', () => {
	it('Case A: billing_type=free, price=0 → free', () => {
		const result = resolveAuthoritativePlanBillingType({
			slug: 'free',
			billing_type: 'free',
			monthly_price: 0,
		});
		assert.equal(result.ok, true);
		assert.equal(result.value, 'free');
	});

	it('Case B: billing_type=paid, price=0 → paid', () => {
		const result = resolveAuthoritativePlanBillingType({
			slug: 'pro',
			billing_type: 'paid',
			monthly_price: 0,
			yearly_price: 0,
		});
		assert.equal(result.ok, true);
		assert.equal(result.value, 'paid');
	});

	it('Case C: billing_type=paid, positive price → paid', () => {
		const result = resolveAuthoritativePlanBillingType({
			slug: 'pro',
			billing_type: 'paid',
			monthly_price: 49,
		});
		assert.equal(result.ok, true);
		assert.equal(result.value, 'paid');
	});

	it('Case D: billing_type=free, positive price → free (no price override)', () => {
		const result = resolveAuthoritativePlanBillingType({
			slug: 'promo',
			billing_type: 'free',
			monthly_price: 99,
		});
		assert.equal(result.ok, true);
		assert.equal(result.value, 'free');
	});

	it('Case E: missing billing_type → fail closed', () => {
		const result = resolveAuthoritativePlanBillingType({
			slug: 'pro',
			monthly_price: 49,
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'missing_plan_billing_type');
	});

	it('invalid billing_type → fail closed', () => {
		const result = resolveAuthoritativePlanBillingType({
			slug: 'pro',
			billing_type: 'enterprise',
		});
		assert.equal(result.ok, false);
		assert.equal(result.error, 'invalid_plan_billing_type');
	});

	it('accepts billingType camelCase alias', () => {
		const result = resolveAuthoritativePlanBillingType({
			slug: 'starter',
			billingType: 'paid',
		});
		assert.equal(result.ok, true);
		assert.equal(result.value, 'paid');
	});
});

describe('Phase 4.1 planRequiresPaidCheckout', () => {
	it('billing_type=paid requires checkout even at $0', () => {
		const result = planRequiresPaidCheckout({
			billing_type: 'paid',
			monthly_price: 0,
		});
		assert.equal(result.ok, true);
		assert.equal(result.requiresPaidCheckout, true);
		assert.equal(result.billingType, 'paid');
	});

	it('billing_type=free does not require checkout even with positive price', () => {
		const result = planRequiresPaidCheckout({
			billing_type: 'free',
			monthly_price: 49,
		});
		assert.equal(result.ok, true);
		assert.equal(result.requiresPaidCheckout, false);
		assert.equal(result.billingType, 'free');
	});

	it('missing billing_type fails closed', () => {
		const result = planRequiresPaidCheckout({ slug: 'pro', monthly_price: 49 });
		assert.equal(result.ok, false);
		assert.equal(result.error, 'missing_plan_billing_type');
	});
});
