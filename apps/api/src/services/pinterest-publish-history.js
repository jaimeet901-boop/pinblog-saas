import pocketbaseClient from '../utils/pocketbaseClient.js';
import { buildPinterestHistoryCreatePayload } from './pinterest-workspace-isolation.js';

export async function writePinterestPublishHistory({
	owner,
	accountId,
	jobId,
	workspaceId,
	workspaceKey,
	title,
	boardId,
	boardName,
	result,
	pinterestPinId,
	pinterestPinUrl,
	publishedAt,
	durationMs,
	attemptCount,
	error,
	meta = {},
}, deps = {}) {
	const client = deps.pocketbaseClient || pocketbaseClient;
	const payload = buildPinterestHistoryCreatePayload({
		owner,
		accountId,
		jobId,
		workspaceId,
		workspaceKey,
		title,
		boardId,
		boardName,
		result,
		pinterestPinId,
		pinterestPinUrl,
		publishedAt,
		durationMs,
		attemptCount,
		error,
		meta,
	});
	return client.collection('pinterest_publish_history').create(payload).catch(() => null);
}

export function mapPinterestHistory(row) {
	return {
		id: row.id,
		jobId: row.job || null,
		accountId: row.account || null,
		title: row.title || '',
		boardId: row.board_id || '',
		boardName: row.board_name || '',
		result: row.result || '',
		pinterestPinId: row.pinterest_pin_id || '',
		pinterestPinUrl: row.pinterest_pin_url || '',
		publishedAt: row.published_at || null,
		durationMs: Number(row.duration_ms) || 0,
		attemptCount: Number(row.attempt_count) || 0,
		error: row.error || '',
		meta: row.meta || {},
		created: row.created,
	};
}
