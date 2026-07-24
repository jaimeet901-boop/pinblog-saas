/**
 * Unit tests for Workspace Config platform (Phase 1).
 * Run: node --test src/services/workspace-config.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
	bumpWorkspaceConfigVersion,
	getCachedWorkspaceConfig,
	getWorkspaceConfigMetrics,
	getWorkspaceConfigPlatformVersion,
	resetWorkspaceConfigBusForTests,
	setCachedWorkspaceConfig,
	subscribeWorkspaceConfigStream,
} from './workspace-config-bus.js';

import {
	buildFeatureFlags,
	isWorkspaceConfigUnchanged,
	stripSecrets,
	withProvenance,
	workspaceConfigEtag,
} from './workspace-config-helpers.js';

function mockReq({ since, etag } = {}) {
	return {
		query: since != null ? { since: String(since) } : {},
		get: (name) => {
			if (String(name).toLowerCase() === 'if-none-match') return etag || undefined;
			return undefined;
		},
	};
}

describe('workspace-config stripSecrets', () => {
	it('removes secret-like keys and ciphertext values', () => {
		const cleaned = stripSecrets({
			name: 'OpenAI',
			apiKey: 'sk-live-secret',
			config: {
				api_key: 'nested-secret',
				baseUrl: 'https://api.openai.com',
				password: 'hunter2',
				token: 'abc',
				note: 'safe',
			},
			cipher: 'enc:v1:abcdef',
			masked: '••••••••',
			client_secret: 'oauth-secret',
			ok: true,
		});

		assert.equal(cleaned.name, 'OpenAI');
		assert.equal(cleaned.ok, true);
		assert.equal(cleaned.config.baseUrl, 'https://api.openai.com');
		assert.equal(cleaned.config.note, 'safe');
		assert.equal(cleaned.apiKey, undefined);
		assert.equal(cleaned.config.api_key, undefined);
		assert.equal(cleaned.config.password, undefined);
		assert.equal(cleaned.config.token, undefined);
		assert.equal(cleaned.client_secret, undefined);
		assert.equal(cleaned.cipher, undefined);
		assert.equal(cleaned.masked, undefined);
	});
});

describe('workspace-config feature flags', () => {
	it('stamps provenance and preserves enabled state', () => {
		const flags = buildFeatureFlags({
			featureFlags: [
				{ id: 'ai-writer', label: 'AI Writer', enabled: true },
				{ id: 'api-access', label: 'API Access', enabled: false },
			],
		}, 'ws_a', '2026-07-24T00:00:00.000Z', '9');

		assert.equal(flags.length, 2);
		assert.equal(flags[0].id, 'ai-writer');
		assert.equal(flags[0].enabled, true);
		assert.equal(flags[0].workspace_id, 'ws_a');
		assert.equal(flags[0].source, 'platform');
		assert.equal(flags[0].version, '9');
		assert.equal(flags[1].enabled, false);
	});

	it('falls back to platform defaults when settings omit flags', () => {
		const flags = buildFeatureFlags({}, 'ws_b', null, '1');
		assert.ok(flags.length > 0);
		assert.ok(flags.every((flag) => flag.workspace_id === 'ws_b'));
		assert.ok(flags.some((flag) => flag.id === 'ai-writer'));
	});
});

describe('workspace-config ETag and 304', () => {
	it('builds quoted ETag from configVersion', () => {
		assert.equal(workspaceConfigEtag({ configVersion: '12' }), '"12"');
	});

	it('detects unchanged via since query', () => {
		const config = { configVersion: '7' };
		assert.equal(isWorkspaceConfigUnchanged(mockReq({ since: '7' }), config), true);
		assert.equal(isWorkspaceConfigUnchanged(mockReq({ since: '6' }), config), false);
		assert.equal(isWorkspaceConfigUnchanged(mockReq({}), config), false);
	});

	it('detects unchanged via If-None-Match (weak and quoted)', () => {
		const config = { configVersion: '3' };
		assert.equal(isWorkspaceConfigUnchanged(mockReq({ etag: '"3"' }), config), true);
		assert.equal(isWorkspaceConfigUnchanged(mockReq({ etag: 'W/"3"' }), config), true);
		assert.equal(isWorkspaceConfigUnchanged(mockReq({ etag: '"2"' }), config), false);
	});
});

describe('workspace-config cache invalidation', () => {
	beforeEach(() => {
		resetWorkspaceConfigBusForTests();
	});

	it('serves cache hits until bump clears entries', () => {
		setCachedWorkspaceConfig('ws_1', { configVersion: '1', workspace_id: 'ws_1' });
		assert.deepEqual(getCachedWorkspaceConfig('ws_1')?.workspace_id, 'ws_1');

		const before = getWorkspaceConfigMetrics();
		assert.ok(before.cacheHits >= 1);

		const next = bumpWorkspaceConfigVersion('unit_test');
		assert.equal(next, 2);
		assert.equal(getWorkspaceConfigPlatformVersion(), 2);
		assert.equal(getCachedWorkspaceConfig('ws_1'), null);

		const after = getWorkspaceConfigMetrics();
		assert.ok(after.invalidations >= 1);
		assert.ok(after.versionBumps >= 1);
		assert.equal(after.cacheEntries, 0);
	});
});

describe('workspace-config workspace isolation', () => {
	beforeEach(() => {
		resetWorkspaceConfigBusForTests();
	});

	it('keeps separate cache entries per workspace_id', () => {
		setCachedWorkspaceConfig('ws_a', { workspace_id: 'ws_a', value: 1 });
		setCachedWorkspaceConfig('ws_b', { workspace_id: 'ws_b', value: 2 });

		assert.equal(getCachedWorkspaceConfig('ws_a').value, 1);
		assert.equal(getCachedWorkspaceConfig('ws_b').value, 2);

		const stampedA = withProvenance({ name: 'kit' }, { workspaceId: 'ws_a', source: 'workspace' });
		const stampedB = withProvenance({ name: 'kit' }, { workspaceId: 'ws_b', source: 'workspace' });
		assert.equal(stampedA.workspace_id, 'ws_a');
		assert.equal(stampedB.workspace_id, 'ws_b');
		assert.notEqual(stampedA.workspace_id, stampedB.workspace_id);
	});

	it('does not leak workspace A payload into workspace B cache key', () => {
		setCachedWorkspaceConfig('ws_a', { workspace_id: 'ws_a', secretMark: 'A-only' });
		assert.equal(getCachedWorkspaceConfig('ws_b'), null);
		assert.equal(getCachedWorkspaceConfig('ws_a').secretMark, 'A-only');
	});
});

describe('workspace-config SSE lifecycle logging hooks', () => {
	beforeEach(() => {
		resetWorkspaceConfigBusForTests();
	});

	it('tracks connect and disconnect counts', () => {
		const writes = [];
		const res = {
			write: (chunk) => {
				writes.push(chunk);
				return true;
			},
		};

		const unsubscribe = subscribeWorkspaceConfigStream(res, { workspaceId: 'ws_sse', apiVersion: 'v1' });
		assert.ok(writes.some((chunk) => chunk.includes('event: connected')));
		assert.equal(getWorkspaceConfigMetrics().sseConnects, 1);
		assert.equal(getWorkspaceConfigMetrics().activeSseClients, 1);

		bumpWorkspaceConfigVersion('sse_test');
		assert.ok(writes.some((chunk) => chunk.includes('event: config')));

		unsubscribe();
		assert.equal(getWorkspaceConfigMetrics().sseDisconnects, 1);
		assert.equal(getWorkspaceConfigMetrics().activeSseClients, 0);
	});
});
