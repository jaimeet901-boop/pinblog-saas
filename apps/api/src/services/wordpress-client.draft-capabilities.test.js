/**
 * P1-7 — WordPress draft-only capability enforcement.
 * Run: node --test src/services/wordpress-client.draft-capabilities.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function hasWordpressCapability(capabilities, key) {
	if (!capabilities || typeof capabilities !== 'object') return false;
	return Boolean(capabilities[key]);
}

function wordpressCapabilitiesFromKeys(keys = []) {
	if (!Array.isArray(keys)) return {};
	return Object.fromEntries(keys.filter(Boolean).map((key) => [key, true]));
}

function wordpressStatusRequiresPublishCapability(wpStatus) {
	const normalized = String(wpStatus || '').toLowerCase();
	return normalized === 'publish' || normalized === 'future' || normalized === 'private';
}

function assertWordpressConnectionCapabilities(me, username) {
	const displayName = me?.name || username || 'WordPress user';
	if (!hasWordpressCapability(me?.capabilities, 'edit_posts')) {
		const error = new Error(`WordPress account "${displayName}" is authenticated but cannot create or edit posts (edit_posts capability missing).`);
		error.errorCode = 'WP_CAPABILITY_DENIED';
		error.authFailed = false;
		throw error;
	}
}

function assertWordpressStatusAllowed(me, wpStatus, username) {
	const displayName = me?.name || username || 'WordPress user';
	const capabilities = me?.capabilities || {};

	if (!hasWordpressCapability(capabilities, 'edit_posts')) {
		const error = new Error(`WordPress account "${displayName}" is authenticated but cannot create or edit posts (edit_posts capability missing).`);
		error.errorCode = 'WP_CAPABILITY_DENIED';
		error.authFailed = false;
		throw error;
	}

	if (wordpressStatusRequiresPublishCapability(wpStatus) && !hasWordpressCapability(capabilities, 'publish_posts')) {
		const action = String(wpStatus || '').toLowerCase() === 'future'
			? 'schedule posts for publication'
			: 'publish posts publicly';
		const error = new Error(`WordPress account "${displayName}" cannot ${action} (publish_posts capability missing).`);
		error.errorCode = 'WP_CAPABILITY_DENIED';
		error.authFailed = false;
		throw error;
	}
}

function mapWpStatus(status, scheduledAt) {
	const normalized = String(status || 'draft').toLowerCase();
	if (normalized === 'future' || (scheduledAt && ['schedule', 'scheduled'].includes(normalized))) {
		return 'future';
	}
	if (['draft', 'pending', 'private', 'publish', 'future'].includes(normalized)) {
		return normalized;
	}
	if (normalized === 'live' || normalized === 'published') return 'publish';
	return 'draft';
}

const draftOnlyMe = {
	name: 'Contributor',
	capabilities: { edit_posts: true },
};
const publishCapableMe = {
	name: 'Editor',
	capabilities: { edit_posts: true, publish_posts: true },
};

describe('wordpress draft-only capabilities (P1-7)', () => {
	it('allows draft-only accounts to pass connection capability check', () => {
		assert.doesNotThrow(() => assertWordpressConnectionCapabilities(draftOnlyMe, 'contributor'));
	});

	it('denies public publish for draft-only accounts', () => {
		assert.throws(
			() => assertWordpressStatusAllowed(draftOnlyMe, 'publish', 'contributor'),
			(err) => err.errorCode === 'WP_CAPABILITY_DENIED' && err.authFailed === false,
		);
	});

	it('denies scheduling for draft-only accounts', () => {
		assert.throws(
			() => assertWordpressStatusAllowed(draftOnlyMe, 'future', 'contributor'),
			(err) => err.errorCode === 'WP_CAPABILITY_DENIED',
		);
	});

	it('allows draft-only accounts to create or update drafts', () => {
		assert.doesNotThrow(() => assertWordpressStatusAllowed(draftOnlyMe, 'draft', 'contributor'));
		assert.doesNotThrow(() => assertWordpressStatusAllowed(draftOnlyMe, 'pending', 'contributor'));
	});

	it('keeps publish-capable accounts allowed for publish and schedule', () => {
		assert.doesNotThrow(() => assertWordpressStatusAllowed(publishCapableMe, 'publish', 'editor'));
		assert.doesNotThrow(() => assertWordpressStatusAllowed(publishCapableMe, 'future', 'editor'));
		assert.doesNotThrow(() => assertWordpressStatusAllowed(publishCapableMe, 'draft', 'editor'));
	});

	it('treats publish, future, and private as publish-capability statuses', () => {
		assert.equal(wordpressStatusRequiresPublishCapability('publish'), true);
		assert.equal(wordpressStatusRequiresPublishCapability('future'), true);
		assert.equal(wordpressStatusRequiresPublishCapability('private'), true);
		assert.equal(wordpressStatusRequiresPublishCapability('draft'), false);
		assert.equal(wordpressStatusRequiresPublishCapability('pending'), false);
	});

	it('maps schedule requests to future status', () => {
		assert.equal(mapWpStatus('future', '2026-12-01T10:00:00.000Z'), 'future');
		assert.equal(mapWpStatus('scheduled', '2026-12-01T10:00:00.000Z'), 'future');
	});

	it('createOrUpdateWordpressPost checks live capabilities before posting (source)', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-client.js'), 'utf8');
		const fnBlock = source.slice(
			source.indexOf('export async function createOrUpdateWordpressPost'),
			source.indexOf('export function decryptSitePassword'),
		);
		assert.match(fnBlock, /users\/me\?context=edit/);
		assert.match(fnBlock, /assertWordpressStatusAllowed\(me, wpStatus, username\)/);
		const wpFetchIdx = fnBlock.indexOf('await wpFetch(base, auth, path');
		const assertIdx = fnBlock.indexOf('assertWordpressStatusAllowed(me, wpStatus, username)');
		assert.ok(assertIdx > 0 && assertIdx < wpFetchIdx);
	});

	it('connection test requires edit_posts only, not publish_posts (source)', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-client.js'), 'utf8');
		const testBlock = source.slice(
			source.indexOf('export async function testWordpressConnection'),
			source.indexOf('function mapTerm(item)'),
		);
		assert.match(testBlock, /assertWordpressConnectionCapabilities\(me, username\)/);
		assert.doesNotMatch(testBlock, /assertWordpressPublishCapabilities/);
	});

	it('enqueue rejects publish/schedule when cached site health lacks publish_posts (source)', () => {
		const source = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
		assert.match(source, /assertWordpressStatusAllowed\(/);
		assert.match(source, /site\?\.health\?\.capabilities/);
	});

	it('retry worker path still uses createOrUpdateWordpressPost capability gate (source)', () => {
		const queueSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish-queue.js'), 'utf8');
		assert.match(queueSource, /createOrUpdateWordpressPost\(/);
		assert.match(queueSource, /status: job\.wp_status/);
	});

	it('P1-5 workspace scoping on publish enqueue remains intact (source)', () => {
		const publishSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish.js'), 'utf8');
		assert.match(publishSource, /req:\s*ctx\.req/);
		assert.match(publishSource, /resolvePublishSite\([\s\S]*req: ctx\.req/);
	});

	it('P1-6 retry idempotency helpers remain intact (source)', () => {
		const queueSource = readFileSync(path.join(root, 'apps/api/src/services/wordpress-publish-queue.js'), 'utf8');
		assert.match(queueSource, /persistWordpressPostIdentity/);
		assert.match(queueSource, /resolveWordpressUpdatePostId/);
	});

	it('builds capability objects from cached health keys', () => {
		assert.deepEqual(
			wordpressCapabilitiesFromKeys(['edit_posts']),
			{ edit_posts: true },
		);
	});
});
