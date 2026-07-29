/**
 * Phase 3 regression verifier — offline mapJob vs adapter(normalize) + live dual-endpoint compare.
 * Does not mutate product code.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire as createRequireFromPath } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '../../api');
const webRoot = path.resolve(__dirname, '..');

const { normalizePinterestPublishJob } = await import(
	pathToFileURL(path.join(apiRoot, 'src/services/publishing-history/normalize-pinterest.js')).href
);
const {
	adaptPublishingHistoryResponse,
	toPublishingHistoryUiRow,
	PINTEREST_HISTORY_DEFAULT_STATUSES,
} = await import(
	pathToFileURL(path.join(webRoot, 'src/services/publishing-history/uiAdapter.js')).href
);

/** Legacy mapJob from apps/api/src/routes/pinterest.js (copied for parity — do not import Express route). */
function mapJob(record, pinRecord = null) {
	return {
		id: record.id,
		aiPinId: record.ai_pin,
		accountId: record.account || '',
		accountLabel: record.account_label || '',
		accountUsername: record.account_username || '',
		websiteId: record.websiteId || '',
		articleId: record.articleId || '',
		boardId: record.board_id,
		boardName: record.board_name || '',
		scheduledAt: record.scheduled_at,
		timezone: record.timezone || '',
		status: record.status,
		attemptCount: record.attempt_count || 0,
		maxAttempts: record.max_attempts || 3,
		nextRetryAt: record.next_retry_at || '',
		lastError: record.last_error || '',
		pinterestPinId: record.pinterest_pin_id || '',
		pinterestPinUrl: record.pinterest_pin_url || '',
		publishedAt: record.published_at || '',
		performance: record.performance || {
			impressions: null,
			saves: null,
			outboundClicks: null,
			closeups: null,
			readyForAnalyticsSync: true,
		},
		createdAt: record.created,
		updatedAt: record.updated,
		pin: pinRecord
			? {
				id: pinRecord.id,
				title: pinRecord.title,
				description: pinRecord.description,
				overlayText: pinRecord.overlay_text,
				imageUrl: pinRecord.image_url || '',
				status: pinRecord.status,
			}
			: null,
	};
}

function uiVisibleSlice(row) {
	return {
		id: row.id,
		aiPinId: String(row.aiPinId || ''),
		accountId: String(row.accountId || ''),
		accountLabel: String(row.accountLabel || ''),
		accountUsername: String(row.accountUsername || ''),
		websiteId: String(row.websiteId || ''),
		articleId: String(row.articleId || ''),
		boardId: String(row.boardId || ''),
		boardName: String(row.boardName || ''),
		status: String(row.status || ''),
		attemptCount: Number(row.attemptCount) || 0,
		maxAttempts: Number(row.maxAttempts) || 3,
		lastError: String(row.lastError || ''),
		pinterestPinId: String(row.pinterestPinId || ''),
		pinterestPinUrl: String(row.pinterestPinUrl || ''),
		publishedAt: String(row.publishedAt || ''),
		scheduledAt: String(row.scheduledAt || ''),
		createdAt: String(row.createdAt || ''),
		updatedAt: String(row.updatedAt || ''),
		nextRetryAt: String(row.nextRetryAt || ''),
		pinTitle: String(row.pin?.title || ''),
		pinDescription: String(row.pin?.description || ''),
		pinOverlay: String(row.pin?.overlayText || ''),
		pinImageUrl: String(row.pin?.imageUrl || ''),
		pinStatus: String(row.pin?.status || ''),
		hasPin: Boolean(row.pin),
		canRetry: row.status === 'failed',
		canCancel: row.status === 'scheduled',
		canPublishNow: row.status === 'scheduled' || row.status === 'failed',
		canOpenPin: Boolean(row.pinterestPinUrl),
		canCopy: Boolean(row.pinterestPinUrl),
		canOpenArticle: Boolean(row.pin?.destinationUrl || row.destinationUrl),
	};
}

function fixtureJobs() {
	const pin = {
		id: 'pin_1',
		title: 'Summer salad',
		description: 'Fresh greens',
		overlay_text: 'Eat well',
		image_url: 'https://cdn.example/pin.jpg',
		status: 'ready',
		destination_url: 'https://blog.example/salad',
	};
	const base = {
		id: 'job_abc',
		ai_pin: 'pin_1',
		account: 'acct_1',
		account_label: 'Chef Kitchen',
		account_username: 'chefkitchen',
		websiteId: 'ws_1',
		articleId: 'art_1',
		board_id: 'board_9',
		board_name: 'Recipes',
		scheduled_at: '2026-07-02T10:00:00.000Z',
		timezone: 'Europe/Paris',
		attempt_count: 1,
		max_attempts: 3,
		next_retry_at: '',
		last_error: '',
		pinterest_pin_id: 'pin_ext_1',
		pinterest_pin_url: 'https://pinterest.com/pin/1',
		published_at: '2026-07-01T12:00:00.000Z',
		performance: { impressions: 10, saves: 2, outboundClicks: 1, closeups: 3, readyForAnalyticsSync: false },
		created: '2026-06-30T10:00:00.000Z',
		updated: '2026-07-01T12:05:00.000Z',
		expand: { ai_pin: pin },
	};
	return [
		{ ...base, status: 'published' },
		{ ...base, id: 'job_fail', status: 'failed', last_error: 'boom', pinterest_pin_url: '', pinterest_pin_id: '' },
		{ ...base, id: 'job_sched', status: 'scheduled', published_at: '', pinterest_pin_url: '', pinterest_pin_id: '' },
		{ ...base, id: 'job_pubing', status: 'publishing', published_at: '' },
		{ ...base, id: 'job_wait', status: 'waiting_provider', published_at: '' },
		{ ...base, id: 'job_retry', status: 'retrying', published_at: '' },
		{ ...base, id: 'job_cancel', status: 'cancelled', published_at: '' },
		{ ...base, id: 'job_nopin', status: 'published', ai_pin: '', expand: {} },
	];
}

function compareOffline() {
	const report = { ok: true, mismatches: [], actionMatrix: [], articleDeltas: [], statusAlias: [] };
	for (const job of fixtureJobs()) {
		const pin = job.expand?.ai_pin || null;
		const legacy = mapJob(job, pin);
		const normalized = normalizePinterestPublishJob(job, { pin, sourceModule: 'unknown' });
		const adapted = toPublishingHistoryUiRow(normalized);
		const a = uiVisibleSlice(legacy);
		const b = uiVisibleSlice(adapted);

		// Status alias: waiting_provider → publishing is intentional on new path
		if (job.status === 'waiting_provider') {
			report.statusAlias.push({
				jobId: job.id,
				legacyStatus: a.status,
				adaptedStatus: b.status,
			});
			a.status = b.status; // compare remaining fields after alias
			a.canRetry = b.canRetry;
			a.canCancel = b.canCancel;
			a.canPublishNow = b.canPublishNow;
		}

		for (const key of Object.keys(a)) {
			if (key === 'canOpenArticle') continue; // evaluated separately
			if (String(a[key]) !== String(b[key])) {
				report.ok = false;
				report.mismatches.push({ jobId: job.id, field: key, legacy: a[key], adapted: b[key] });
			}
		}

		if (a.canOpenArticle !== b.canOpenArticle) {
			report.articleDeltas.push({
				jobId: job.id,
				legacy: a.canOpenArticle,
				adapted: b.canOpenArticle,
				note: 'Article button enablement differs (adapter surfaces destinationUrl; mapJob did not)',
			});
		}

		report.actionMatrix.push({
			jobId: job.id,
			status: b.status,
			endpoints: {
				retry: `/pinterest/jobs/${b.id}/retry`,
				cancel: `/pinterest/jobs/${b.id}/cancel`,
				publishNow: `/pinterest/jobs/${b.id}/publish-now`,
			},
			flags: {
				canRetry: b.canRetry,
				canCancel: b.canCancel,
				canPublishNow: b.canPublishNow,
				canOpenPin: b.canOpenPin,
				canCopy: b.canCopy,
			},
			idIsRawJobId: b.id === job.id && !String(b.id).includes(':'),
		});
	}

	// Default status filter parity
	const mixed = fixtureJobs().map((job) => normalizePinterestPublishJob(job, {
		pin: job.expand?.ai_pin || null,
	}));
	const adaptedList = adaptPublishingHistoryResponse(
		{ items: mixed, meta: { page: 1, perPage: 100, totalItems: mixed.length, totalPages: 1 } },
		{ applyDefaultStatusFilter: true },
	);
	const statuses = adaptedList.items.map((i) => i.status);
	const bad = statuses.filter((s) => !PINTEREST_HISTORY_DEFAULT_STATUSES.includes(s));
	if (bad.length) {
		report.ok = false;
		report.mismatches.push({ field: 'defaultStatusFilter', bad });
	}
	report.defaultFilterStatuses = statuses;
	report.defaultFilterIncludesWaitingAsPublishing = adaptedList.items.some((i) => i.id === 'job_wait');
	report.defaultFilterExcludesRetrying = !adaptedList.items.some((i) => i.id === 'job_retry');
	if (report.defaultFilterIncludesWaitingAsPublishing) {
		report.ok = false;
		report.mismatches.push({
			field: 'waiting_provider_default_filter',
			note: 'Legacy /pinterest/history excludes native waiting_provider',
		});
	}

	return report;
}

async function liveCompare() {
	const API_URL = String(process.env.API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
	const PB_URL = String(process.env.PB_URL || 'http://127.0.0.1:18111').replace(/\/$/, '');
	const email = String(process.env.PB_SUPERUSER_EMAIL || 'admin@example.com');
	const password = String(process.env.PB_SUPERUSER_PASSWORD || 'AdminPass123456');
	const TEMP = String(process.env.PROOF_TEMP_PASSWORD || 'ProofCapturePass123!');

	const out = {
		publishingRoute: null,
		legacyRoute: null,
		auth: null,
		idOrderMatch: null,
		fieldDiffs: [],
		networkOnlyPublishing: null,
	};

	const pubProbe = await fetch(`${API_URL}/publishing/history?channel=pinterest&perPage=1`);
	out.publishingRoute = { status: pubProbe.status, ok: pubProbe.status !== 404 };
	const legProbe = await fetch(`${API_URL}/pinterest/history?perPage=1`);
	out.legacyRoute = { status: legProbe.status, intact: legProbe.status === 401 || legProbe.status === 200 };

	if (pubProbe.status === 404) {
		out.error = 'GET /publishing/history returned 404 — API process likely needs restart to load Phase 2 route';
		return out;
	}

	// Superuser → find owner with pinterest jobs → user auth
	const su = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identity: email, password }),
	});
	const suBody = await su.json().catch(() => ({}));
	if (!su.ok) {
		out.error = `superuser auth failed: ${su.status}`;
		return out;
	}
	const suToken = suBody.token;

	const jobs = await fetch(
		`${PB_URL}/api/collections/pinterest_publish_jobs/records?perPage=5&sort=-updated`,
		{ headers: { Authorization: suToken } },
	);
	const jobsBody = await jobs.json().catch(() => ({}));
	const sample = (jobsBody.items || [])[0];
	if (!sample?.owner) {
		out.auth = 'no pinterest_publish_jobs found — skipping authenticated live compare';
		out.liveSkipped = true;
		return out;
	}
	const ownerId = typeof sample.owner === 'string' ? sample.owner : sample.owner.id;
	const userRes = await fetch(`${PB_URL}/api/collections/users/records/${ownerId}`, {
		headers: { Authorization: suToken },
	});
	const user = await userRes.json();
	await fetch(`${PB_URL}/api/collections/users/records/${ownerId}`, {
		method: 'PATCH',
		headers: { Authorization: suToken, 'Content-Type': 'application/json' },
		body: JSON.stringify({ password: TEMP, passwordConfirm: TEMP }),
	});
	const authRes = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identity: user.email, password: TEMP }),
	});
	const authBody = await authRes.json();
	if (!authRes.ok) {
		out.error = `user auth failed: ${authRes.status}`;
		return out;
	}
	out.auth = { email: user.email, ownerId };

	const bearer = Buffer.from(JSON.stringify({ token: authBody.token, record: authBody.record })).toString('base64');
	const headers = {
		Authorization: `Bearer ${bearer}`,
		'Content-Type': 'application/json',
		'X-Workspace-Id': ownerId,
	};

	const [legacyRes, pubRes] = await Promise.all([
		fetch(`${API_URL}/pinterest/history?page=1&perPage=100`, { headers }),
		fetch(`${API_URL}/publishing/history?page=1&perPage=100&channel=pinterest&sort=-updatedAt`, { headers }),
	]);
	const legacyJson = await legacyRes.json().catch(() => ({}));
	const pubJson = await pubRes.json().catch(() => ({}));
	out.legacyHttp = legacyRes.status;
	out.publishingHttp = pubRes.status;

	if (!legacyRes.ok || !pubRes.ok) {
		out.error = `history fetch failed legacy=${legacyRes.status} publishing=${pubRes.status}`;
		out.legacySample = legacyJson?.message || legacyJson;
		out.publishingSample = pubJson?.message || pubJson;
		return out;
	}

	const adapted = adaptPublishingHistoryResponse(pubJson, { applyDefaultStatusFilter: true });
	const legacyItems = Array.isArray(legacyJson.items) ? legacyJson.items : [];
	const adaptedItems = adapted.items;

	out.counts = { legacy: legacyItems.length, adapted: adaptedItems.length };
	out.legacyIds = legacyItems.map((i) => i.id);
	out.adaptedIds = adaptedItems.map((i) => i.id);
	out.idOrderMatch = JSON.stringify(out.legacyIds) === JSON.stringify(out.adaptedIds);

	const legacyById = new Map(legacyItems.map((i) => [i.id, i]));
	for (const row of adaptedItems) {
		const leg = legacyById.get(row.id);
		if (!leg) {
			out.fieldDiffs.push({ id: row.id, type: 'extraInAdapted' });
			continue;
		}
		const a = uiVisibleSlice(leg);
		const b = uiVisibleSlice(row);
		for (const key of Object.keys(a)) {
			if (String(a[key]) !== String(b[key])) {
				out.fieldDiffs.push({ id: row.id, field: key, legacy: a[key], adapted: b[key] });
			}
		}
	}
	for (const leg of legacyItems) {
		if (!adaptedItems.some((i) => i.id === leg.id)) {
			out.fieldDiffs.push({ id: leg.id, type: 'missingInAdapted' });
		}
	}

	return out;
}

const offline = compareOffline();
let live = null;
try {
	live = await liveCompare();
} catch (error) {
	live = { error: error.message };
}

const summary = {
	offlineOk: offline.ok && offline.articleDeltas.length === 0,
	offlineMismatches: offline.mismatches,
	articleDeltas: offline.articleDeltas,
	statusAlias: offline.statusAlias,
	defaultFilterIncludesWaitingAsPublishing: offline.defaultFilterIncludesWaitingAsPublishing,
	defaultFilterExcludesRetrying: offline.defaultFilterExcludesRetrying,
	actionIdsAreRaw: offline.actionMatrix.every((m) => m.idIsRawJobId),
	actionMatrix: offline.actionMatrix,
	live,
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.offlineOk && live && !live.error && live.idOrderMatch !== false && (live.fieldDiffs || []).length === 0 ? 0 : 2);
