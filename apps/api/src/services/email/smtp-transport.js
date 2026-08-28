/**
 * Server-side SMTP transport for transactional mail (API only).
 * Credentials come from environment variables — never log SMTP_PASS.
 */

/**
 * @returns {{
 *   configured: boolean,
 *   host: string,
 *   port: number,
 *   secure: boolean,
 *   user: string,
 *   from: string,
 *   hasPass: boolean,
 * }}
 */
export function readSmtpEnvConfig(env = process.env) {
	const host = String(env.SMTP_HOST || '').trim();
	const port = Number.parseInt(String(env.SMTP_PORT || '465'), 10);
	const secureRaw = String(env.SMTP_SECURE ?? 'true').trim().toLowerCase();
	const secure = secureRaw === '' || secureRaw === '1' || secureRaw === 'true' || secureRaw === 'yes';
	const user = String(env.SMTP_USER || '').trim();
	const pass = String(env.SMTP_PASS || '').trim();
	const from = String(env.SMTP_FROM || env.SMTP_USER || '').trim();

	return {
		configured: Boolean(host && from && (user ? pass : true)),
		host,
		port: Number.isFinite(port) && port > 0 ? port : 465,
		secure,
		user,
		from,
		hasPass: Boolean(pass),
	};
}

/**
 * Build a Nodemailer transport from env. Returns null when not configured or nodemailer missing.
 * @param {{ env?: NodeJS.ProcessEnv, nodemailer?: { createTransport: Function } }} [deps]
 */
export async function createSmtpTransport(deps = {}) {
	const env = deps.env || process.env;
	const config = readSmtpEnvConfig(env);
	if (!config.host || !config.from) {
		return { transport: null, config, reason: 'smtp_not_configured' };
	}
	if (config.user && !config.hasPass) {
		return { transport: null, config, reason: 'smtp_pass_missing' };
	}

	let nodemailer = deps.nodemailer || null;
	if (!nodemailer) {
		nodemailer = await import('nodemailer').catch(() => null);
	}
	if (!nodemailer?.createTransport && !nodemailer?.default?.createTransport) {
		return { transport: null, config, reason: 'mailer_unavailable' };
	}

	const createTransport = nodemailer.createTransport || nodemailer.default.createTransport;
	const transport = createTransport({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: config.user
			? { user: config.user, pass: String(env.SMTP_PASS || '').trim() }
			: undefined,
	});

	return { transport, config, reason: null };
}

/**
 * Safe operational log helper — never accepts password fields.
 * Uses console only (avoids shared logger → PocketBase side effects during unit tests).
 */
export function logSmtpOperational(message, meta = {}) {
	const safe = { ...meta };
	for (const key of Object.keys(safe)) {
		const lower = key.toLowerCase();
		if (
			lower.includes('pass')
			|| lower.includes('password')
			|| lower.includes('secret')
			|| lower.includes('authorization')
			|| lower.includes('smtp_pass')
		) {
			delete safe[key];
		}
	}
	console.log(`[INFO] ${message}`, safe);
}
