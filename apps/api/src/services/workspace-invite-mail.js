import logger from '../utils/logger.js';
import { getPlatformSettings } from './platform-settings.js';

const FALLBACK_APP_URL = 'https://tbuy.store';
const FALLBACK_PLATFORM_NAME = 'Chef IA';
const FALLBACK_SUPPORT_EMAIL = 'support@tbuy.store';

function firstNonEmpty(...values) {
	for (const value of values) {
		const trimmed = String(value || '').trim();
		if (trimmed) return trimmed;
	}
	return '';
}

function resolveInviteBranding(settings = {}) {
	const general = settings.general || {};
	const domains = settings.domains || {};
	const platformName = firstNonEmpty(general.platformName, FALLBACK_PLATFORM_NAME);
	const supportEmail = firstNonEmpty(general.supportEmail, FALLBACK_SUPPORT_EMAIL);
	const appUrl = firstNonEmpty(
		process.env.APP_PUBLIC_URL,
		process.env.PUBLIC_APP_URL,
		process.env.WEB_APP_URL,
		process.env.APP_WEB_URL,
		domains.appUrl,
		FALLBACK_APP_URL,
	).replace(/\/$/, '');

	return { platformName, supportEmail, appUrl };
}

/**
 * Best-effort workspace invitation email.
 * Uses platform SMTP when configured; otherwise logs the invite link for ops.
 * Branding values come from Platform Identity (with env/appUrl fallbacks).
 */
export async function sendWorkspaceInviteEmail({
	to,
	workspaceName = '',
	role = 'viewer',
	token = '',
	inviterName = '',
} = {}) {
	if (!to) return { sent: false, reason: 'missing_to' };

	const payload = await getPlatformSettings().catch(() => null);
	const settings = payload?.settings || {};
	const { platformName, supportEmail, appUrl } = resolveInviteBranding(settings);
	const workspaceLabel = firstNonEmpty(workspaceName, `${platformName} workspace`);

	const signupUrl = `${appUrl}/signup?invite=${encodeURIComponent(token || '')}&email=${encodeURIComponent(to)}`;
	const subject = `You're invited to ${workspaceLabel} on ${platformName}`;
	const body = [
		`${inviterName || 'A teammate'} invited you to join "${workspaceLabel}" as ${role}.`,
		'',
		'Create your account (or sign in) to join automatically:',
		signupUrl,
		'',
		'This invitation expires in 7 days.',
		'',
		`Need help? Contact ${supportEmail}`,
	].join('\n');

	try {
		const email = settings.email || {};
		if (!email?.smtpHost || !email?.senderEmail) {
			logger.info('Workspace invite email queued locally (SMTP not configured)', {
				to,
				workspaceName: workspaceLabel,
				signupUrl,
				platformName,
			});
			return { sent: false, reason: 'smtp_not_configured', signupUrl, subject, body };
		}

		// Nodemailer is optional — dynamic import keeps API boot soft if package missing.
		const nodemailer = await import('nodemailer').catch(() => null);
		if (!nodemailer?.createTransport) {
			logger.info('Workspace invite email deferred (nodemailer unavailable)', { to, signupUrl });
			return { sent: false, reason: 'mailer_unavailable', signupUrl, subject, body };
		}

		const transporter = nodemailer.createTransport({
			host: email.smtpHost,
			port: Number(email.smtpPort) || 587,
			secure: Number(email.smtpPort) === 465,
			auth: email.smtpUsername
				? { user: email.smtpUsername, pass: email.smtpPassword || email.smtpPasswordCipher || '' }
				: undefined,
		});

		await transporter.sendMail({
			from: email.senderEmail,
			to,
			subject,
			text: body,
		});
		return { sent: true, signupUrl };
	} catch (error) {
		logger.warn('Workspace invite email failed', { to, message: error?.message });
		return { sent: false, reason: error?.message || 'send_failed', signupUrl };
	}
}
