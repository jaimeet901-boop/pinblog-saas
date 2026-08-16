/**
 * CR-P0-1 — customer-facing credit remaining/used/limit come from the
 * credits-engine workspace wallet only.
 * Run: node --test src/services/ai-pin-credits.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import {
	requireExplicitWorkspaceKey,
	creditUsageFromWallet,
	readWorkspaceCreditUsage,
	consumeBillableAiFeature,
	consumeCredits,
} from './ai-pin-credit-usage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const creditsSource = readFileSync(path.join(here, 'ai-pin-credits.js'), 'utf8');
const usageSource = readFileSync(path.join(here, 'ai-pin-credit-usage.js'), 'utf8');
const engineSource = readFileSync(path.join(here, 'credits-engine.js'), 'utf8');
const configSource = readFileSync(path.join(here, 'workspace-config.js'), 'utf8');
const dashboardSource = readFileSync(path.join(here, 'website-control-center.js'), 'utf8');
const aiPinsSource = readFileSync(path.join(here, '../routes/ai-pins.js'), 'utf8');
const websitesSource = readFileSync(path.join(here, '../routes/websites.js'), 'utf8');
const integratedAiSource = readFileSync(path.join(here, '../routes/integrated-ai.js'), 'utf8');

function walletFixture(overrides = {}) {
	return {
		workspaceKey: 'ws-a',
		workspaceName: 'Workspace A',
		balance: 40,
		purchasedCredits: 0,
		bonusCredits: 0,
		usedTotal: 260,
		monthlyQuota: 300,
		remaining: 40,
		suspended: false,
		billingStatus: 'active',
		planSlug: 'starter',
		planName: 'Starter',
		lastResetAt: '',
		periodEnd: '',
		...overrides,
	};
}

describe('creditUsageFromWallet', () => {
	it('uses wallet remaining / usedTotal / monthlyQuota for AI and image', () => {
		const wallet = walletFixture();
		const usage = creditUsageFromWallet(wallet);
		assert.equal(usage.plan, 'starter');
		assert.deepEqual(usage.ai, { used: 260, limit: 300, remaining: 40 });
		assert.deepEqual(usage.image, { used: 260, limit: 300, remaining: 40 });
		assert.equal(usage.wallet, wallet);
	});

	it('uses the wallet plan slug for agency instead of hardcoded business limits', () => {
		const wallet = walletFixture({
			planSlug: 'agency',
			planName: 'Agency',
			monthlyQuota: 8000,
			usedTotal: 120,
			remaining: 7880,
			balance: 7880,
		});
		const usage = creditUsageFromWallet(wallet);
		assert.equal(usage.plan, 'agency');
		assert.equal(usage.ai.limit, 8000);
		assert.equal(usage.ai.used, 120);
		assert.equal(usage.ai.remaining, 7880);
		assert.equal(usage.image.limit, 8000);
		assert.notEqual(usage.ai.limit, 2500);
	});

	it('does not invent values from PLAN_CREDITS when wallet numbers are zero', () => {
		const usage = creditUsageFromWallet(walletFixture({
			planSlug: 'free',
			monthlyQuota: 0,
			usedTotal: 0,
			remaining: 0,
			balance: 0,
		}));
		assert.deepEqual(usage.ai, { used: 0, limit: 0, remaining: 0 });
		assert.deepEqual(usage.image, { used: 0, limit: 0, remaining: 0 });
	});
});

describe('requireExplicitWorkspaceKey', () => {
	it('fails closed for missing, empty, and whitespace keys', () => {
		for (const value of [undefined, null, '', '   ', '\n\t']) {
			assert.throws(() => requireExplicitWorkspaceKey(value), (error) => {
				assert.equal(error.status, 422);
				assert.equal(error.errorCode, 'VALIDATION_ERROR');
				assert.match(String(error.message), /workspaceKey is required/i);
				return true;
			});
		}
	});

	it('accepts a trimmed workspace key', () => {
		assert.equal(requireExplicitWorkspaceKey('  ws-a  '), 'ws-a');
	});
});

describe('readWorkspaceCreditUsage', () => {
	it('reads remaining/used/limit from the requested workspace wallet', async () => {
		const wallets = {
			'ws-a': walletFixture({ workspaceKey: 'ws-a', remaining: 11, usedTotal: 89, monthlyQuota: 100, planSlug: 'starter' }),
			'ws-b': walletFixture({ workspaceKey: 'ws-b', remaining: 500, usedTotal: 10, monthlyQuota: 510, planSlug: 'agency' }),
		};
		const getWallet = async (key) => {
			if (!wallets[key]) throw Object.assign(new Error('not found'), { status: 404 });
			return wallets[key];
		};
		const leftoverUser = {
			id: 'owner-1',
			plan: 'business',
			ai_credits_used: 9999,
			image_credits_used: 8888,
		};

		const a = await readWorkspaceCreditUsage('ws-a', getWallet);
		const b = await readWorkspaceCreditUsage('ws-b', getWallet);

		assert.equal(a.ai.remaining, 11);
		assert.equal(a.ai.used, 89);
		assert.equal(a.ai.limit, 100);
		assert.equal(a.plan, 'starter');
		assert.equal(b.ai.remaining, 500);
		assert.equal(b.ai.used, 10);
		assert.equal(b.ai.limit, 510);
		assert.equal(b.plan, 'agency');
		assert.notEqual(a.ai.used, leftoverUser.ai_credits_used);
		assert.notEqual(b.image.used, leftoverUser.image_credits_used);
		assert.notEqual(b.ai.limit, 2500);
	});

	it('fails closed when the workspace key is missing and does not fall back to user id', async () => {
		let walletKey = null;
		const getWallet = async (key) => {
			walletKey = key;
			return walletFixture({ workspaceKey: key });
		};
		await assert.rejects(
			() => readWorkspaceCreditUsage('', getWallet),
			(error) => error.status === 422,
		);
		await assert.rejects(
			() => readWorkspaceCreditUsage('   ', getWallet),
			(error) => error.status === 422,
		);
		assert.equal(walletKey, null);
	});

	it('does not fall back to PLAN_CREDITS when wallet lookup fails', async () => {
		const getWallet = async () => {
			throw Object.assign(new Error('Workspace subscription not found'), { status: 404, errorCode: 'NOT_FOUND' });
		};
		await assert.rejects(
			() => readWorkspaceCreditUsage('ws-missing', getWallet),
			(error) => error.status === 404,
		);
	});
});

describe('legacy user counters are display leftovers only', () => {
	it('consumeBillableAiFeature does not write users.ai_credits_used', async () => {
		const updates = [];
		const pocketbaseClient = {
			collection: (name) => {
				if (name === 'users') {
					return {
						getOne: async () => ({ id: 'u1', ai_credits_used: 3, image_credits_used: 1 }),
						update: async (id, data) => {
							updates.push({ id, data });
							return data;
						},
					};
				}
				throw new Error(`unexpected collection ${name}`);
			},
		};
		const result = await consumeBillableAiFeature(pocketbaseClient, {
			userId: 'u1',
			workspaceKey: 'ws-a',
			feature: 'ai_analyze',
			source: 'openai',
			units: 1,
		}, {
			consumeFeatureCredits: async () => ({ burned: 1, workspaceKey: 'ws-a' }),
		});
		assert.deepEqual(result, { burned: 1, workspaceKey: 'ws-a' });
		assert.equal(updates.length, 0);
	});

	it('consumeCredits does not write leftover user counters and returns wallet usage', async () => {
		const updates = [];
		const consumeCalls = [];
		const pocketbaseClient = {
			collection: (name) => {
				if (name === 'users') {
					return {
						getOne: async () => ({ id: 'u1', ai_credits_used: 3, image_credits_used: 1, plan: 'free' }),
						update: async (id, data) => {
							updates.push({ id, data });
							return data;
						},
					};
				}
				throw new Error(`unexpected collection ${name}`);
			},
		};
		const usage = await consumeCredits(pocketbaseClient, {
			userId: 'u1',
			workspaceKey: 'ws-a',
			ai: 0,
			image: 1,
		}, {
			consumeFeatureCredits: async (_pb, payload) => {
				consumeCalls.push(payload);
				return { burned: 1 };
			},
			getUserCreditUsage: async (_pb, _userId, workspaceKey) => creditUsageFromWallet(walletFixture({
				workspaceKey,
				remaining: 39,
				usedTotal: 261,
				monthlyQuota: 300,
			})),
		});
		assert.equal(updates.length, 0);
		assert.equal(consumeCalls.length, 1);
		assert.equal(consumeCalls[0].workspaceKey, 'ws-a');
		assert.equal(consumeCalls[0].feature, 'ai_image');
		assert.equal(usage.ai.remaining, 39);
		assert.equal(usage.ai.used, 261);
		assert.equal(usage.ai.limit, 300);
	});
});

describe('CR-P0-1 wiring', () => {
	it('removes PLAN_CREDITS and owner/user-id fallback from customer-facing usage', () => {
		assert.doesNotMatch(creditsSource, /const PLAN_CREDITS/);
		assert.doesNotMatch(usageSource, /const PLAN_CREDITS/);
		assert.doesNotMatch(creditsSource, /export function getPlanCreditLimits/);
		assert.doesNotMatch(creditsSource, /key === 'agency'/);
		assert.doesNotMatch(usageSource, /key === 'agency'/);
		assert.match(creditsSource, /readWorkspaceCreditUsage\(workspaceKeyOverride/);
		assert.match(usageSource, /requireExplicitWorkspaceKey\(workspaceKeyOverride\)/);
		assert.doesNotMatch(creditsSource, /workspaceKeyOverride \|\| workspaceKeyForUser/);
		assert.doesNotMatch(usageSource, /workspaceKeyForUser/);
		assert.doesNotMatch(creditsSource, /user\?\.ai_credits_used/);
		assert.doesNotMatch(creditsSource, /user\?\.image_credits_used/);
	});

	it('stops leftover display writes on consume and settlement paths', () => {
		assert.doesNotMatch(creditsSource, /ai_credits_used:/);
		assert.doesNotMatch(creditsSource, /image_credits_used:/);
		assert.doesNotMatch(usageSource, /ai_credits_used:/);
		assert.doesNotMatch(usageSource, /image_credits_used:/);
		assert.doesNotMatch(engineSource, /bumpLegacyAiCounterForUserId/);
		assert.doesNotMatch(engineSource, /ai_credits_used:/);
		assert.doesNotMatch(integratedAiSource, /bumpLegacyAiCounterForUserId/);
	});

	it('keeps reservation / commit / lock math in credits-engine', () => {
		assert.match(engineSource, /export async function reserveCredits/);
		assert.match(engineSource, /export async function commitReservation/);
		assert.match(engineSource, /export async function releaseReservation/);
		assert.match(engineSource, /withWorkspaceCreditLock/);
		assert.match(engineSource, /export async function beginFeatureReservation/);
		assert.match(engineSource, /export async function settleFeatureReservation/);
		assert.match(engineSource, /if \(success\) \{[\s\S]*?commitReservation\(id/);
	});

	it('passes the active request workspace key through config, dashboard, and ai-pins', () => {
		assert.match(configSource, /getUserCreditUsage\(pocketbaseClient, ownerId, req\.workspaceKey\)/);
		assert.match(dashboardSource, /getUserCreditUsage\(pocketbaseClient, ownerId, workspaceKey\)/);
		assert.match(websitesSource, /workspaceKey: req\.workspaceKey/);
		assert.match(aiPinsSource, /getUserCreditUsage\(\s*pocketbaseClient,\s*workspaceOwnerId\(req\),\s*req\.workspaceKey,/);
		assert.doesNotMatch(aiPinsSource, /req\.workspaceKey \|\| ''/);
	});
});
