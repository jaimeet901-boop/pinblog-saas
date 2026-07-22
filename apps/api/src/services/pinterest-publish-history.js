import pocketbaseClient from '../utils/pocketbaseClient.js';

export async function writePinterestPublishHistory({
	owner,
	accountId,
	jobId,
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
}) {
	return pocketbaseClient.collection('pinterest_publish_history').create({
		owner,
		account: accountId || undefined,
		job: jobId || undefined,
		workspace_key: workspaceKey || String(owner || ''),
		title: title || '',
		board_id: boardId || '',
		board_name: boardName || '',
		result: result || 'published',
		pinterest_pin_id: pinterestPinId || '',
		pinterest_pin_url: pinterestPinUrl || '',
		published_at: publishedAt || new Date().toISOString(),
		duration_ms: Number(durationMs) || 0,
		attempt_count: Number(attemptCount) || 0,
		error: error || '',
		meta,
	}).catch(() => null);
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
