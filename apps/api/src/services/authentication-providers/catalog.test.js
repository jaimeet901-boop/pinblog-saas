import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	AUTH_PROVIDER_CATALOG,
	AUTH_PROVIDER_IDS,
	defaultAuthRedirectUri,
	getAuthProviderCatalogEntry,
	isManagedAuthProvider,
} from './catalog.js';

describe('authentication providers catalog', () => {
	it('includes google as the only configurable provider today', () => {
		const google = getAuthProviderCatalogEntry('google');
		assert.ok(google);
		assert.equal(google.configurable, true);
		assert.equal(google.pocketBaseNative, true);
		assert.match(google.authURL, /accounts\.google\.com/);
		const configurable = AUTH_PROVIDER_CATALOG.filter((entry) => entry.configurable);
		assert.equal(configurable.length, 1);
		assert.equal(configurable[0].id, 'google');
	});

	it('reserves future login providers without marking them configurable', () => {
		for (const id of ['apple', 'microsoft', 'github', 'discord']) {
			const entry = getAuthProviderCatalogEntry(id);
			assert.ok(entry, id);
			assert.equal(entry.configurable, false);
			assert.equal(isManagedAuthProvider(id), true);
		}
		assert.deepEqual([...AUTH_PROVIDER_IDS], ['google', 'apple', 'microsoft', 'github', 'discord']);
	});

	it('builds PocketBase oauth2-redirect URI from WEBSITE_DOMAIN', () => {
		const previous = process.env.WEBSITE_DOMAIN;
		process.env.WEBSITE_DOMAIN = 'tbuy.store';
		try {
			assert.equal(
				defaultAuthRedirectUri(),
				'https://tbuy.store/hcgi/platform/api/oauth2-redirect',
			);
		} finally {
			if (previous == null) delete process.env.WEBSITE_DOMAIN;
			else process.env.WEBSITE_DOMAIN = previous;
		}
	});

	it('stays separate from publishing provider ids', () => {
		for (const id of AUTH_PROVIDER_IDS) {
			assert.notEqual(id, 'pinterest');
			assert.notEqual(id, 'facebook');
		}
	});
});
