/**
 * Facebook Channel Pack — ai_pins lifecycle sync (F5-5).
 * Keeps Studio draft state aligned with facebook_publish_jobs user actions.
 * Not called from the publish queue worker.
 */

async function resolvePinSyncPocketbase(deps = {}) {
	if (deps.pocketbaseClient) return deps.pocketbaseClient;
	return (await import('../../utils/pocketbaseClient.js')).default;
}

async function resolvePinSyncSanitizer(deps = {}) {
	if (deps.sanitizeCollectionPayload) return deps.sanitizeCollectionPayload;
	const { sanitizeCollectionPayload } = await import('../../utils/pocketbase-safe-query.js');
	return sanitizeCollectionPayload;
}

async function resolvePinSyncDeps(deps = {}) {
	return {
		pocketbaseClient: await resolvePinSyncPocketbase(deps),
		sanitizeCollectionPayload: await resolvePinSyncSanitizer(deps),
		recordBelongsToWorkspace: deps.recordBelongsToWorkspace || null,
	};
}

function recordFieldId(value) {
	if (value == null || value === '') return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'object') return String(value.id || value.value || '').trim();
	return String(value).trim();
}

function resolveAiPinId(job = {}) {
	return recordFieldId(job.ai_pin || job.aiPinId || job.aiPin);
}

function resolveJobScheduledAt(job = {}) {
	return String(job.scheduled_at || job.scheduledAt || '').trim();
}

function resolveJobTimezone(job = {}) {
	return String(job.scheduled_timezone || job.timezone || 'UTC').trim() || 'UTC';
}

function pinFieldsMatch(pin = {}, updates = {}) {
	return Object.entries(updates).every(([key, value]) => String(pin[key] ?? '') === String(value ?? ''));
}

async function loadSyncableAiPin({ job, req, deps = {} }) {
	const pinId = resolveAiPinId(job);
	if (!pinId) {
		return { skipped: true, reason: 'no_ai_pin' };
	}

	const pocketbaseClient = await resolvePinSyncPocketbase(deps);
	const pin = await pocketbaseClient.collection('ai_pins').getOne(pinId, { requestKey: null }).catch(() => null);
	if (!pin) {
		return { skipped: true, reason: 'pin_not_found', pinId };
	}

	const jobOwner = recordFieldId(job.owner);
	if (recordFieldId(pin.owner) !== jobOwner) {
		return { skipped: true, reason: 'owner_mismatch', pinId };
	}

	if (req) {
		let recordBelongsToWorkspace = deps.recordBelongsToWorkspace;
		if (!recordBelongsToWorkspace) {
			({ recordBelongsToWorkspace } = await import('../workspace-ownership.js'));
		}
		if (!recordBelongsToWorkspace(req, job) || !recordBelongsToWorkspace(req, pin)) {
			return { skipped: true, reason: 'workspace_mismatch', pinId };
		}
	}

	return { skipped: false, pin, pinId };
}

async function applyAiPinSyncUpdate({
	pin,
	pinId,
	updates,
	deps = {},
	context = 'facebook:pin-sync',
}) {
	if (pinFieldsMatch(pin, updates)) {
		return { skipped: true, reason: 'already_synced', pinId };
	}

	const { pocketbaseClient, sanitizeCollectionPayload } = await resolvePinSyncDeps(deps);
	const payload = await sanitizeCollectionPayload({
		collection: 'ai_pins',
		context,
		payload: updates,
	});
	const updated = await pocketbaseClient.collection('ai_pins').update(pinId, payload);
	return { skipped: false, pinId, pin: updated };
}

export async function syncAiPinForScheduledJob(job, { req = null, deps = {} } = {}) {
	const loaded = await loadSyncableAiPin({ job, req, deps });
	if (loaded.skipped) return loaded;

	return applyAiPinSyncUpdate({
		pin: loaded.pin,
		pinId: loaded.pinId,
		updates: {
			status: 'scheduled',
			scheduled_at: resolveJobScheduledAt(job),
			scheduled_timezone: resolveJobTimezone(job),
			publish_job_id: String(job.id || '').trim(),
		},
		deps,
		context: 'facebook:pin-sync:scheduled',
	});
}

export async function syncAiPinForReschedule(job, { req = null, deps = {} } = {}) {
	const loaded = await loadSyncableAiPin({ job, req, deps });
	if (loaded.skipped) return loaded;

	return applyAiPinSyncUpdate({
		pin: loaded.pin,
		pinId: loaded.pinId,
		updates: {
			scheduled_at: resolveJobScheduledAt(job),
			scheduled_timezone: resolveJobTimezone(job),
		},
		deps,
		context: 'facebook:pin-sync:reschedule',
	});
}

export async function syncAiPinForCancel(job, { req = null, deps = {} } = {}) {
	const loaded = await loadSyncableAiPin({ job, req, deps });
	if (loaded.skipped) return loaded;

	return applyAiPinSyncUpdate({
		pin: loaded.pin,
		pinId: loaded.pinId,
		updates: {
			status: 'draft',
			scheduled_at: '',
			scheduled_timezone: '',
			publish_job_id: '',
		},
		deps,
		context: 'facebook:pin-sync:cancel',
	});
}

export async function syncAiPinForRetry(job, { req = null, deps = {} } = {}) {
	const loaded = await loadSyncableAiPin({ job, req, deps });
	if (loaded.skipped) return loaded;

	const scheduledAt = resolveJobScheduledAt(job) || new Date().toISOString();
	return applyAiPinSyncUpdate({
		pin: loaded.pin,
		pinId: loaded.pinId,
		updates: {
			status: 'scheduled',
			scheduled_at: scheduledAt,
			scheduled_timezone: resolveJobTimezone(job),
			publish_job_id: String(job.id || '').trim(),
		},
		deps,
		context: 'facebook:pin-sync:retry',
	});
}
