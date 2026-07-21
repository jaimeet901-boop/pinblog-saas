import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

function clientKey(req) {
	const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
	if (authHeader) {
		const digest = crypto.createHash('sha256').update(authHeader).digest('hex').slice(0, 32);
		return `user:${digest}`;
	}

	const forwarded = typeof req.headers['x-forwarded-for'] === 'string'
		? req.headers['x-forwarded-for'].split(',')[0].trim()
		: '';

	return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

export const globalRateLimit = rateLimit({
	windowMs: 5 * 60 * 1000,
	// App usage (scans, dashboards, metadata) easily exceeds the old 100/5min
	// ceiling — especially when many clients share one reverse-proxy IP.
	max: 2000,
	standardHeaders: true,
	legacyHeaders: false,
	message: { message: 'Too many requests, please try again later', error: 'Too many requests, please try again later' },
	keyGenerator: clientKey,
	skip: (req) => {
		const path = req.path || '';
		return path === '/health'
			|| path === '/api/health'
			|| path.endsWith('/health');
	},
	validate: {
		trustProxy: false,
		keyGeneratorIpFallback: false,
	},
});
