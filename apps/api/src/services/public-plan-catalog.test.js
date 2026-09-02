/**
 * Public pricing catalog projection.
 * Run: node --test src/services/public-plan-catalog.test.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	isPaidPublicPlan,
	toPublicPlanDto,
} from './public-plan-projection.js';

const STARTER = {
	id: 'pb_starter',
	slug: 'starter',
	name: 'Starter',
	active: true,
	monthlyPrice: 19,
	yearlyPrice: 190,
	currency: 'USD',
	credits: 500,
	highlight: false,
	support: 'Email',
	description: 'For growing food blogs.',
	publishingLimits: '100 publishes / mo',
	aiFeatures: 'AI Writer',
	imageLimits: '200 images / mo',
	refillPolicy: 'Monthly refill',
	subscribers: 42,
	avgUsage: 310,
	creditCosts: { writer: 1 },
	trialConfig: { days: 14 },
	upgradeRules: {},
	downgradeRules: {},
	limits: {
		articlesPerMonth: 100,
		imagesPerMonth: 200,
		wordpressSites: 3,
		teamMembers: 2,
	},
};

describe('public-plan-catalog', () => {
	it('isPaidPublicPlan excludes Free and inactive tiers', () => {
		assert.equal(isPaidPublicPlan({ slug: 'free', active: true, monthlyPrice: 0 }), false);
		assert.equal(isPaidPublicPlan({ slug: 'starter', active: false, monthlyPrice: 19 }), false);
		assert.equal(isPaidPublicPlan(STARTER), true);
	});

	it('toPublicPlanDto exposes only safe marketing fields', () => {
		const dto = toPublicPlanDto(STARTER);
		assert.equal(dto.slug, 'starter');
		assert.equal(dto.monthlyPrice, 19);
		assert.equal(dto.yearlyPrice, 190);
		assert.equal(dto.limits.teamMembers, 2);
		assert.equal(dto.id, undefined);
		assert.equal(dto.subscribers, undefined);
		assert.equal(dto.avgUsage, undefined);
		assert.equal(dto.creditCosts, undefined);
		assert.equal(dto.trialConfig, undefined);
		assert.equal(dto.upgradeRules, undefined);
		assert.equal(dto.downgradeRules, undefined);
	});
});
