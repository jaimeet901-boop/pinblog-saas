import logger from '../../../utils/logger.js';
import { mapQueueJobDto, mapQueueJobDetail, getQueueJob, findBySource } from '../jobs.js';
import { loadAdminControlTarget } from '../admin-controls/load-target.js';
import { resolveAdminDetailEvents } from '../admin-events/index.js';
import { normalizeJobType } from '../types.js';
import { isAdminQueueDualReadEnabled, getAdminQueueDualReadStatus } from './flag.js';
import { buildNativeQueueFilter, listNativeQueueJobsPaginated, listNativeQueueJobsBatch } from './native-source.js';
import { getChannelJob, listChannelQueueJobsBatch } from './channel-source.js';
import {
	makeSourceKey,
	normalizeChannelJob,
	normalizeNativeJob,
	parseSyntheticId,
} from './normalize.js';
import { mergeAdminQueueRecords, paginateItems } from './merge.js';

let envEnabledLogged = false;

export { isAdminQueueDualReadEnabled, getAdminQueueDualReadStatus } from './flag.js';

function logDualReadEnabledOnce() {
	if (!envEnabledLogged) {
		logger.info('Admin Queue dual-read enabled by ADMIN_QUEUE_DUAL_READ_ENABLED');
		envEnabledLogged = true;
	}
}

function attachReadMeta(dto, record) {
	return {
		...dto,
		readSource: record._readSource || 'native',
		queueJobId: record._queueJobId || null,
	};
}

function computeFetchLimit(page, perPage) {
	return Math.min(500, Math.max(100, page * perPage + perPage));
}

function mapListQuery(query = {}) {
	const page = Number.parseInt(query.page, 10);
	const perPage = Number.parseInt(query.perPage, 10);
	const typeRaw = String(query.type || query.jobType || '').trim();
	return {
		page: Number.isFinite(page) && page >= 1 ? page : 1,
		perPage: Number.isFinite(perPage) && perPage >= 1 ? Math.min(100, perPage) : 20,
		q: String(query.q || query.search || '').trim().toLowerCase(),
		status: String(query.status || '').trim(),
		priority: String(query.priority || '').trim(),
		provider: String(query.provider || '').trim(),
		workspace: String(query.workspace || '').trim(),
		dateRange: String(query.date || query.dateRange || '').trim(),
		typeRaw,
		type: normalizeJobType(typeRaw),
	};
}

async function listAdminQueueJobsLegacy(query) {
	const {
		page, perPage, q, status, priority, provider, workspace, dateRange, typeRaw,
	} = mapListQuery(query);
	const filter = buildNativeQueueFilter({
		status, priority, provider, typeRaw, workspace, dateRange,
	});
	const result = await listNativeQueueJobsPaginated({ page, perPage, filter });

	let items = (result.items || []).map((job) => mapQueueJobDto(job));
	if (q) {
		items = items.filter((job) => {
			const haystack = [job.id, job.type, job.workspace, job.owner, job.provider, job.worker].join(' ').toLowerCase();
			return haystack.includes(q);
		});
	}

	return {
		page: result.page || page,
		perPage: result.perPage || perPage,
		totalItems: q ? items.length : result.totalItems,
		totalPages: q ? Math.max(1, Math.ceil(items.length / perPage)) : result.totalPages,
		items: q ? items.slice(0, perPage) : items,
	};
}

async function listAdminQueueJobsDualRead(query) {
	logDualReadEnabledOnce();
	const {
		page, perPage, q, status, priority, provider, workspace, dateRange, typeRaw, type,
	} = mapListQuery(query);
	const fetchLimit = computeFetchLimit(page, perPage);
	const filter = buildNativeQueueFilter({
		status: '',
		priority: '',
		provider: '',
		typeRaw,
		workspace,
		dateRange,
	});

	const [nativeItems, channelItems] = await Promise.all([
		listNativeQueueJobsBatch({ filter, limit: fetchLimit }),
		listChannelQueueJobsBatch({
			typeRaw,
			workspace,
			dateRange,
			limit: fetchLimit,
		}),
	]);

	const merged = mergeAdminQueueRecords({
		nativeItems,
		channelItems,
		filters: { status, priority, provider, type },
	});

	const paged = paginateItems(merged, { page, perPage, q });
	const items = paged.items.map((record) => attachReadMeta(mapQueueJobDto(record), record));

	return {
		page: paged.page,
		perPage: paged.perPage,
		totalItems: paged.totalItems,
		totalPages: paged.totalPages,
		items,
	};
}

/**
 * Admin Queue job list — dual-read when flag enabled, legacy queue_jobs otherwise.
 */
export async function listAdminQueueJobs(query = {}) {
	if (!isAdminQueueDualReadEnabled()) {
		return listAdminQueueJobsLegacy(query);
	}
	return listAdminQueueJobsDualRead(query);
}

async function resolveDualReadRecord(id) {
	const synthetic = parseSyntheticId(id);
	if (synthetic) {
		const channelJob = await getChannelJob(synthetic.sourceCollection, synthetic.sourceId);
		if (!channelJob) return null;
		const mirror = await getQueueJobBySource(synthetic.sourceCollection, synthetic.sourceId);
		return normalizeChannelJob(synthetic.sourceCollection, channelJob, {
			queueJobId: mirror?.id || null,
			readSource: 'channel',
		});
	}

	const queueJob = await getQueueJob(id);
	if (!queueJob) return null;

	const sourceCollection = String(queueJob.source_collection || '').trim();
	if (sourceCollection && queueJob.source_id) {
		const channelJob = await getChannelJob(sourceCollection, queueJob.source_id);
		if (channelJob) {
			return normalizeChannelJob(sourceCollection, channelJob, {
				queueJobId: queueJob.id,
				readSource: 'channel',
			});
		}
		return null;
	}

	return normalizeNativeJob(queueJob, { readSource: 'native' });
}

async function getQueueJobBySource(sourceCollection, sourceId) {
	return findBySource(sourceCollection, sourceId);
}

/**
 * Resolve an admin queue job record for detail views.
 */
export async function getAdminQueueJobRecord(id) {
	if (!isAdminQueueDualReadEnabled()) {
		return getQueueJob(id);
	}
	return resolveDualReadRecord(id);
}

/**
 * Map admin queue job to detail DTO (includes events when queueJobId exists).
 */
export async function getAdminQueueJobDetail(id) {
	if (!isAdminQueueDualReadEnabled()) {
		const job = await getQueueJob(id);
		if (!job) return null;
		return mapQueueJobDetail(job);
	}

	const record = await resolveDualReadRecord(id);
	if (!record) return null;

	const target = await loadAdminControlTarget(id);
	const events = target ? await resolveAdminDetailEvents(target, 100) : [];
	const dto = mapQueueJobDto(record, { events, includeDetail: true });
	return attachReadMeta(dto, record);
}

export { makeSourceKey, parseSyntheticId };
