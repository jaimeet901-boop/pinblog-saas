/**
 * Transactional subscription welcome / plan-change confirmation email.
 * Best-effort only — never blocks or rolls back billing activation.
 */

import { createSmtpTransport, logSmtpOperational, readSmtpEnvConfig } from './smtp-transport.js';

function logWarn(message, meta = {}) {
	const safe = { ...meta };
	for (const key of Object.keys(safe)) {
		const lower = key.toLowerCase();
		if (lower.includes('pass') || lower.includes('password') || lower.includes('secret')) {
			delete safe[key];
		}
	}
	console.log(`[WARN] ${message}`, safe);
}

async function getPocketbaseClient() {
	const mod = await import('../../utils/pocketbaseClient.js');
	return mod.default;
}

async function getIdempotencyApi() {
	return import('../billing/idempotency.js');
}

export const WELCOME_EMAIL_SCOPE = 'subscription_welcome_email';

export function buildWelcomeEmailIdempotencyKey(transactionId) {
	const id = String(transactionId || '').trim();
	if (!id) return '';
	return `welcome-email:paddle-txn:${id}`.slice(0, 180);
}

export function shouldSendSubscriptionWelcomeEmail({ kind, activated, duplicate } = {}) {
	if (duplicate) return false;
	if (activated !== true) return false;
	const normalized = String(kind || '').trim().toLowerCase();
	return normalized === 'activation' || normalized === 'plan_change';
}

/**
 * @param {string} email
 * @returns {string} domain only (safe for logs)
 */
export function recipientDomain(email = '') {
	const at = String(email || '').indexOf('@');
	if (at < 0) return '';
	return String(email).slice(at + 1).toLowerCase().slice(0, 120);
}

export function transactionIdSuffix(transactionId = '') {
	const id = String(transactionId || '').trim();
	if (id.length <= 8) return id;
	return id.slice(-8);
}

export function resolveDisplayName({ ownerName = '', email = '' } = {}) {
	const name = String(ownerName || '').trim();
	if (name) return name;
	const local = String(email || '').split('@')[0]?.trim();
	if (local) return local;
	return 'there';
}

/**
 * Resolve recipient + display name from subscription / workspace / owner user.
 * Pure aside from injected loaders (tests) or PocketBase (default).
 */
export async function resolveWelcomeRecipient({
	subscription = null,
	workspaceKey = '',
	loadWorkspace,
	loadUser,
} = {}) {
	const getWorkspace = loadWorkspace || (async (key) => {
		if (!key) return null;
		const pocketbaseClient = await getPocketbaseClient();
		return pocketbaseClient.collection('workspaces').getFirstListItem(
			pocketbaseClient.filter('workspace_key = {:key}', { key }),
			{ requestKey: null },
		).catch(() => null);
	});
	const getUser = loadUser || (async (id) => {
		if (!id) return null;
		const pocketbaseClient = await getPocketbaseClient();
		return pocketbaseClient.collection('users').getOne(id).catch(() => null);
	});

	const workspace = await getWorkspace(workspaceKey || subscription?.workspace_key || '');
	const ownerId = typeof workspace?.owner === 'string'
		? workspace.owner
		: String(workspace?.owner?.id || '').trim();
	const owner = ownerId ? await getUser(ownerId) : null;

	const email = String(
		subscription?.owner_email
		|| workspace?.billing_email
		|| owner?.email
		|| '',
	).trim().toLowerCase();

	const displayName = resolveDisplayName({
		ownerName: owner?.name || '',
		email,
	});

	return { email, displayName, workspace, owner };
}

export function formatPlanPrice({ plan, interval } = {}) {
	const normalized = String(interval || 'monthly').trim().toLowerCase();
	const yearly = Number(plan?.yearly_price ?? plan?.yearlyPrice);
	const monthly = Number(plan?.monthly_price ?? plan?.monthlyPrice ?? plan?.price);
	if (normalized === 'yearly' || normalized === 'year' || normalized === 'annual') {
		const amount = Number.isFinite(yearly) ? yearly : (Number.isFinite(monthly) ? monthly * 10 : 0);
		return { amount, label: `$${amount}/year`, intervalLabel: 'yearly' };
	}
	const amount = Number.isFinite(monthly) ? monthly : 0;
	return { amount, label: `$${amount}/month`, intervalLabel: 'monthly' };
}

export function buildSubscriptionWelcomeEmailContent({
	kind = 'activation',
	displayName = 'there',
	planName = 'Plan',
	priceLabel = '',
	intervalLabel = 'monthly',
	credits = 0,
	activationDate = new Date(),
} = {}) {
	const isPlanChange = String(kind).toLowerCase() === 'plan_change';
	const dateLabel = formatActivationDate(activationDate);
	const subject = isPlanChange
		? `Your Seodeva plan has been updated to ${planName}`
		: `Welcome to Seodeva — Your ${planName} plan is active`;

	const greeting = `Hi ${displayName},`;
	const lead = isPlanChange
		? `Thank you for updating your Seodeva subscription. Your workspace is now on the ${planName} plan.`
		: `Welcome to Seodeva — thank you for subscribing. Your ${planName} plan is now active.`;

	const text = [
		greeting,
		'',
		lead,
		'',
		`Plan: ${planName}`,
		`Price: ${priceLabel}`,
		`Billing interval: ${intervalLabel}`,
		`Included credits: ${Number(credits) || 0}`,
		`Date: ${dateLabel}`,
		'',
		'You can manage your plan anytime from Subscription in your workspace.',
		'',
		'— The Seodeva team',
		'https://seodeva.com',
	].join('\n');

	const html = [
		`<!DOCTYPE html><html><body style="font-family:Georgia,'Times New Roman',serif;background:#f7f4ef;color:#1c1917;padding:24px;">`,
		`<div style="max-width:560px;margin:0 auto;background:#fffaf5;border:1px solid #e7e0d6;border-radius:16px;padding:28px;">`,
		`<p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#9a3412;">Seodeva</p>`,
		`<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;">${escapeHtml(isPlanChange ? 'Plan updated' : 'Welcome aboard')}</h1>`,
		`<p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(greeting)}</p>`,
		`<p style="margin:0 0 20px;font-size:16px;line-height:1.5;">${escapeHtml(lead)}</p>`,
		`<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px;">`,
		rowHtml('Plan', planName),
		rowHtml('Price', priceLabel),
		rowHtml('Billing interval', intervalLabel),
		rowHtml('Included credits', String(Number(credits) || 0)),
		rowHtml('Date', dateLabel),
		`</table>`,
		`<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#57534e;">Manage your plan anytime from Subscription in your workspace.</p>`,
		`<p style="margin:20px 0 0;font-size:14px;color:#9a3412;">— The Seodeva team</p>`,
		`</div></body></html>`,
	].join('');

	return { subject, text, html };
}

function formatActivationDate(value) {
	const date = value instanceof Date ? value : new Date(value || Date.now());
	if (!Number.isFinite(date.getTime())) {
		return new Date().toISOString().slice(0, 10);
	}
	return date.toISOString().slice(0, 10);
}

function escapeHtml(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function rowHtml(label, value) {
	return `<tr><td style="padding:8px 0;border-bottom:1px solid #efe8de;color:#78716c;">${escapeHtml(label)}</td>`
		+ `<td style="padding:8px 0;border-bottom:1px solid #efe8de;text-align:right;font-weight:600;">${escapeHtml(value)}</td></tr>`;
}

/**
 * Claim welcome-email idempotency; allow retry when prior attempt failed.
 */
export async function claimWelcomeEmailIdempotency({
	transactionId,
	workspaceKey = '',
	claimFn,
	resetFn,
} = {}) {
	const idempotencyKey = buildWelcomeEmailIdempotencyKey(transactionId);
	if (!idempotencyKey) {
		return { ok: false, reason: 'missing_transaction_id' };
	}

	let claim = claimFn;
	let reset = resetFn;
	if (!claim || !reset) {
		const api = await getIdempotencyApi();
		claim = claim || api.claimIdempotencyKey;
		reset = reset || api.resetIdempotencyForRetry;
	}

	const claimed = await claim({
		idempotencyKey,
		scope: WELCOME_EMAIL_SCOPE,
		workspaceKey,
		provider: 'paddle',
		eventType: 'subscription_welcome_email',
		payload: { transactionId },
	});

	if (!claimed.duplicate) {
		return { ok: true, record: claimed.record, idempotencyKey, retried: false };
	}

	const status = String(claimed.record?.status || '').trim().toLowerCase();
	if (status === 'completed') {
		return { ok: false, reason: 'duplicate', record: claimed.record, idempotencyKey };
	}

	if (status === 'failed') {
		const resetRecord = await reset(claimed.record.id, {
			payload: { transactionId },
		});
		if (!resetRecord) {
			return { ok: false, reason: 'reset_failed', record: claimed.record, idempotencyKey };
		}
		return { ok: true, record: resetRecord, idempotencyKey, retried: true };
	}

	return { ok: false, reason: 'duplicate_or_in_progress', record: claimed.record, idempotencyKey };
}

/**
 * Send subscription welcome / plan-change email (best-effort).
 *
 * @returns {Promise<{ sent: boolean, reason?: string, skipped?: boolean }>}
 */
export async function sendSubscriptionWelcomeEmail({
	kind = 'activation',
	subscription = null,
	plan = null,
	verified = {},
	workspaceKey = '',
	transactionId = '',
	activationDate = new Date(),
	deps = {},
} = {}) {
	const txnId = String(transactionId || verified.transactionId || '').trim();
	const wsKey = String(workspaceKey || subscription?.workspace_key || verified.workspaceKey || '').trim();
	let claimRecordId = '';

	try {
		const claim = await (deps.claimWelcomeEmailIdempotency || claimWelcomeEmailIdempotency)({
			transactionId: txnId,
			workspaceKey: wsKey,
			claimFn: deps.claimIdempotencyKey,
			resetFn: deps.resetIdempotencyForRetry,
		});

		if (!claim.ok) {
			return { sent: false, skipped: true, reason: claim.reason || 'idempotency_skip' };
		}
		claimRecordId = claim.record?.id || '';

		const resolveRecipient = deps.resolveWelcomeRecipient || resolveWelcomeRecipient;
		const { email, displayName } = await resolveRecipient({
			subscription,
			workspaceKey: wsKey,
			loadWorkspace: deps.loadWorkspace,
			loadUser: deps.loadUser,
		});

		if (!email) {
			const fail = deps.failIdempotency || (await getIdempotencyApi()).failIdempotency;
			await fail(claimRecordId, 'missing_recipient');
			logSmtpOperational('subscription welcome email skipped', {
				reason: 'missing_recipient',
				transactionSuffix: transactionIdSuffix(txnId),
				kind,
			});
			return { sent: false, reason: 'missing_recipient' };
		}

		const price = formatPlanPrice({ plan, interval: verified.interval });
		const content = buildSubscriptionWelcomeEmailContent({
			kind,
			displayName,
			planName: plan?.name || verified.planSlug || 'Plan',
			priceLabel: price.label,
			intervalLabel: price.intervalLabel,
			credits: Number(plan?.credits) || 0,
			activationDate,
		});

		const createTransport = deps.createSmtpTransport || createSmtpTransport;
		const { transport, config, reason: transportReason } = await createTransport({
			env: deps.env,
			nodemailer: deps.nodemailer,
		});

		if (!transport) {
			const fail = deps.failIdempotency || (await getIdempotencyApi()).failIdempotency;
			await fail(claimRecordId, transportReason || 'smtp_unavailable');
			logSmtpOperational('subscription welcome email failed', {
				reason: transportReason || 'smtp_unavailable',
				transactionSuffix: transactionIdSuffix(txnId),
				recipientDomain: recipientDomain(email),
				kind,
				smtpConfigured: Boolean(readSmtpEnvConfig(deps.env || process.env).configured),
			});
			return { sent: false, reason: transportReason || 'smtp_unavailable' };
		}

		const sendMail = deps.sendMail || ((mail) => transport.sendMail(mail));
		await sendMail({
			from: config.from,
			to: email,
			subject: content.subject,
			text: content.text,
			html: content.html,
		});

		const complete = deps.completeIdempotency || (await getIdempotencyApi()).completeIdempotency;
		await complete(claimRecordId, {
			sent: true,
			toDomain: recipientDomain(email),
			kind,
			planSlug: plan?.slug || verified.planSlug || '',
		});

		logSmtpOperational('subscription welcome email sent', {
			transactionSuffix: transactionIdSuffix(txnId),
			recipientDomain: recipientDomain(email),
			kind,
		});

		return { sent: true };
	} catch (error) {
		const message = error?.message || String(error || 'send_failed');
		const errorType = error?.code || error?.name || 'Error';
		if (claimRecordId) {
			const fail = deps.failIdempotency || (await getIdempotencyApi()).failIdempotency;
			await fail(claimRecordId, message).catch(() => null);
		}

		logWarn('subscription welcome email failed', {
			transactionSuffix: transactionIdSuffix(txnId),
			recipientDomain: '',
			errorType,
			kind,
		});

		return { sent: false, reason: 'send_failed', errorType };
	}
}

/**
 * Fire-and-forget wrapper used by activation — never throws to caller.
 */
export async function maybeSendSubscriptionWelcomeEmail(input = {}) {
	try {
		if (!shouldSendSubscriptionWelcomeEmail(input)) {
			return { sent: false, skipped: true, reason: 'not_eligible' };
		}
		return await sendSubscriptionWelcomeEmail(input);
	} catch (error) {
		logWarn('subscription welcome email failed', {
			transactionSuffix: transactionIdSuffix(input.transactionId || input.verified?.transactionId),
			errorType: error?.name || 'Error',
			kind: input.kind,
		});
		return { sent: false, reason: 'unexpected_error' };
	}
}
