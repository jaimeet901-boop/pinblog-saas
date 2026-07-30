import { Router } from 'express';
import {
	listBillingProviders,
	resolveBillingConfig,
	runBillingAutomationTick,
	runMonthlyCreditResetJob,
	listCreditPacks,
	purchaseCreditPack,
} from '../../services/billing/index.js';
import {
	activateControlPlaneProvider,
	getControlPlaneProvider,
	listControlPlaneHealth,
	listControlPlaneLogs,
	listControlPlaneProviders,
	runControlPlaneHealthCheck,
	runControlPlaneHealthCheckAll,
	setControlPlaneProviderEnabled,
	toPublicBillingConfig,
	updateControlPlaneCheckoutSettings,
	updateControlPlaneProvider,
	validateControlPlaneProvider,
} from '../../services/billing/control-plane.js';
import { middlewareBillingRequestCache } from '../../services/billing/request-cache.js';
import {
	getPriceMappingGaps,
	getPriceMappingMatrix,
	syncPriceMappingsToProviders,
	updatePriceMappings,
	validatePriceMappingsEndpoint,
} from '../../services/billing/price-mapping.js';
import {
	getRevenueByPeriod,
	getRevenueByPlan,
	getRevenueByProvider,
	getRevenueConversions,
	getRevenueSummary,
	getRevenueTrends,
} from '../../services/billing/revenue-aggregation.js';
import {
	evaluateFailover,
	executeFailover,
	getFailoverPolicy,
	getFailoverStatus,
	listFailoverEvents,
	maybeAutoEvaluateAfterHealthCheck,
	overrideFailover,
	recoverFailover,
	simulateFailover,
	updateFailoverPolicy,
} from '../../services/billing/failover.js';
import {
	acknowledgeMonitoringAlert,
	getFailoverTimeline,
	getMonitoringAlerts,
	getMonitoringAudit,
	getMonitoringDiagnostics,
	getMonitoringEvents,
	getMonitoringHealth,
	getMonitoringMetrics,
	getMonitoringPolicy,
	getMonitoringStatus,
	getMonitoringTrends,
	getRecoveryTimeline,
	muteMonitoringAlert,
	updateMonitoringPolicy,
} from '../../services/billing/monitoring.js';
import {
	BILLING_PERMISSIONS,
	assertBillingPermission,
	getBillingPermissions,
	requireBillingPermission,
} from '../../middleware/billing-permissions.js';

const router = Router();

function asyncHandler(fn) {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
}

function actorFromReq(req) {
	return {
		id: req.adminUser?.id || req.pocketbaseUserId,
		email: req.adminUser?.email,
		name: req.adminUser?.name,
	};
}

function requestMeta(req) {
	return {
		ip: String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
		userAgent: String(req.headers['user-agent'] || ''),
		expectedUpdatedAt: req.body?.expectedUpdatedAt || req.query?.expectedUpdatedAt || null,
	};
}

// Per-request billing config cache (no global cache).
router.use(middlewareBillingRequestCache);

/* ── Existing billing admin endpoints ─────────────────────────── */

router.get('/providers', asyncHandler(async (req, res) => {
	const config = await resolveBillingConfig();
	const providers = await listBillingProviders({ config });
	res.json({ items: providers, config: toPublicBillingConfig(config) });
}));

router.get('/packs', asyncHandler(async (req, res) => {
	res.json(await listCreditPacks({
		planId: req.query.planId || '',
		planSlug: req.query.planSlug || '',
	}));
}));

router.post('/packs/fulfill-local', asyncHandler(async (req, res) => {
	const actor = req.adminUser?.email || req.adminUser?.id || 'admin';
	res.status(201).json(await purchaseCreditPack({
		...(req.body || {}),
		actor,
		actorUserId: req.adminUser?.id || '',
		allowLocalFulfillment: true,
	}));
}));

router.post('/automation/run', asyncHandler(async (req, res) => {
	res.json(await runBillingAutomationTick());
}));

router.post('/automation/reset-credits', asyncHandler(async (req, res) => {
	res.json(await runMonthlyCreditResetJob({ force: Boolean(req.body?.force) }));
}));

/* ── BP-1 Control Plane ───────────────────────────────────────── */

router.get(
	'/control-plane/providers',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		const payload = await listControlPlaneProviders();
		payload.permissions = getBillingPermissions(req.adminUser);
		res.json(payload);
	}),
);

router.get(
	'/control-plane/providers/:code',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getControlPlaneProvider(req.params.code));
	}),
);

router.put(
	'/control-plane/providers/:code',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		const body = req.body || {};
		const secretKeys = ['secretKey', 'apiKey', 'webhookSecret'];
		const writesSecret = secretKeys.some((key) => {
			const value = String(body[key] || '').trim();
			return value && !value.includes('•');
		});
		if (writesSecret) {
			assertBillingPermission(req.adminUser, BILLING_PERMISSIONS.SECRETS_WRITE);
		}
		res.json(await updateControlPlaneProvider(req.params.code, body, actorFromReq(req), requestMeta(req)));
	}),
);

router.post(
	'/control-plane/providers/:code/activate',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await activateControlPlaneProvider(req.params.code, actorFromReq(req), {
			...requestMeta(req),
			expectedUpdatedAt: req.body?.expectedUpdatedAt || null,
		}));
	}),
);

router.post(
	'/control-plane/providers/:code/enable',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await setControlPlaneProviderEnabled(req.params.code, true, actorFromReq(req), {
			...requestMeta(req),
			expectedUpdatedAt: req.body?.expectedUpdatedAt || null,
		}));
	}),
);

router.post(
	'/control-plane/providers/:code/disable',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await setControlPlaneProviderEnabled(req.params.code, false, actorFromReq(req), {
			...requestMeta(req),
			expectedUpdatedAt: req.body?.expectedUpdatedAt || null,
		}));
	}),
);

router.patch(
	'/control-plane/settings',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await updateControlPlaneCheckoutSettings(req.body || {}, actorFromReq(req), requestMeta(req)));
	}),
);

router.get(
	'/control-plane/logs',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await listControlPlaneLogs(req.query || {}));
	}),
);

/* ── BP-2 Health & Validation ─────────────────────────────────── */

router.get(
	'/control-plane/health',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		const payload = await listControlPlaneHealth();
		payload.permissions = getBillingPermissions(req.adminUser);
		res.json(payload);
	}),
);

router.get(
	'/control-plane/providers/:code/validation',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await validateControlPlaneProvider(req.params.code));
	}),
);

router.post(
	'/control-plane/providers/:code/health-check',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		const provider = await runControlPlaneHealthCheck(req.params.code, actorFromReq(req), {
			...requestMeta(req),
			expectedUpdatedAt: req.body?.expectedUpdatedAt || null,
			probeConnectivity: req.body?.probeConnectivity !== false,
			auto: false,
		});
		const failover = await maybeAutoEvaluateAfterHealthCheck(actorFromReq(req), {
			...requestMeta(req),
			expectedUpdatedAt: null,
		}).catch(() => null);
		res.json(failover ? { ...provider, failover } : provider);
	}),
);

router.post(
	'/control-plane/health-check',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		const result = await runControlPlaneHealthCheckAll(actorFromReq(req), {
			...requestMeta(req),
			probeConnectivity: req.body?.probeConnectivity !== false,
			auto: false,
		});
		const failover = await maybeAutoEvaluateAfterHealthCheck(actorFromReq(req), {
			...requestMeta(req),
			expectedUpdatedAt: null,
		}).catch(() => null);
		res.json(failover ? { ...result, failover } : result);
	}),
);

/* ── BP-3 Price Mapping ───────────────────────────────────────── */

router.get(
	'/control-plane/price-mapping',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		const payload = await getPriceMappingMatrix();
		payload.permissions = getBillingPermissions(req.adminUser);
		res.json(payload);
	}),
);

router.put(
	'/control-plane/price-mapping',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await updatePriceMappings(req.body || {}, actorFromReq(req), requestMeta(req)));
	}),
);

router.post(
	'/control-plane/price-mapping/validate',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await validatePriceMappingsEndpoint(req.body || {}));
	}),
);

router.post(
	'/control-plane/price-mapping/sync',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await syncPriceMappingsToProviders(actorFromReq(req), {
			...requestMeta(req),
			expectedUpdatedAt: req.body?.expectedUpdatedAt || null,
		}));
	}),
);

router.get(
	'/control-plane/price-mapping/gaps',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (_req, res) => {
		res.json(await getPriceMappingGaps());
	}),
);

/* ── BP-3 Revenue ─────────────────────────────────────────────── */

router.get(
	'/control-plane/revenue/summary',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getRevenueSummary(req.query || {}));
	}),
);

router.get(
	'/control-plane/revenue/by-provider',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getRevenueByProvider(req.query || {}));
	}),
);

router.get(
	'/control-plane/revenue/by-plan',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getRevenueByPlan(req.query || {}));
	}),
);

router.get(
	'/control-plane/revenue/by-period',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getRevenueByPeriod(req.query || {}));
	}),
);

router.get(
	'/control-plane/revenue/trends',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getRevenueTrends(req.query || {}));
	}),
);

router.get(
	'/control-plane/revenue/conversions',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getRevenueConversions(req.query || {}));
	}),
);

/* ── BP-4 Failover & Recovery ─────────────────────────────────── */

router.get(
	'/control-plane/failover/policy',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getFailoverPolicy(req.adminUser));
	}),
);

router.put(
	'/control-plane/failover/policy',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await updateFailoverPolicy(req.body || {}, actorFromReq(req), requestMeta(req)));
	}),
);

router.get(
	'/control-plane/failover/status',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getFailoverStatus(req.adminUser));
	}),
);

router.post(
	'/control-plane/failover/evaluate',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await evaluateFailover(req.body || {}, actorFromReq(req), requestMeta(req)));
	}),
);

router.post(
	'/control-plane/failover/simulate',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await simulateFailover(req.body || {}));
	}),
);

router.post(
	'/control-plane/failover/execute',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await executeFailover(req.body || {}, actorFromReq(req), requestMeta(req)));
	}),
);

router.post(
	'/control-plane/failover/recover',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await recoverFailover(req.body || {}, actorFromReq(req), requestMeta(req)));
	}),
);

router.post(
	'/control-plane/failover/override',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await overrideFailover(req.body || {}, actorFromReq(req), requestMeta(req)));
	}),
);

router.get(
	'/control-plane/failover/events',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await listFailoverEvents(req.query || {}));
	}),
);

/* ── BP-5 Monitoring & Observability ──────────────────────────── */

router.get(
	'/control-plane/monitoring/status',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getMonitoringStatus(req.adminUser));
	}),
);

router.get(
	'/control-plane/monitoring/health',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getMonitoringHealth(req.adminUser));
	}),
);

router.get(
	'/control-plane/monitoring/timeline/failover',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getFailoverTimeline(req.query || {}));
	}),
);

router.get(
	'/control-plane/monitoring/timeline/recovery',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getRecoveryTimeline(req.query || {}));
	}),
);

router.get(
	'/control-plane/monitoring/events',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getMonitoringEvents(req.query || {}));
	}),
);

router.get(
	'/control-plane/monitoring/audit',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getMonitoringAudit(req.query || {}));
	}),
);

router.get(
	'/control-plane/monitoring/metrics',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (_req, res) => {
		res.json(await getMonitoringMetrics());
	}),
);

router.get(
	'/control-plane/monitoring/trends',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getMonitoringTrends(req.query || {}));
	}),
);

router.get(
	'/control-plane/monitoring/alerts',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getMonitoringAlerts(req.adminUser));
	}),
);

router.post(
	'/control-plane/monitoring/alerts/:id/ack',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await acknowledgeMonitoringAlert(req.params.id, actorFromReq(req), requestMeta(req)));
	}),
);

router.post(
	'/control-plane/monitoring/alerts/:id/mute',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await muteMonitoringAlert(req.params.id, req.body || {}, actorFromReq(req), requestMeta(req)));
	}),
);

router.get(
	'/control-plane/monitoring/diagnostics',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (_req, res) => {
		res.json(await getMonitoringDiagnostics());
	}),
);

router.get(
	'/control-plane/monitoring/policy',
	requireBillingPermission(BILLING_PERMISSIONS.READ),
	asyncHandler(async (req, res) => {
		res.json(await getMonitoringPolicy(req.adminUser));
	}),
);

router.put(
	'/control-plane/monitoring/policy',
	requireBillingPermission(BILLING_PERMISSIONS.MANAGE),
	asyncHandler(async (req, res) => {
		res.json(await updateMonitoringPolicy(req.body || {}, actorFromReq(req), requestMeta(req)));
	}),
);

export default router;
