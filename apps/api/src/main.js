import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import routes from './routes/index.js';
import { errorMiddleware } from './middleware/error.js';
import { globalRateLimit } from './middleware/global-rate-limit.js';
import logger from './utils/logger.js';
import { BodyLimit } from './constants/common.js';
import { startPinterestPublishQueue, stopPinterestPublishQueue } from './services/pinterest-publish-queue.js';
import { validateServerEnv } from './utils/env.js';
import { startAIPinImageQueue, stopAIPinImageQueue } from './services/ai-pin-image-queue.js';
import { startPinterestAnalyticsSync, stopPinterestAnalyticsSync } from './services/pinterest-analytics-sync.js';
import { startWordpressPublishQueue, stopWordpressPublishQueue } from './services/wordpress-publish-queue.js';
import { startWordpressSyncScheduler, stopWordpressSyncScheduler } from './services/wordpress-sync-scheduler.js';
import { startQueueEngine, stopQueueEngine } from './services/queue/engine.js';
import { startAnalyticsRefreshWorker, stopAnalyticsRefreshWorker } from './services/analytics/refresh.js';
import { startAuditRetentionWorker, stopAuditRetentionWorker } from './services/audit/retention.js';
import { startHealthMonitorWorker, stopHealthMonitorWorker } from './services/health/worker.js';
import { ensurePinterestAppCredentialsSeeded } from './services/pinterest-app-credentials.js';
import { ensureFacebookAppCredentialsSeeded } from './services/facebook/app-credentials.js';
import { ensurePlatformSettingsSeeded } from './services/platform-settings.js';
import { ensureOfficialPinTemplatesSeeded } from './services/official-pin-templates-seed.js';
import { ensureWordpressIntegrationSchema } from './utils/ensure-wordpress-integration-schema.js';
import { ensureArticleLifecycleSchema } from './utils/ensure-article-lifecycle-schema.js';
import { ensureCreditsEngineSchema } from './utils/ensure-credits-engine-schema.js';
import { ensureBillingAutomationSchema } from './utils/ensure-billing-automation-schema.js';
import { ensureWorkspaceEnterpriseSchema } from './utils/ensure-workspace-enterprise-schema.js';
import { ensureWorkspaceOwnershipSchema } from './utils/ensure-workspace-ownership-schema.js';
import { ensureWebsiteLifecycleSchema } from './utils/ensure-website-lifecycle-schema.js';
import { ensureFacebookOAuthSchema } from './utils/ensure-facebook-oauth-schema.js';
import { startBillingAutomationWorker, stopBillingAutomationWorker } from './services/billing/index.js';
import pocketbaseClient from './utils/pocketbaseClient.js';

const app = express();

function sanitizeValue(value) {
	if (typeof value === 'string') {
		return [...value]
			.filter((ch) => {
				const code = ch.charCodeAt(0);
				return !(code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127);
			})
			.join('')
			.trim();
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeValue(item));
	}
	if (value && typeof value === 'object') {
		const out = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = sanitizeValue(item);
		}
		return out;
	}
	return value;
}

function sanitizeInput(req, res, next) {
	const sanitizedQuery = sanitizeValue(req.query);
	Object.defineProperty(req, 'query', {
		value: sanitizedQuery,
		writable: true,
		configurable: true,
		enumerable: true,
	});
	req.body = sanitizeValue(req.body);
	next();
}

validateServerEnv();

app.set('trust proxy', true);

process.on('uncaughtException', (error) => {
	logger.error('Uncaught exception:', error);
});
  
process.on('unhandledRejection', (reason, promise) => {
	logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});

process.on('SIGINT', async () => {
	logger.info('Interrupted');
	stopPinterestPublishQueue();
	stopPinterestAnalyticsSync();
	stopAIPinImageQueue();
	stopWordpressPublishQueue();
	stopWordpressSyncScheduler();
	stopQueueEngine();
	stopAnalyticsRefreshWorker();
	stopAuditRetentionWorker();
	stopHealthMonitorWorker();
	stopBillingAutomationWorker();
	process.exit(0);
});

process.on('SIGTERM', async () => {
	logger.info('SIGTERM signal received');
	stopPinterestPublishQueue();
	stopPinterestAnalyticsSync();
	stopAIPinImageQueue();
	stopWordpressPublishQueue();
	stopWordpressSyncScheduler();
	stopQueueEngine();
	stopAnalyticsRefreshWorker();
	stopAuditRetentionWorker();
	stopHealthMonitorWorker();
	stopBillingAutomationWorker();

	await new Promise(resolve => setTimeout(resolve, 3000));

	logger.info('Exiting');
	process.exit();
});

app.use(helmet());
app.use(cors({
	origin: process.env.CORS_ORIGIN || false, // deny cors when unset (on purpose)
	methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'QUERY'],
	allowedHeaders: ['Authorization', 'Content-Type'],
}));
app.use(morgan('combined'));
app.use(globalRateLimit);
app.use(express.json({
	limit: BodyLimit,
}));
app.use(express.urlencoded({ 
	extended: true,
	limit: BodyLimit,
}));
app.use(sanitizeInput);

app.use('/', routes());

app.use(errorMiddleware);

app.use((req, res) => {
	res.status(404).json({
		message: 'The requested endpoint was not found.',
		errorCode: 'NOT_FOUND',
	});
});

const port = process.env.PORT || 3001;

app.listen(port, () => {
	logger.info(`🚀 API Server running on http://localhost:${port}`);
	ensurePinterestAppCredentialsSeeded().catch((error) => {
		logger.warn('Pinterest OAuth credentials seed skipped:', error?.message || error);
	});
	ensureFacebookAppCredentialsSeeded().catch((error) => {
		logger.warn('Facebook OAuth credentials seed skipped:', error?.message || error);
	});
	ensureFacebookOAuthSchema(pocketbaseClient).catch((error) => {
		logger.warn('Facebook Hub/OAuth schema ensure skipped:', error?.message || error);
	});
	ensurePlatformSettingsSeeded().catch((error) => {
		logger.warn('Platform settings seed skipped:', error?.message || error);
	});
	ensureOfficialPinTemplatesSeeded().catch((error) => {
		logger.warn('Official pin templates seed skipped:', error?.message || error);
	});
	ensureWordpressIntegrationSchema(pocketbaseClient).catch((error) => {
		logger.warn('WordPress integration schema ensure skipped:', error?.message || error);
	});
	ensureArticleLifecycleSchema(pocketbaseClient).catch((error) => {
		logger.warn('Article lifecycle schema ensure skipped:', error?.message || error);
	});
	ensureCreditsEngineSchema(pocketbaseClient).catch((error) => {
		logger.warn('Credits engine schema ensure skipped:', error?.message || error);
	});
	ensureBillingAutomationSchema(pocketbaseClient).catch((error) => {
		logger.warn('Billing automation schema ensure skipped:', error?.message || error);
	});
	ensureWorkspaceEnterpriseSchema(pocketbaseClient).catch((error) => {
		logger.warn('Workspace enterprise schema ensure skipped:', error?.message || error);
	});
	ensureWorkspaceOwnershipSchema(pocketbaseClient).catch((error) => {
		logger.warn('Workspace ownership schema ensure skipped:', error?.message || error);
	});
	ensureWebsiteLifecycleSchema(pocketbaseClient).catch((error) => {
		logger.warn('Website lifecycle schema ensure skipped:', error?.message || error);
	});
	startPinterestPublishQueue();
	startPinterestAnalyticsSync();
	startAIPinImageQueue();
	startWordpressPublishQueue();
	startWordpressSyncScheduler();
	startQueueEngine();
	startAnalyticsRefreshWorker();
	startAuditRetentionWorker();
	startHealthMonitorWorker();
	startBillingAutomationWorker();
});

export default app;
