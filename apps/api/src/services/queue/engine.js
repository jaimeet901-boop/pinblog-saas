import logger from '../../utils/logger.js';
import { claimNativeJob, loadClaimableNativeJobs, processNativeJob, failNativeJob, recoverStuckRunningJobs } from './controls.js';
import { cleanupOldJobs, computeQueueSummary, isQueuePaused } from './metrics.js';
import { heartbeatWorker, markWorkerJobComplete, recoverStaleWorkers, upsertWorker } from './workers.js';

const POLL_MS = Number.parseInt(process.env.QUEUE_ENGINE_POLL_MS || '8000', 10);
const BATCH = Number.parseInt(process.env.QUEUE_ENGINE_BATCH || '8', 10);
const WORKER_ID = process.env.QUEUE_WORKER_ID || `worker-queue-${process.pid}`;

const SPECIALIZED_WORKERS = [
	{ workerId: 'worker-pinterest-publish', jobTypes: ['pinterest_publishing'], concurrency: 10 },
	{ workerId: 'worker-wordpress-publish', jobTypes: ['wordpress_publishing'], concurrency: 5 },
	{ workerId: 'worker-image-gen', jobTypes: ['image_generation'], concurrency: 4 },
	{ workerId: 'worker-analytics', jobTypes: ['analytics_refresh'], concurrency: 2 },
];

let timer = null;
let running = false;
let lastTickAt = '';
let lastError = '';
let processedTotal = 0;
let failedTotal = 0;

async function registerFleet() {
	await upsertWorker({
		workerId: WORKER_ID,
		status: 'online',
		jobTypes: [
			'webhook_delivery',
			'email_notification',
			'notification',
			'media_upload',
			'analytics_refresh',
			'health_check',
		],
		concurrency: BATCH,
		timeoutMs: 10 * 60 * 1000,
		meta: { role: 'native-orchestrator' },
	});

	for (const worker of SPECIALIZED_WORKERS) {
		await upsertWorker({
			...worker,
			status: 'online',
			timeoutMs: 15 * 60 * 1000,
			meta: { role: 'specialized-mirror' },
		});
	}
}

async function tick() {
	if (running) return;
	running = true;
	lastTickAt = new Date().toISOString();

	try {
		await registerFleet();
		await recoverStaleWorkers();
		await recoverStuckRunningJobs();

		const paused = await isQueuePaused();
		await heartbeatWorker(WORKER_ID, {
			status: paused ? 'draining' : 'online',
			currentJob: '',
			jobTypes: [
				'webhook_delivery',
				'email_notification',
				'notification',
				'media_upload',
				'analytics_refresh',
				'health_check',
			],
			concurrency: BATCH,
		});

		if (!paused) {
			const due = await loadClaimableNativeJobs(BATCH);
			for (const candidate of due) {
				const claimed = await claimNativeJob(candidate.id, WORKER_ID);
				if (!claimed) continue;

				await heartbeatWorker(WORKER_ID, { currentJob: claimed.id });
				const started = Date.now();
				try {
					await processNativeJob(claimed);
					processedTotal += 1;
					await markWorkerJobComplete(WORKER_ID, Date.now() - started);
				} catch (error) {
					failedTotal += 1;
					lastError = error.message;
					logger.error(`[queue-engine] job ${claimed.id} failed: ${error.message}`);
					await failNativeJob(claimed, error);
					await markWorkerJobComplete(WORKER_ID, Date.now() - started);
				}
			}
		}

		if (Math.random() < 0.15) {
			await cleanupOldJobs({ retainDays: Number(process.env.QUEUE_RETAIN_DAYS || 30) });
		}
		await computeQueueSummary().catch(() => null);
	} catch (error) {
		lastError = error.message;
		logger.error(`[queue-engine] tick failed: ${error.message}`);
	} finally {
		running = false;
	}
}

export function startQueueEngine() {
	if (timer) return;
	logger.info(`[queue-engine] starting orchestrator ${WORKER_ID}`);
	tick();
	timer = setInterval(tick, POLL_MS);
}

export function stopQueueEngine() {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
}

export function getQueueEngineStatus() {
	return {
		running,
		workerId: WORKER_ID,
		processedTotal,
		failedTotal,
		lastTickAt,
		lastError,
		pollIntervalMs: POLL_MS,
	};
}
