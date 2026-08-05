/**
 * Phase 4 — Pinterest OAuth frontend base URL resolution (pure).
 * Run: node --test src/services/pinterest-oauth-url.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildPinterestOAuthRedirectUrl,
	collectEnvWebAppCandidates,
	finalizePinterestOAuthWebAppBase,
	firstValidWebAppOrigin,
	isPlaceholderWebUrl,
	resolveWebAppBaseFromEnv,
	resolveWebAppBaseFromIdentity,
} from './pinterest-oauth-url.js';

describe('env precedence', () => {
	it('prefers WEB_APP_URL over CORS_ORIGIN', () => {
		const env = {
			WEB_APP_URL: 'https://app.chef-ia.io',
			CORS_ORIGIN: 'https://other.chef-ia.io',
		};
		assert.equal(resolveWebAppBaseFromEnv(env), 'https://app.chef-ia.io');
	});

	it('skips placeholder env values and uses the next valid candidate', () => {
		const env = {
			WEB_APP_URL: 'https://your-domain.com',
			APP_WEB_URL: 'https://chef.chef-ia.io/',
		};
		assert.equal(resolveWebAppBaseFromEnv(env), 'https://chef.chef-ia.io');
	});

	it('collects env candidates in the established order', () => {
		const env = {
			WEB_APP_URL: 'https://first.chef-ia.io',
			APP_WEB_URL: 'https://second.chef-ia.io',
			PUBLIC_APP_URL: 'https://third.chef-ia.io',
		};
		const collected = collectEnvWebAppCandidates(env);
		assert.equal(collected[0], 'https://first.chef-ia.io');
		assert.ok(collected.includes('https://second.chef-ia.io'));
	});
});

describe('platform identity precedence', () => {
	it('uses appUrl before canonicalUrl and primaryDomain', () => {
		const identity = {
			appUrl: 'https://app.chef-ia.io',
			canonicalUrl: 'https://canonical.chef-ia.io',
			primaryDomain: 'primary.chef-ia.io',
		};
		assert.equal(resolveWebAppBaseFromIdentity(identity), 'https://app.chef-ia.io');
	});

	it('falls back to canonicalUrl then primaryDomain', () => {
		assert.equal(
			resolveWebAppBaseFromIdentity({ canonicalUrl: 'https://canonical.chef-ia.io' }),
			'https://canonical.chef-ia.io',
		);
		assert.equal(
			resolveWebAppBaseFromIdentity({ primaryDomain: 'chef.chef-ia.io' }),
			'https://chef.chef-ia.io',
		);
	});
});

describe('production fallback behavior', () => {
	it('throws in production when configuration is missing', () => {
		assert.throws(
			() => finalizePinterestOAuthWebAppBase('production'),
			(err) => err?.status === 503 && err?.errorCode === 'PINTEREST_OAUTH_FRONTEND_UNCONFIGURED',
		);
	});

	it('returns localhost in non-production when configuration is missing', () => {
		assert.equal(finalizePinterestOAuthWebAppBase('development'), 'http://localhost:3000');
		assert.equal(finalizePinterestOAuthWebAppBase('test'), 'http://localhost:3000');
	});
});

describe('buildPinterestOAuthRedirectUrl', () => {
	it('builds /app/pinterest with query parameters', () => {
		const href = buildPinterestOAuthRedirectUrl('https://app.chef-ia.io', {
			pinterest_connected: '1',
			pinterest_error: '',
			ignored: null,
		});
		const url = new URL(href);
		assert.equal(url.origin, 'https://app.chef-ia.io');
		assert.equal(url.pathname, '/app/pinterest');
		assert.equal(url.searchParams.get('pinterest_connected'), '1');
		assert.equal(url.searchParams.has('pinterest_error'), false);
	});

	it('rejects placeholder bases instead of silently substituting tbuy.store', () => {
		assert.throws(
			() => buildPinterestOAuthRedirectUrl('https://your-domain.com', { pinterest_error: 'x' }),
			(err) => err?.errorCode === 'PINTEREST_OAUTH_FRONTEND_UNCONFIGURED',
		);
	});

	it('does not treat tbuy.store as a special-case fallback', () => {
		assert.equal(isPlaceholderWebUrl('https://tbuy.store'), false);
		const href = buildPinterestOAuthRedirectUrl('https://tbuy.store', { pinterest_connected: '1' });
		assert.equal(new URL(href).origin, 'https://tbuy.store');
	});
});

describe('firstValidWebAppOrigin', () => {
	it('normalizes valid origins and skips empty values', () => {
		assert.equal(
			firstValidWebAppOrigin(['https://app.chef-ia.io/path', '']),
			'https://app.chef-ia.io',
		);
		assert.equal(firstValidWebAppOrigin(['', 'https://your-domain.com']), '');
	});
});
