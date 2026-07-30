import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeRequiredScopes, analyzeGrantedScopes, DEFAULT_SCOPES, parseScopeList } from './scopes.js';
import {
	FACEBOOK_CHANNEL_PACK_PHASE,
	FACEBOOK_CHANNEL_CAPABILITIES,
	getFacebookChannelPackDto,
} from './channel-pack.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('facebook F2 oauth foundation', () => {
	it('locks phase F2 with oauth enabled and publish disabled', () => {
		assert.equal(FACEBOOK_CHANNEL_PACK_PHASE, 'F2');
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.connect, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.listPages, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishNow, false);
		const dto = getFacebookChannelPackDto();
		assert.equal(dto.oauthImplemented, true);
		assert.equal(dto.publishImplemented, false);
		assert.equal(dto.queueImplemented, false);
	});

	it('merges required Meta page scopes', () => {
		const scopes = mergeRequiredScopes('public_profile');
		assert.ok(scopes.includes('pages_show_list'));
		assert.ok(scopes.includes('pages_manage_posts'));
		assert.ok(scopes.includes('public_profile'));
		assert.deepEqual(parseScopeList(DEFAULT_SCOPES.join(',')), [...DEFAULT_SCOPES]);
	});

	it('analyzes granted scopes', () => {
		const ok = analyzeGrantedScopes({
			requested: DEFAULT_SCOPES,
			granted: DEFAULT_SCOPES.join(','),
		});
		assert.equal(ok.ok, true);
		const missing = analyzeGrantedScopes({
			requested: DEFAULT_SCOPES,
			granted: 'pages_show_list',
		});
		assert.equal(missing.ok, false);
		assert.ok(missing.missing.includes('pages_manage_posts'));
	});

	it('ships oauth platform migration and routes', () => {
		assert.equal(
			existsSync(path.join(root, 'apps/pocketbase/pb_migrations/1785401000_facebook_oauth_platform.js')),
			true,
		);
		assert.equal(
			existsSync(path.join(root, 'apps/pocketbase/pb_migrations/1785401100_fix_facebook_app_credentials_schema.js')),
			true,
		);
		const route = readFileSync(path.join(root, 'apps/api/src/routes/facebook.js'), 'utf8');
		assert.match(route, /oauth\/callback/);
		assert.match(route, /oauth\/start/);
		assert.match(route, /pages\/sync/);
		assert.match(route, /token\/refresh/);
		assert.match(route, /workspace\.facebook\.manage/);
		assert.doesNotMatch(route, /\/publish/);
		assert.doesNotMatch(route, /\/schedule/);

		const admin = readFileSync(path.join(root, 'apps/api/src/routes/admin/facebook.js'), 'utf8');
		assert.match(admin, /oauth-config/);

		const adminMount = readFileSync(path.join(root, 'apps/api/src/routes/admin/index.js'), 'utf8');
		assert.match(adminMount, /\/facebook/);

		const secrets = readFileSync(path.join(root, 'apps/api/src/services/facebook/secrets.js'), 'utf8');
		assert.match(secrets, /encryptFacebookSecret/);
		assert.doesNotMatch(secrets, /res\.json\(\{[^}]*access_token/);

		const hub = readFileSync(path.join(root, 'apps/web/src/pages/app/FacebookPage.jsx'), 'utf8');
		assert.match(hub, /Connect Facebook/);
		assert.match(hub, /Sync Pages/);
		assert.match(hub, /Disconnect/);

		const adminUi = readFileSync(path.join(root, 'apps/web/src/pages/admin/AdminFacebookPage.jsx'), 'utf8');
		assert.match(adminUi, /Facebook OAuth App/);
		assert.match(adminUi, /App Secret/);
		assert.match(adminUi, /\/admin\/v1\/facebook\/oauth-config/);
		assert.doesNotMatch(adminUi, /pinterest\/oauth-config/);

		const ensure = readFileSync(path.join(root, 'apps/api/src/utils/ensure-facebook-oauth-schema.js'), 'utf8');
		assert.match(ensure, /facebook_app_credentials/);
		assert.match(ensure, /collections\.create/);

		const credentials = readFileSync(path.join(root, 'apps/api/src/services/facebook/app-credentials.js'), 'utf8');
		assert.match(credentials, /ensureFacebookOAuthSchema/);
	});

	it('does not modify Pinterest oauth routes', () => {
		const pin = readFileSync(path.join(root, 'apps/api/src/routes/pinterest.js'), 'utf8');
		assert.match(pin, /oauth\/start/);
		assert.match(pin, /oauth\/callback/);
		assert.doesNotMatch(pin, /facebook_accounts/);
	});
});
