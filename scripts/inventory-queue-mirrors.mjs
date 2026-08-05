/**
 * READ-ONLY Phase 9d inventory: queue_jobs mirrors vs channel job collections.
 *
 * Always prints a static mirror architecture snapshot.
 * When PocketBase credentials are present, also prints live row counts and orphan samples.
 *
 * NEVER run automatically — invoke manually only:
 *   node --env-file=apps/api/.env scripts/inventory-queue-mirrors.mjs
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CHANNEL_MIRROR_MAP = [
	{
		channel: 'pinterest',
		sourceCollection: 'pinterest_publish_jobs',
		queueType: 'pinterest_publishing',
		mirrorFn: 'mirrorPinterestJob',
		callSites: [
			'apps/api/src/routes/pinterest.js',
			'apps/api/src/services/publish-pipeline.js',
			'apps/api/src/services/pinterest-publish-queue.js',
		],
	},
	{
		channel: 'wordpress',
		sourceCollection: 'publish_jobs',
		queueType: 'wordpress_publishing',
		mirrorFn: 'mirrorWordpressJob',
		callSites: [
			'apps/api/src/services/wordpress-publish.js',
			'apps/api/src/services/wordpress-publish-queue.js',
		],
	},
	{
		channel: 'ai-image',
		sourceCollection: 'ai_pin_image_jobs',
		queueType: 'image_generation',
		mirrorFn: 'mirrorImageJob',
		callSites: [
			'apps/api/src/routes/ai-pin-images.js',
			'apps/api/src/services/ai-pin-image-queue.js',
		],
	},
];

const CRITICAL_CONSUMERS = [
	{ id: 'admin-queue', module: 'apps/api/src/routes/admin/queue.js', dependency: 'critical' },
	{ id: 'admin-controls', module: 'apps/api/src/services/queue/controls.js', dependency: 'critical' },
	{ id: 'health-metrics', module: 'apps/api/src/services/queue/metrics.js', dependency: 'partial' },
	{ id: 'calendar-enrichment', module: 'apps/api/src/services/calendar/projections/queue-mirror-source.js', dependency: 'optional' },
];

function printSection(title) {
	console.log(`\n=== ${title} ===`);
}

function summarizeBy(rows, keyFn) {
	const counts = {};
	for (const row of rows) {
		const key = keyFn(row) || '(empty)';
		counts[key] = (counts[key] || 0) + 1;
	}
	return counts;
}

function loadPocketBase() {
	const candidates = [
		path.join(ROOT, 'apps/api/package.json'),
		path.join(ROOT, 'package.json'),
	];

	const errors = [];
	for (const packageJsonPath of candidates) {
		if (!existsSync(packageJsonPath)) continue;
		try {
			const require = createRequire(packageJsonPath);
			const mod = require('pocketbase');
			return mod?.default || mod;
		} catch (error) {
			errors.push(`${packageJsonPath}: ${error?.message || error}`);
		}
	}

	throw new Error(`Cannot resolve package "pocketbase". Tried:\n${errors.join('\n')}`);
}

async function fetchAll(pb, collection, options = {}) {
	const items = [];
	let page = 1;
	const perPage = 200;
	for (;;) {
		const result = await pb.collection(collection).getList(page, perPage, {
			...options,
			requestKey: null,
		});
		items.push(...(result.items || []));
		if (page >= (result.totalPages || 1)) break;
		page += 1;
	}
	return items;
}

printSection('Static mirror inventory (Phase 9d-0)');
console.log(JSON.stringify({
	phase: '9d-0',
	runtimeChanged: false,
	coreModule: 'apps/api/src/services/queue/mirrors.js',
	upsertHelper: 'apps/api/src/services/queue/jobs.js#upsertMirroredJob',
	channels: CHANNEL_MIRROR_MAP,
	criticalConsumers: CRITICAL_CONSUMERS,
	retirementDoc: 'docs/queue-mirror-retirement.md',
	validationVerdict: 'NOT READY — admin depends on mirrors; dual-read required first',
}, null, 2));

const PB_BASE_URL = String(process.env.PB_BASE_URL || '').trim();
const PB_SUPERUSER_EMAIL = String(process.env.PB_SUPERUSER_EMAIL || '').trim();
const PB_SUPERUSER_PASSWORD = String(process.env.PB_SUPERUSER_PASSWORD || '').trim();

if (!PB_BASE_URL || !PB_SUPERUSER_EMAIL || !PB_SUPERUSER_PASSWORD) {
	printSection('Live inventory');
	console.log('Skipped: set PB_BASE_URL / PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD to count live rows.');
	console.log('\nPhase 9d-0 static inventory complete.');
	process.exit(0);
}

const PocketBase = loadPocketBase();
const pb = new PocketBase(PB_BASE_URL);
pb.autoCancellation(false);

try {
	await pb.collection('_superusers').authWithPassword(PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD);
} catch (error) {
	printSection('Live inventory');
	console.error('PocketBase auth failed:', error?.message || error);
	console.log('Static inventory above remains valid.');
	process.exit(0);
}

printSection('Live queue_jobs (mirrored vs native)');
const queueJobs = await fetchAll(pb, 'queue_jobs', { sort: '-updated' }).catch((error) => {
	console.error('Failed to list queue_jobs:', error?.message || error);
	return null;
});

if (queueJobs) {
	const mirrored = queueJobs.filter((row) => String(row.source_collection || '').trim());
	const native = queueJobs.filter((row) => !String(row.source_collection || '').trim());
	const byMirrorCollection = summarizeBy(mirrored, (row) => row.source_collection);
	const byMirrorStatus = summarizeBy(mirrored, (row) => row.status);
	const byNativeStatus = summarizeBy(native, (row) => row.status);
	const byType = summarizeBy(queueJobs, (row) => row.type);

	console.log(JSON.stringify({
		total: queueJobs.length,
		mirroredChannel: mirrored.length,
		native: native.length,
		byMirrorCollection,
		byMirrorStatus,
		byNativeStatus,
		byType,
		sampleMirrored: mirrored.slice(0, 5).map((row) => ({
			id: row.id,
			type: row.type,
			status: row.status,
			source_collection: row.source_collection,
			source_id: row.source_id,
			updated: row.updated,
		})),
	}, null, 2));
}

printSection('Channel collection counts');
for (const channel of CHANNEL_MIRROR_MAP) {
	const rows = await fetchAll(pb, channel.sourceCollection, { sort: '-updated' }).catch(() => null);
	if (!rows) {
		console.log(`${channel.sourceCollection}: (list failed)`);
		continue;
	}
	console.log(JSON.stringify({
		collection: channel.sourceCollection,
		total: rows.length,
		byStatus: summarizeBy(rows, (row) => row.status),
	}, null, 2));
}

printSection('Orphan mirror sample (mirror without channel row)');
if (queueJobs) {
	const mirrored = queueJobs.filter((row) => String(row.source_collection || '').trim());
	const orphans = [];
	for (const row of mirrored.slice(0, 200)) {
		const collection = row.source_collection;
		const sourceId = row.source_id;
		if (!collection || !sourceId) continue;
		const exists = await pb.collection(collection).getOne(sourceId).catch(() => null);
		if (!exists) {
			orphans.push({
				queueJobId: row.id,
				source_collection: collection,
				source_id: sourceId,
				status: row.status,
				type: row.type,
			});
		}
		if (orphans.length >= 10) break;
	}
	console.log(JSON.stringify({
		checked: Math.min(mirrored.length, 200),
		orphanSampleCount: orphans.length,
		orphans,
		note: 'Full orphan scan not performed — sample only',
	}, null, 2));
}

console.log('\nPhase 9d-0 live inventory complete.');
