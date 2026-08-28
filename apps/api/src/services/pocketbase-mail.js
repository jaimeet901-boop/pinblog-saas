import fs from 'node:fs/promises';
import path from 'node:path';
import pocketbaseClient from '../utils/pocketbaseClient.js';
import { getEnv } from '../utils/env.js';
import { getPlatformSettings } from './platform-settings.js';
import { decryptPinterestSecret } from '../utils/secretCrypto.js';
import logger from '../utils/logger.js';

const MAILER_STATUS_PATH = getEnv(
	'PB_MAILER_STATUS_PATH',
	path.resolve(process.cwd(), '../pocketbase/pb_data/mailer-status.json'),
);

/** In-process last test / sync error (complements PB hook status file). */
let lastApiMailError = null;

function httpError(status, message, errorCode) {
	const error = new Error(message);
	error.status = status;
	error.errorCode = errorCode;
	return error;
}

function builderMailerConfig() {
	const apiUrl = String(process.env.BUILDER_MAILER_API_URL || '').trim();
	const apiKey = String(process.env.BUILDER_MAILER_API_KEY || '').trim();
	const senderAddress = String(process.env.BUILDER_MAILER_SENDER_ADDRESS || '').trim();
	return {
		configured: Boolean(apiUrl && apiKey && senderAddress),
		apiUrl: apiUrl || null,
		senderAddress: senderAddress || null,
		apiKeySet: Boolean(apiKey),
	};
}

async function readHookMailerStatus() {
	try {
		const raw = await fs.readFile(MAILER_STATUS_PATH, 'utf8');
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

async function listMailLogs({ page = 1, perPage = 25 } = {}) {
	try {
		const result = await pocketbaseClient.logs.getList(page, perPage, {
			filter: 'message ~ "mailer" || message ~ "mail" || message ~ "smtp" || message ~ "Failed to send email"',
			sort: '-created',
		});
		return {
			page: result.page,
			perPage: result.perPage,
			totalItems: result.totalItems,
			totalPages: result.totalPages,
			items: (result.items || []).map((item) => ({
				id: item.id,
				created: item.created,
				level: item.level,
				message: item.message,
				data: item.data,
			})),
		};
	} catch (error) {
		logger.warn('pocketbase-mail: logs query failed', { message: error?.message });
		return {
			page: 1,
			perPage,
			totalItems: 0,
			totalPages: 0,
			items: [],
			error: error?.message || 'Could not load PocketBase logs',
		};
	}
}

function summarizeSettings(settings = {}) {
	const smtp = settings.smtp || {};
	const meta = settings.meta || {};
	return {
		smtpEnabled: Boolean(smtp.enabled),
		smtpHost: smtp.host || '',
		smtpPort: smtp.port ?? null,
		smtpUsername: smtp.username || '',
		smtpPasswordSet: Boolean(smtp.password),
		smtpTls: Boolean(smtp.tls),
		smtpAuthMethod: smtp.authMethod || '',
		senderName: meta.senderName || '',
		senderEmail: meta.senderAddress || '',
		appUrl: meta.appURL || meta.appUrl || '',
		metaAppName: meta.appName || '',
	};
}

/**
 * PocketBase Mail diagnostics for Admin Console.
 * Password reset / verification emails use PocketBase Mail — not platform nodemailer.
 */
export async function getPocketBaseMailDiagnostics() {
	const settings = await pocketbaseClient.settings.getAll();
	const summary = summarizeSettings(settings);
	const builder = builderMailerConfig();
	const hookStatus = await readHookMailerStatus();
	const logs = await listMailLogs({ page: 1, perPage: 30 });

	let deliveryPath = 'none';
	if (summary.smtpEnabled) deliveryPath = 'pocketbase_smtp';
	else if (builder.configured) deliveryPath = 'builder_mailer';

	const lastMailError = lastApiMailError || hookStatus?.lastError || null;
	const ready = deliveryPath !== 'none';

	return {
		ready,
		deliveryPath,
		status: ready ? (lastMailError ? 'degraded' : 'ok') : 'not_configured',
		pocketbase: summary,
		builderMailer: builder,
		platformEmailHint: {
			note: 'Admin → Global Settings → Email stores platform SMTP metadata. Password reset uses PocketBase Mail settings (or BUILDER_MAILER_* fallback). Sync them with the button below if needed.',
		},
		applicationUrl: summary.appUrl || getEnv('WEB_APP_URL', getEnv('APP_WEB_URL', '')),
		lastMailError,
		hookStatus,
		logs,
		checkedAt: new Date().toISOString(),
	};
}

export async function sendPocketBaseTestEmail({ toEmail, template = 'password-reset' } = {}) {
	const email = String(toEmail || '').trim().toLowerCase();
	if (!email || !email.includes('@')) {
		throw httpError(422, 'A valid toEmail is required.', 'VALIDATION_ERROR');
	}

	const allowed = new Set(['verification', 'password-reset', 'email-change']);
	const emailTemplate = allowed.has(String(template)) ? String(template) : 'password-reset';

	try {
		await pocketbaseClient.settings.testEmail('users', email, emailTemplate);
		lastApiMailError = null;
		logger.info('pocketbase-mail: test email accepted by PocketBase', { email, emailTemplate });
		return {
			ok: true,
			toEmail: email,
			template: emailTemplate,
			message: 'Test email request accepted by PocketBase. Check the inbox and Mail logs — HTTP success does not guarantee SMTP delivery.',
			warning: 'PocketBase may return success before the mailer finishes. Confirm delivery in Mail logs / last error.',
		};
	} catch (error) {
		const detail = {
			at: new Date().toISOString(),
			source: 'api_test_email',
			toEmail: email,
			template: emailTemplate,
			message: error?.response?.message || error?.message || 'Test email failed',
			data: error?.response?.data || error?.data || null,
		};
		lastApiMailError = detail;
		logger.error('pocketbase-mail: test email failed', detail);
		throw httpError(error?.status || 500, detail.message, 'TEST_EMAIL_FAILED');
	}
}

/**
 * Push platform-settings SMTP into PocketBase settings so password-reset mail works.
 */
export async function syncPlatformSmtpToPocketBase() {
	const platform = await getPlatformSettings();
	const email = platform?.email || {};
	const host = String(email.smtpHost || '').trim();
	const senderEmail = String(email.senderEmail || '').trim();

	if (!host || !senderEmail) {
		throw httpError(
			422,
			'Platform Email Settings need smtpHost and senderEmail before syncing to PocketBase.',
			'PLATFORM_SMTP_INCOMPLETE',
		);
	}

	let password = '';
	try {
		const row = await pocketbaseClient.collection('platform_settings').getFirstListItem(
			pocketbaseClient.filter('config_key = {:key}', { key: 'platform' }),
			{ requestKey: null },
		);
		const cipher = row?.payload?.email?.smtpPasswordCipher || '';
		if (cipher) {
			password = decryptPinterestSecret(cipher);
		}
	} catch (error) {
		logger.warn('pocketbase-mail: could not load platform SMTP password', { message: error?.message });
	}

	const current = await pocketbaseClient.settings.getAll();
	const port = Number(email.smtpPort) || 587;
	const next = {
		smtp: {
			...(current.smtp || {}),
			enabled: true,
			host,
			port,
			username: String(email.smtpUsername || '').trim(),
			...(password ? { password } : {}),
			tls: port === 465 || port === 587,
		},
		meta: {
			...(current.meta || {}),
			senderName: String(email.senderName || current.meta?.senderName || 'Seodeva').trim(),
			senderAddress: senderEmail,
			appURL: String(
				current.meta?.appURL
				|| getEnv('WEB_APP_URL', getEnv('APP_WEB_URL', '')),
			).trim(),
		},
	};

	try {
		const updated = await pocketbaseClient.settings.update(next);
		lastApiMailError = null;
		logger.info('pocketbase-mail: synced platform SMTP to PocketBase', { host, senderEmail });
		return {
			ok: true,
			message: password
				? 'Platform SMTP settings were applied to PocketBase Mail.'
				: 'Platform SMTP applied. No stored SMTP password was found — set the password in PocketBase Mail if auth is required.',
			pocketbase: summarizeSettings(updated),
		};
	} catch (error) {
		const detail = {
			at: new Date().toISOString(),
			source: 'smtp_sync',
			message: error?.response?.message || error?.message || 'SMTP sync failed',
		};
		lastApiMailError = detail;
		logger.error('pocketbase-mail: SMTP sync failed', detail);
		throw httpError(error?.status || 500, detail.message, 'SMTP_SYNC_FAILED');
	}
}

/**
 * Update PocketBase Mail / SMTP settings from Admin diagnostics form.
 */
export async function updatePocketBaseMailSettings(body = {}) {
	const current = await pocketbaseClient.settings.getAll();
	const smtp = body.smtp && typeof body.smtp === 'object' ? body.smtp : {};
	const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};

	const next = {
		smtp: {
			...(current.smtp || {}),
			enabled: smtp.enabled != null ? Boolean(smtp.enabled) : Boolean(current.smtp?.enabled),
			host: smtp.host != null ? String(smtp.host).trim() : (current.smtp?.host || ''),
			port: smtp.port != null ? Number(smtp.port) || 587 : (current.smtp?.port ?? 587),
			username: smtp.username != null ? String(smtp.username).trim() : (current.smtp?.username || ''),
			tls: smtp.tls != null ? Boolean(smtp.tls) : Boolean(current.smtp?.tls),
			authMethod: smtp.authMethod != null ? String(smtp.authMethod) : (current.smtp?.authMethod || ''),
		},
		meta: {
			...(current.meta || {}),
			senderName: meta.senderName != null ? String(meta.senderName).trim() : (current.meta?.senderName || ''),
			senderAddress: meta.senderAddress != null ? String(meta.senderAddress).trim() : (current.meta?.senderAddress || ''),
			appURL: meta.appURL != null ? String(meta.appURL).trim() : (current.meta?.appURL || ''),
		},
	};

	if (typeof smtp.password === 'string' && smtp.password.trim() && !smtp.password.includes('•')) {
		next.smtp.password = smtp.password.trim();
	}

	try {
		const updated = await pocketbaseClient.settings.update(next);
		lastApiMailError = null;
		return {
			ok: true,
			message: 'PocketBase Mail settings updated.',
			pocketbase: summarizeSettings(updated),
		};
	} catch (error) {
		const detail = {
			at: new Date().toISOString(),
			source: 'settings_update',
			message: error?.response?.message || error?.message || 'Settings update failed',
		};
		lastApiMailError = detail;
		logger.error('pocketbase-mail: settings update failed', detail);
		throw httpError(error?.status || 500, detail.message, 'MAIL_SETTINGS_UPDATE_FAILED');
	}
}
