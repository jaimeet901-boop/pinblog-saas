import logger from '../utils/logger.js';
import { getPlatformSettings } from './platform-settings.js';

/**
 * Best-effort workspace invitation email.
 * Uses platform SMTP when configured; otherwise logs the invite link for ops.
 */
export async function sendWorkspaceInviteEmail({
	to,
	workspaceName = 'Chef IA workspace',
	role = 'viewer',
	token = '',
	inviterName = '',
} = {}) {
	if (!to) return { sent: false, reason: 'missing_to' };

	const appUrl = String(process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || 'https://tbuy.store').replace(/\/$/, '');
	const signupUrl = `${appUrl}/signup?invite=${encodeURIComponent(token || '')}&email=${encodeURIComponent(to)}`;
	const subject = `You're invited to ${workspaceName} on Chef IA`;
	const body = [
		`${inviterName || 'A teammate'} invited you to join "${workspaceName}" as ${role}.`,
		'',
		'Create your account (or sign in) to join automatically:',
		signupUrl,
		'',
		'This invitation expires in 7 days.',
	].join('\n');

	try {
		const settings = await getPlatformSettings().catch(() => null);
		const email = settings?.email || settings?.payload?.email || {};
		if (!email?.smtpHost || !email?.senderEmail) {
			logger.info('Workspace invite email queued locally (SMTP not configured)', { to, workspaceName, signupUrl });
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
