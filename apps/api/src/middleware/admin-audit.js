/**
 * Lightweight audit middleware for admin mutating requests.
 * Does not alter auth — only appends redacted audit/api request records.
 */
import { writeApiRequest, writeAuditLog } from '../services/audit/write.js';

export function adminAuditMiddleware(req, res, next) {
	const started = Date.now();
	const method = String(req.method || 'GET').toUpperCase();
	const shouldAudit = !['GET', 'HEAD', 'OPTIONS'].includes(method);

	res.on('finish', () => {
		const durationMs = Date.now() - started;
		const actorUserId = req.adminUser?.id || req.pocketbaseUserId || '';
		const actorLabel = req.adminUser?.name || req.adminUser?.email || 'admin';
		const ip = req.ip || req.headers['x-forwarded-for'] || '';
		const path = req.originalUrl || req.url || '';

		writeApiRequest({
			actorUserId,
			method,
			path,
			status: res.statusCode,
			durationMs,
			ip: String(ip).split(',')[0].trim(),
			userAgent: req.headers['user-agent'] || '',
		}).catch(() => null);

		if (!shouldAudit) return;

		writeAuditLog({
			category: 'admin',
			uiCategory: path.includes('/providers')
				? 'Providers'
				: path.includes('/plans')
					? 'Subscriptions'
					: path.includes('/credits')
						? 'Payments'
						: path.includes('/models')
							? 'Providers'
							: path.includes('/queue')
								? 'Queue Jobs'
								: path.includes('/analytics')
									? 'System'
									: 'Users',
			severity: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'success',
			action: `${method} ${path.split('?')[0]}`,
			message: `Admin ${method} ${path.split('?')[0]}`,
			actorUserId,
			actorLabel,
			ip: String(ip).split(',')[0].trim(),
			userAgent: req.headers['user-agent'] || '',
			result: res.statusCode >= 400 ? 'failure' : 'ok',
			durationMs,
			service: 'Admin Console',
			request: { method, path: path.split('?')[0], params: req.params || {} },
			response: { status: res.statusCode },
			metadata: { query: req.query || {} },
		}).catch(() => null);
	});

	next();
}
