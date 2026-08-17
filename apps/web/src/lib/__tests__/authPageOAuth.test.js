/**
 * Login / Signup Google button gating.
 * Run: node --test src/lib/__tests__/authPageOAuth.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	getLiveAuthPageOAuthProviders,
	isAuthPageOAuthProviderLive,
	isPocketBaseOAuth2Enabled,
} from '../auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const loginSource = readFileSync(path.resolve(here, '../../pages/auth/LoginPage.jsx'), 'utf8');
const signupSource = readFileSync(path.resolve(here, '../../pages/auth/SignupPage.jsx'), 'utf8');

function googleLive(authMethods) {
	return getLiveAuthPageOAuthProviders(authMethods).some((provider) => provider.name === 'google');
}

describe('auth page Google button gating', () => {
	it('hides Google when OAuth2 is disabled', () => {
		const authMethods = {
			oauth2: {
				enabled: false,
				providers: [{ name: 'google' }],
			},
		};
		assert.equal(isPocketBaseOAuth2Enabled(authMethods), false);
		assert.equal(isAuthPageOAuthProviderLive('google', authMethods), false);
		assert.equal(googleLive(authMethods), false);
	});

	it('hides Google when OAuth2 is enabled but Google is absent', () => {
		const authMethods = {
			oauth2: {
				enabled: true,
				providers: [{ name: 'github' }],
			},
		};
		assert.equal(isPocketBaseOAuth2Enabled(authMethods), true);
		assert.equal(isAuthPageOAuthProviderLive('google', authMethods), false);
		assert.equal(googleLive(authMethods), false);
	});

	it('shows Google when OAuth2 is enabled and Google is present', () => {
		const authMethods = {
			oauth2: {
				enabled: true,
				providers: [{ name: 'google' }],
			},
		};
		assert.equal(isAuthPageOAuthProviderLive('google', authMethods), true);
		assert.equal(googleLive(authMethods), true);
	});

	it('does not enable Google for empty, missing, or failed auth-method data', () => {
		assert.equal(googleLive(null), false);
		assert.equal(googleLive(undefined), false);
		assert.equal(googleLive({}), false);
		assert.equal(googleLive({ oauth2: {} }), false);
		assert.equal(googleLive({ oauth2: { enabled: true } }), false);
		assert.equal(googleLive({ oauth2: { enabled: true, providers: [] } }), false);
		assert.equal(googleLive({ oauth2: { enabled: 'true', providers: [{ name: 'google' }] } }), false);
	});

	it('keeps Login and Signup email/password forms and live-gates OAuth buttons', () => {
		assert.match(loginSource, /getLiveAuthPageOAuthProviders\(authMethods\)/);
		assert.match(signupSource, /getLiveAuthPageOAuthProviders\(authMethods\)/);
		assert.doesNotMatch(loginSource, /enabledProviders\.size > 0/);
		assert.doesNotMatch(signupSource, /enabledProviders\.size > 0/);
		assert.match(loginSource, /await login\(normalized, password\)/);
		assert.match(signupSource, /await signup\(/);
		assert.match(loginSource, /type="email"/);
		assert.match(signupSource, /type="email"/);
		assert.match(loginSource, /type="password"/);
		assert.match(signupSource, /type="password"/);
	});
});
