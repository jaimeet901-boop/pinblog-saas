/**
 * Subscription welcome email — focused unit tests.
 * Run: node --test src/services/email/subscription-welcome-mail.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
	buildSubscriptionWelcomeEmailContent,
	buildWelcomeEmailIdempotencyKey,
	claimWelcomeEmailIdempotency,
	formatPlanPrice,
	maybeSendSubscriptionWelcomeEmail,
	recipientDomain,
	resolveDisplayName,
	resolveWelcomeRecipient,
	sendSubscriptionWelcomeEmail,
	shouldSendSubscriptionWelcomeEmail,
	transactionIdSuffix,
} from './subscription-welcome-mail.js';
import { readSmtpEnvConfig } from './smtp-transport.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('shouldSendSubscriptionWelcomeEmail', () => {
	it('sends for activation and plan_change when activated', () => {
		assert.equal(shouldSendSubscriptionWelcomeEmail({ kind: 'activation', activated: true }), true);
		assert.equal(shouldSendSubscriptionWelcomeEmail({ kind: 'plan_change', activated: true }), true);
	});

	it('does not send for renewal, duplicate, or inactive', () => {
		assert.equal(shouldSendSubscriptionWelcomeEmail({ kind: 'renewal', activated: true }), false);
		assert.equal(shouldSendSubscriptionWelcomeEmail({ kind: 'activation', activated: true, duplicate: true }), false);
		assert.equal(shouldSendSubscriptionWelcomeEmail({ kind: 'activation', activated: false }), false);
	});
});

describe('recipient + content helpers', () => {
	it('resolves recipient fallback chain', async () => {
		const withOwnerEmail = await resolveWelcomeRecipient({
			subscription: { owner_email: 'owner@example.com' },
			workspaceKey: 'ws-1',
			loadWorkspace: async () => ({ billing_email: 'billing@example.com', owner: 'u1' }),
			loadUser: async () => ({ email: 'user@example.com', name: 'Ada' }),
		});
		assert.equal(withOwnerEmail.email, 'owner@example.com');
		assert.equal(withOwnerEmail.displayName, 'Ada');

		const withBilling = await resolveWelcomeRecipient({
			subscription: {},
			workspaceKey: 'ws-1',
			loadWorkspace: async () => ({ billing_email: 'billing@Example.com', owner: 'u1' }),
			loadUser: async () => ({ email: 'user@example.com', name: '' }),
		});
		assert.equal(withBilling.email, 'billing@example.com');

		const withUser = await resolveWelcomeRecipient({
			subscription: {},
			workspaceKey: 'ws-1',
			loadWorkspace: async () => ({ billing_email: '', owner: 'u1' }),
			loadUser: async () => ({ email: 'user@example.com', name: '' }),
		});
		assert.equal(withUser.email, 'user@example.com');
		assert.equal(withUser.displayName, 'user');
	});

	it('resolves display name fallbacks', () => {
		assert.equal(resolveDisplayName({ ownerName: 'Ada', email: 'a@b.com' }), 'Ada');
		assert.equal(resolveDisplayName({ ownerName: '', email: 'chef@seodeva.com' }), 'chef');
		assert.equal(resolveDisplayName({}), 'there');
	});

	it('builds activation and plan_change subjects', () => {
		const activation = buildSubscriptionWelcomeEmailContent({
			kind: 'activation',
			displayName: 'Ada',
			planName: 'Pro',
			priceLabel: '$49/month',
			intervalLabel: 'monthly',
			credits: 2000,
			activationDate: '2026-08-22',
		});
		assert.match(activation.subject, /Welcome to Seodeva — Your Pro plan is active/);
		assert.match(activation.text, /Ada/);
		assert.match(activation.text, /2000/);
		assert.doesNotMatch(activation.text, /card|cvv|password|SMTP/i);

		const change = buildSubscriptionWelcomeEmailContent({
			kind: 'plan_change',
			displayName: 'Ada',
			planName: 'Business',
			priceLabel: '$129/month',
			intervalLabel: 'monthly',
			credits: 8000,
		});
		assert.match(change.subject, /updated to Business/);
	});

	it('formats prices by interval', () => {
		assert.equal(formatPlanPrice({ plan: { monthly_price: 49, yearly_price: 490 }, interval: 'monthly' }).label, '$49/month');
		assert.equal(formatPlanPrice({ plan: { monthly_price: 49, yearly_price: 490 }, interval: 'yearly' }).label, '$490/year');
	});

	it('redacts sensitive log helpers', () => {
		assert.equal(recipientDomain('ada@seodeva.com'), 'seodeva.com');
		assert.equal(transactionIdSuffix('txn_abcdefghijkl'), 'efghijkl');
		assert.equal(buildWelcomeEmailIdempotencyKey('txn_123'), 'welcome-email:paddle-txn:txn_123');
	});
});

describe('idempotency claim + send', () => {
	it('activation sends email and completes idempotency', async () => {
		const completed = [];
		const mails = [];
		const result = await sendSubscriptionWelcomeEmail({
			kind: 'activation',
			subscription: { owner_email: 'ada@example.com', workspace_key: 'ws-1' },
			plan: { name: 'Pro', slug: 'pro', credits: 2000, monthly_price: 49 },
			verified: { interval: 'monthly', transactionId: 'txn_act_1', planSlug: 'pro' },
			workspaceKey: 'ws-1',
			transactionId: 'txn_act_1',
			deps: {
				claimWelcomeEmailIdempotency: async () => ({ ok: true, record: { id: 'idem-1' } }),
				resolveWelcomeRecipient: async () => ({ email: 'ada@example.com', displayName: 'Ada' }),
				createSmtpTransport: async () => ({
					transport: { sendMail: async () => ({}) },
					config: { from: 'contact@seodeva.com' },
					reason: null,
				}),
				sendMail: async (mail) => { mails.push(mail); },
				completeIdempotency: async (id, payload) => { completed.push({ id, payload }); },
				failIdempotency: async () => assert.fail('should not fail'),
			},
		});
		assert.equal(result.sent, true);
		assert.equal(mails.length, 1);
		assert.match(mails[0].subject, /Welcome to Seodeva/);
		assert.equal(mails[0].from, 'contact@seodeva.com');
		assert.equal(completed[0].id, 'idem-1');
		assert.equal(completed[0].payload.sent, true);
	});

	it('plan_change sends updated subject', async () => {
		const mails = [];
		const result = await sendSubscriptionWelcomeEmail({
			kind: 'plan_change',
			subscription: { owner_email: 'ada@example.com' },
			plan: { name: 'Business', slug: 'business', credits: 8000, monthly_price: 129 },
			verified: { interval: 'monthly', transactionId: 'txn_chg_1' },
			transactionId: 'txn_chg_1',
			deps: {
				claimWelcomeEmailIdempotency: async () => ({ ok: true, record: { id: 'idem-2' } }),
				resolveWelcomeRecipient: async () => ({ email: 'ada@example.com', displayName: 'Ada' }),
				createSmtpTransport: async () => ({
					transport: {},
					config: { from: 'contact@seodeva.com' },
					reason: null,
				}),
				sendMail: async (mail) => { mails.push(mail); },
				completeIdempotency: async () => null,
				failIdempotency: async () => null,
			},
		});
		assert.equal(result.sent, true);
		assert.match(mails[0].subject, /updated to Business/);
	});

	it('duplicate completed idempotency does not send', async () => {
		const mails = [];
		const result = await sendSubscriptionWelcomeEmail({
			kind: 'activation',
			transactionId: 'txn_dup',
			deps: {
				claimWelcomeEmailIdempotency: async () => ({ ok: false, reason: 'duplicate' }),
				sendMail: async (mail) => { mails.push(mail); },
			},
		});
		assert.equal(result.sent, false);
		assert.equal(result.skipped, true);
		assert.equal(mails.length, 0);
	});

	it('failed prior claim can be reset for retry', async () => {
		const resets = [];
		const claim = await claimWelcomeEmailIdempotency({
			transactionId: 'txn_retry',
			workspaceKey: 'ws-1',
			claimFn: async () => ({
				duplicate: true,
				record: { id: 'idem-failed', status: 'failed' },
			}),
			resetFn: async (id) => {
				resets.push(id);
				return { id, status: 'processing' };
			},
		});
		assert.equal(claim.ok, true);
		assert.equal(claim.retried, true);
		assert.deepEqual(resets, ['idem-failed']);
	});

	it('SMTP failure marks idempotency failed and does not throw', async () => {
		const failed = [];
		const result = await sendSubscriptionWelcomeEmail({
			kind: 'activation',
			transactionId: 'txn_fail',
			deps: {
				claimWelcomeEmailIdempotency: async () => ({ ok: true, record: { id: 'idem-3' } }),
				resolveWelcomeRecipient: async () => ({ email: 'ada@example.com', displayName: 'Ada' }),
				createSmtpTransport: async () => ({
					transport: {},
					config: { from: 'contact@seodeva.com' },
					reason: null,
				}),
				sendMail: async () => { throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }); },
				completeIdempotency: async () => assert.fail('should not complete'),
				failIdempotency: async (id, msg) => { failed.push({ id, msg }); },
			},
		});
		assert.equal(result.sent, false);
		assert.equal(result.reason, 'send_failed');
		assert.equal(failed[0].id, 'idem-3');
	});

	it('maybeSend skips renewal without calling send path', async () => {
		const result = await maybeSendSubscriptionWelcomeEmail({
			kind: 'renewal',
			activated: true,
			duplicate: false,
			transactionId: 'txn_renew',
		});
		assert.equal(result.skipped, true);
		assert.equal(result.reason, 'not_eligible');
	});
});

describe('activatePaddleSubscription wiring + secret safety', () => {
	it('hooks welcome mail after paddle activation; renew path has no welcome mail', () => {
		const source = readFileSync(path.join(here, '../billing/subscriptions.js'), 'utf8');
		assert.match(source, /maybeSendSubscriptionWelcomeEmail/);
		const activateIdx = source.indexOf('export async function activatePaddleSubscription');
		const renewIdx = source.indexOf('export async function renewPaddleSubscription');
		assert.ok(activateIdx >= 0 && renewIdx > activateIdx);
		const activateBlock = source.slice(activateIdx, renewIdx);
		assert.match(activateBlock, /maybeSendSubscriptionWelcomeEmail/);
		assert.match(activateBlock, /completeIdempotency\(idem\.record\.id, result\)/);
		const mailIdx = activateBlock.indexOf('maybeSendSubscriptionWelcomeEmail');
		const completeIdx = activateBlock.indexOf('completeIdempotency(idem.record.id, result)');
		assert.ok(completeIdx >= 0 && mailIdx > completeIdx, 'email must run after activation idempotency completes');
		const renewBlock = source.slice(renewIdx, renewIdx + 4000);
		assert.doesNotMatch(renewBlock, /maybeSendSubscriptionWelcomeEmail/);
	});

	it('SMTP env reader never exposes password in config object', () => {
		const config = readSmtpEnvConfig({
			SMTP_HOST: 'smtp.hostinger.com',
			SMTP_PORT: '465',
			SMTP_SECURE: 'true',
			SMTP_USER: 'contact@seodeva.com',
			SMTP_PASS: 'super-secret-password',
			SMTP_FROM: 'contact@seodeva.com',
		});
		assert.equal(config.hasPass, true);
		assert.equal('pass' in config, false);
		assert.equal(JSON.stringify(config).includes('super-secret-password'), false);
	});

	it('source never logs SMTP_PASS or password values', () => {
		const welcome = readFileSync(path.join(here, 'subscription-welcome-mail.js'), 'utf8');
		const transport = readFileSync(path.join(here, 'smtp-transport.js'), 'utf8');
		assert.doesNotMatch(welcome, /SMTP_PASS/);
		assert.doesNotMatch(welcome, /logger\.(info|warn|error)\([^)]*pass/i);
		assert.match(transport, /never log SMTP_PASS/i);
		assert.match(transport, /delete safe\[key\]/);
	});
});
