/**
 * Workspace Config bus: version, cache, SSE, metrics.
 * Kept separate from the assembler so Admin writers can invalidate
 * without circular imports through platform-settings.
 *
 * Uses console structured logs (not audit logger) so unit tests and
 * cold imports do not require a live PocketBase process.
 */

function structuredLog(payload) {
	console.log('[INFO] [workspace-config]', payload);
}

/** Monotonic platform config version — bumped on Admin writes. */
let platformConfigVersion = 1;
const sseClients = new Set();

/** Cache: workspaceId -> { version, payload, expiresAt, bytes } */
const workspaceCache = new Map();
export const WORKSPACE_CONFIG_CACHE_TTL_MS = 30_000;

const metrics = {
	assemblies: 0,
	cacheHits: 0,
	cacheMisses: 0,
	lastAssemblyMs: 0,
	lastPayloadBytes: 0,
	totalAssemblyMs: 0,
	versionBumps: 0,
	sseConnects: 0,
	sseDisconnects: 0,
	invalidations: 0,
};

export function getWorkspaceConfigPlatformVersion() {
	return platformConfigVersion;
}

export function getWorkspaceConfigMetrics() {
	const lookups = metrics.cacheHits + metrics.cacheMisses;
	return {
		...metrics,
		cacheHitRatio: lookups === 0 ? 0 : Number((metrics.cacheHits / lookups).toFixed(4)),
		activeSseClients: sseClients.size,
		cacheEntries: workspaceCache.size,
		configVersion: String(platformConfigVersion),
	};
}

export function recordCacheHit() {
	metrics.cacheHits += 1;
}

export function recordCacheMiss() {
	metrics.cacheMisses += 1;
}

export function recordAssembly({ durationMs, payloadBytes }) {
	metrics.assemblies += 1;
	metrics.lastAssemblyMs = durationMs;
	metrics.lastPayloadBytes = payloadBytes;
	metrics.totalAssemblyMs += durationMs;
	structuredLog({
		event: 'config_rebuild',
		durationMs,
		payloadBytes,
		configVersion: String(platformConfigVersion),
		cacheHitRatio: getWorkspaceConfigMetrics().cacheHitRatio,
	});
}

export function getCachedWorkspaceConfig(cacheKey) {
	const cached = workspaceCache.get(cacheKey);
	if (
		cached
		&& cached.platformVersion === platformConfigVersion
		&& cached.expiresAt > Date.now()
	) {
		recordCacheHit();
		return cached.payload;
	}
	if (cached) {
		workspaceCache.delete(cacheKey);
	}
	recordCacheMiss();
	return null;
}

export function setCachedWorkspaceConfig(cacheKey, payload, bytes = 0) {
	workspaceCache.set(cacheKey, {
		platformVersion: platformConfigVersion,
		expiresAt: Date.now() + WORKSPACE_CONFIG_CACHE_TTL_MS,
		payload,
		bytes,
	});
}

export function bumpWorkspaceConfigVersion(reason = 'admin_write') {
	const previous = platformConfigVersion;
	platformConfigVersion += 1;
	const stamp = new Date().toISOString();
	const cleared = workspaceCache.size;
	workspaceCache.clear();
	metrics.versionBumps += 1;
	metrics.invalidations += 1;

	structuredLog({
		event: 'config_version_change',
		reason,
		previousVersion: String(previous),
		configVersion: String(platformConfigVersion),
		updated_at: stamp,
	});
	structuredLog({
		event: 'cache_invalidation',
		reason,
		clearedEntries: cleared,
		configVersion: String(platformConfigVersion),
	});

	for (const client of sseClients) {
		try {
			client.write(`event: config\ndata: ${JSON.stringify({
				configVersion: String(platformConfigVersion),
				updated_at: stamp,
				reason,
			})}\n\n`);
		} catch {
			sseClients.delete(client);
		}
	}

	return platformConfigVersion;
}

export function subscribeWorkspaceConfigStream(res, meta = {}) {
	sseClients.add(res);
	metrics.sseConnects += 1;
	structuredLog({
		event: 'sse_connect',
		workspace_id: meta.workspaceId || '',
		activeSseClients: sseClients.size,
		configVersion: String(platformConfigVersion),
	});

	res.write(`event: connected\ndata: ${JSON.stringify({
		configVersion: String(platformConfigVersion),
		apiVersion: meta.apiVersion || 'v1',
	})}\n\n`);

	return () => {
		if (!sseClients.has(res)) return;
		sseClients.delete(res);
		metrics.sseDisconnects += 1;
		structuredLog({
			event: 'sse_disconnect',
			workspace_id: meta.workspaceId || '',
			activeSseClients: sseClients.size,
			configVersion: String(platformConfigVersion),
		});
	};
}

/** Test-only reset. Do not call from production request paths. */
export function resetWorkspaceConfigBusForTests() {
	platformConfigVersion = 1;
	workspaceCache.clear();
	sseClients.clear();
	metrics.assemblies = 0;
	metrics.cacheHits = 0;
	metrics.cacheMisses = 0;
	metrics.lastAssemblyMs = 0;
	metrics.lastPayloadBytes = 0;
	metrics.totalAssemblyMs = 0;
	metrics.versionBumps = 0;
	metrics.sseConnects = 0;
	metrics.sseDisconnects = 0;
	metrics.invalidations = 0;
}
