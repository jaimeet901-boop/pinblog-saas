/**
 * Startup PocketBase OAuth2 apply must not wipe Google when Admin vault is empty.
 * Run: node --test src/services/authentication-providers/apply-plan.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planAuthenticationProvidersApply } from './apply-plan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const applySource = readFileSync(join(__dirname, 'apply-to-pocketbase.js'), 'utf8');
const credentialsSource = readFileSync(join(__dirname, 'credentials.js'), 'utf8');

const existingGoogle = {
	enabled: true,
	providers: [
		{
			name: 'google',
			clientId: 'live-google-client',
			displayName: 'Google',
		},
	],
};

describe('planAuthenticationProvidersApply wipe protection', () => {
	it('does not overwrite existing PocketBase OAuth2 providers with [] when Admin vault is empty', () => {
		const plan = planAuthenticationProvidersApply({
			existingOAuth2: existingGoogle,
			managedProviders: [],
			replaceManaged: false,
		});
		assert.equal(plan.skipProviderWrite, true);
		assert.equal(plan.providers.length, 1);
		assert.equal(plan.providers[0].name, 'google');
		assert.equal(plan.enabled, true);
		assert.notDeepEqual(plan.providers, []);
	});

	it('still applies a configured Google provider', () => {
		const managed = [{ name: 'google', clientId: 'admin-google-client' }];
		const plan = planAuthenticationProvidersApply({
			existingOAuth2: { enabled: false, providers: [] },
			managedProviders: managed,
			replaceManaged: false,
		});
		assert.equal(plan.skipProviderWrite, false);
		assert.equal(plan.providers[0].name, 'google');
		assert.equal(plan.providers[0].clientId, 'admin-google-client');
		assert.equal(plan.enabled, true);
	});

	it('Admin replaceManaged can clear managed providers while keeping custom ones', () => {
		const plan = planAuthenticationProvidersApply({
			existingOAuth2: {
				enabled: true,
				providers: [
					{ name: 'google', clientId: 'live-google-client' },
					{ name: 'custom-oidc', clientId: 'keep-me' },
				],
			},
			managedProviders: [],
			replaceManaged: true,
		});
		assert.equal(plan.skipProviderWrite, false);
		assert.equal(plan.providers.length, 1);
		assert.equal(plan.providers[0].name, 'custom-oidc');
	});
});

describe('startup apply wiring', () => {
	it('seed does not force replaceManaged; Admin save/reset does', () => {
		assert.match(applySource, /replaceManaged = false/);
		assert.match(applySource, /skipProviderWrite/);
		assert.match(credentialsSource, /applyProvidersSoft\(\{ replaceManaged: true \}\)/);
		assert.match(
			credentialsSource,
			/await applyProvidersSoft\(\);\n\treturn listAuthenticationProvidersPublic/,
		);
	});
});
