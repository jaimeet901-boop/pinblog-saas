/**
 * Lightweight audit middleware for admin mutating requests.
 * Does not alter auth — only appends redacted audit/api request records.
 */
import { writeApiRequest, writeAuditLog } from '../services/audit/write.js';

function resolveAdminAuditMeta(path) {
	const normalized = String(path || '');

	// Billing Control Plane mutations are audited by writeControlPlaneAudit
	// (service=billing-control-plane, ui_category=Billing Admin). Skip the
	// generic admin row to avoid duplicate/inconsistent Billing Logs entries.
	if (normalized.includes('/billing/control-plane')) {
		return { skipDomainAudit: true };
	}

	if (normalized.includes('/billing')) {
		return {
			category: 'billing',
			uiCategory: 'Subscriptions',
			service: 'Admin Console',
		};
	}
	if (normalized.includes('/providers') || normalized.includes('/models')) {
		return { category: 'admin', uiCategory: 'Providers', service: 'Admin Console' };
	}
	if (normalized.includes('/plans')) {
		return { category: 'billing', uiCategory: 'Subscriptions', service: 'Admin Console' };
	}
	if (normalized.includes('/credits')) {
		return { category: 'billing', uiCategory: 'Payments', service: 'Admin Console' };
	}
	if (normalized.includes('/queue')) {
		return { category: 'queue', uiCategory: 'Queue Jobs', service: 'Admin Console' };
	}
	if (normalized.includes('/analytics')) {
		return { category: 'admin', uiCategory: 'System', service: 'Admin Console' };
	}
	return { category: 'admin', uiCategory: 'Users', service: 'Admin Console' };
}

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

		const meta = resolveAdminAuditMeta(path);
		if (meta.skipDomainAudit) return;

		writeAuditLog({
			category: meta.category,
			uiCategory: meta.uiCategory,
			severity: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'success',
			action: `${method} ${path.split('?')[0]}`,
			message: `Admin ${method} ${path.split('?')[0]}`,
			actorUserId,
			actorLabel,
			ip: String(ip).split(',')[0].trim(),
			userAgent: req.headers['user-agent'] || '',
			result: res.statusCode >= 400 ? 'failure' : 'ok',
			durationMs,
			service: meta.service,
			request: { method, path: path.split('?')[0], params: req.params || {} },
			response: { status: res.statusCode },
			metadata: { query: req.query || {} },
		}).catch(() => null);
	});

	next();
}
