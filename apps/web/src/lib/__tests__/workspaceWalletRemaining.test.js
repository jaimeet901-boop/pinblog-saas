/**
 * WS-07 authoritative workspace wallet remaining.
 * Run: node --test src/lib/__tests__/workspaceWalletRemaining.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	mergeAnalyticsCreditsDisplay,
	planCreditsIncludedPerMonth,
	workspaceWalletRemaining,
} from '../workspaceWalletRemaining.js';

describe('WS-07 workspaceWalletRemaining', () => {
	it('renders remaining 0 as 0', () => {
		assert.equal(workspaceWalletRemaining({ remaining: 0, quota: 100, used: 100 }), 0);
		assert.equal(workspaceWalletRemaining({ remaining: '0', balance: 12 }), 0);
		assert.equal(workspaceWalletRemaining({ remaining: 0, balance: 99 }), 0);
	});

	it('uses remaining 12 with quota 100 instead of inventing 88 used', () => {
		const remaining = workspaceWalletRemaining({ remaining: 12, quota: 100, used: 88 });
		assert.equal(remaining, 12);
		assert.notEqual(remaining, 88);
		assert.notEqual(100 - remaining, remaining);
	});

	it('keeps a balance above quota', () => {
		assert.equal(workspaceWalletRemaining({ remaining: 150, quota: 100 }), 150);
		assert.equal(workspaceWalletRemaining({ balance: 250, quota: 100 }), 250);
	});

	it('never falls back to quota - used', () => {
		assert.equal(workspaceWalletRemaining({ used: 20, quota: 100 }), 0);
		assert.equal(workspaceWalletRemaining({}), 0);
		assert.equal(workspaceWalletRemaining({ remaining: Number.NaN, quota: 40 }), 0);
	});

	it('reads included plan credits separately from remaining', () => {
		assert.equal(planCreditsIncludedPerMonth({ quota: 100, remaining: 12 }), 100);
		assert.equal(planCreditsIncludedPerMonth({ remaining: 12 }), 0);
	});
});

describe('WS-07 analytics remaining vs range usage', () => {
	it('does not let a Pinterest fallback zero wallet remaining', () => {
		const merged = mergeAnalyticsCreditsDisplay({
			overviewOk: false,
			summary: { creditsRemaining: 0, creditsUsed: 40 },
			walletRemaining: 12,
			previousRemaining: 9,
		});
		assert.equal(merged.creditsRemaining, 12);
		assert.equal(merged.creditsUsedInRange, 0);
	});

	it('keeps remaining 0 when the wallet is actually empty', () => {
		const merged = mergeAnalyticsCreditsDisplay({
			overviewOk: true,
			summary: { creditsRemaining: 0, creditsUsed: 8 },
			walletRemaining: 0,
		});
		assert.equal(merged.creditsRemaining, 0);
		assert.equal(merged.creditsUsedInRange, 8);
	});

	it('preserves previous remaining when analytics and wallet fetch both miss', () => {
		const merged = mergeAnalyticsCreditsDisplay({
			overviewOk: false,
			summary: { creditsRemaining: 0, creditsUsed: 99 },
			walletRemaining: null,
			previousRemaining: 12,
		});
		assert.equal(merged.creditsRemaining, 12);
		assert.equal(merged.creditsUsedInRange, 0);
	});
});
