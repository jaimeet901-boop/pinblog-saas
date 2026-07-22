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
import { startQueueEngine, stopQueueEngine } from './services/queue/engine.js';

const app = express();

function sanitizeValue(value) {
	if (typeof value === 'string') {
		return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
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
	stopQueueEngine();
	process.exit(0);
});

process.on('SIGTERM', async () => {
	logger.info('SIGTERM signal received');
	stopPinterestPublishQueue();
	stopPinterestAnalyticsSync();
	stopAIPinImageQueue();
	stopWordpressPublishQueue();
	stopQueueEngine();

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
	startPinterestPublishQueue();
	startPinterestAnalyticsSync();
	startAIPinImageQueue();
	startWordpressPublishQueue();
	startQueueEngine();
});

export default app;
