/**
 * P1-10 — GET /wordpress/sites/:id/health must be read-only.
 * Run: node --test src/services/wordpress-health-readonly.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { resolveStoredHealthFromLookup } from './wordpress-health-readonly.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const owner = 'owner-same';
const reqWsA = {
	pocketbaseUserId: owner,
	workspaceOwnerId: owner,
	workspaceKey: 'ws-a-key',
	workspace: { id: 'ws-a', owner, workspace_key: 'ws-a-key' },
};
const reqWsB = {
	pocketbaseUserId: owner,
	workspaceOwnerId: owner,
	workspaceKey: 'ws-b-key',
	workspace: { id: 'ws-b', owner, workspace_key: 'ws-b-key' },
};

describe('wordpress health GET read-only (P1-10)', () => {
	it('returns stored health for an owned wordpress_sites record', () => {
		const health = resolveStoredHealthFromLookup({
			ownerId: owner,
			wordpressSite: {
				id: 'wps-a',
				owner,
				workspace: 'ws-a',
				health: { ok: true, capabilities: ['edit_posts'] },
			},
			website: null,
			linkedWordpressSite: null,
			req: reqWsA,
		});
		assert.deepEqual(health, { ok: true, capabilities: ['edit_posts'] });
	});

	it('returns null when owned wordpress_sites record has no stored health', () => {
		const health = resolveStoredHealthFromLookup({
			ownerId: owner,
			wordpressSite: { id: 'wps-a', owner, workspace: 'ws-a', health: null },
			website: null,
			linkedWordpressSite: null,
			req: reqWsA,
		});
		assert.equal(health, null);
	});

	it('returns stored health for website ID with an existing linked wordpress_sites record', () => {
		const health = resolveStoredHealthFromLookup({
			ownerId: owner,
			wordpressSite: null,
			website: { id: 'web-a', owner, workspace: 'ws-a', url: 'https://example.com' },
			linkedWordpressSite: {
				id: 'wps-a',
				owner,
				workspace: 'ws-a',
				health: { ok: true, version: '6.4' },
			},
			req: reqWsA,
		});
		assert.deepEqual(health, { ok: true, version: '6.4' });
	});

	it('returns null for website ID with no linked wordpress_sites record', () => {
		const health = resolveStoredHealthFromLookup({
			ownerId: owner,
			wordpressSite: null,
			website: { id: 'web-a', owner, workspace: 'ws-a', url: 'https://example.com' },
			linkedWordpressSite: null,
			req: reqWsA,
		});
		assert.equal(health, null);
	});

	it('denies cross-workspace wordpress_sites access with NOT_FOUND', () => {
		assert.throws(
			() => resolveStoredHealthFromLookup({
				ownerId: owner,
				wordpressSite: {
					id: 'wps-b',
					owner,
					workspace: 'ws-b',
					health: { ok: true },
				},
				website: null,
				linkedWordpressSite: null,
				req: reqWsA,
			}),
			(error) => error.status === 404 && error.errorCode === 'NOT_FOUND',
		);
	});

	it('denies cross-workspace website access with NOT_FOUND', () => {
		assert.throws(
			() => resolveStoredHealthFromLookup({
				ownerId: owner,
				wordpressSite: null,
				website: { id: 'web-b', owner, workspace: 'ws-b', url: 'https://b.example.com' },
				linkedWordpressSite: null,
				req: reqWsA,
			}),
			(error) => error.status === 404 && error.errorCode === 'NOT_FOUND',
		);
	});

	it('getStoredWordpressSiteHealth does not call resolvePublishSite or ensureWordpressSiteFromWebsite', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-sites.js'), 'utf8');
		const fnBlock = source.slice(
			source.indexOf('export async function getStoredWordpressSiteHealth'),
			source.indexOf('export async function getSiteTaxonomy'),
		);
		assert.match(fnBlock, /findLinkedWordpressSiteReadOnly/);
		assert.match(fnBlock, /getOne/);
		assert.doesNotMatch(fnBlock, /resolvePublishSite/);
		assert.doesNotMatch(fnBlock, /ensureWordpressSiteFromWebsite/);
		assert.doesNotMatch(fnBlock, /getSiteCredentialsPlain/);
		assert.doesNotMatch(fnBlock, /testOwnedWordpressSite/);
		assert.doesNotMatch(fnBlock, /testWordpressConnection/);
		assert.doesNotMatch(fnBlock, /\.create\(/);
		assert.doesNotMatch(fnBlock, /\.update\(/);
		assert.doesNotMatch(fnBlock, /upsertCredentials/);
		assert.doesNotMatch(fnBlock, /ensureUserWorkspace/);
	});

	it('findLinkedWordpressSiteReadOnly uses read-only PocketBase queries only', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-sites.js'), 'utf8');
		const fnBlock = source.slice(
			source.indexOf('async function findLinkedWordpressSiteReadOnly'),
			source.indexOf('export function resolveStoredHealthFromLookup'),
		);
		assert.match(fnBlock, /getFirstListItem/);
		assert.doesNotMatch(fnBlock, /\.create\(/);
		assert.doesNotMatch(fnBlock, /\.update\(/);
		assert.doesNotMatch(fnBlock, /ensureWordpressSiteFromWebsite/);
	});

	it('getSiteTaxonomy health path does not invoke live probe helpers', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-sites.js'), 'utf8');
		assert.doesNotMatch(
			source.slice(source.indexOf("if (kind === 'health')"), source.indexOf('return withSiteClient')),
			/testOwnedWordpressSite/,
		);
	});

	it('POST test and connect routes still use live testOwnedWordpressSite probing', () => {
		const routes = readFileSync(path.join(root, 'apps/api/src/routes/wordpress/index.js'), 'utf8');
		const testBlock = routes.slice(routes.indexOf("router.post('/test'"), routes.indexOf("router.post('/sites/:id/connect'"));
		const connectBlock = routes.slice(routes.indexOf("router.post('/sites/:id/connect'"), routes.indexOf("router.post('/sites/:id/discover'"));
		assert.match(testBlock, /testOwnedWordpressSite/);
		assert.match(connectBlock, /testOwnedWordpressSite/);
	});

	it('testOwnedWordpressSite still performs live connection updates for POST probes', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-sites.js'), 'utf8');
		const fnBlock = source.slice(
			source.indexOf('export async function testOwnedWordpressSite'),
			source.indexOf('async function withSiteClient'),
		);
		assert.match(fnBlock, /testWordpressConnection/);
		assert.match(fnBlock, /wordpress_sites'\)\.update/);
	});

	it('P1-4 enqueue workspace scope remains intact (source)', () => {
		const publish = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
		assert.match(publish, /req:\s*ctx\.req/);
	});

	it('P1-5 workspace scoping remains intact (source)', () => {
		const publish = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
		assert.match(publish, /loadOwnedPublishJob/);
	});

	it('P1-6 retry idempotency remains intact (source)', () => {
		const queue = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish-queue.js'), 'utf8');
		assert.match(queue, /persistWordpressPostIdentity/);
	});

	it('P1-7 draft-only capabilities remain intact (source)', () => {
		const client = readFileSync(path.join(root, 'apps/api/src/services/wordpress-client.js'), 'utf8');
		assert.match(client, /assertWordpressStatusAllowed/);
	});

	it('P1-8 structured error serialization remains intact (source)', () => {
		const routes = readFileSync(path.join(root, 'apps/api/src/routes/wordpress/index.js'), 'utf8');
		assert.match(routes, /respondWordpressApiError\(res, err\)/);
	});

	it('P1-9 media error taxonomy remains intact (source)', () => {
		const client = readFileSync(path.join(root, 'apps/api/src/services/wordpress-client.js'), 'utf8');
		assert.match(client, /createMediaDownloadError/);
		assert.match(client, /refineMediaUploadRestError/);
	});
});
