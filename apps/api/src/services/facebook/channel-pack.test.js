import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FACEBOOK_CHANNEL_CAPABILITIES,
	FACEBOOK_CHANNEL_PACK_PHASE,
	FACEBOOK_COLLECTIONS,
	FACEBOOK_FEATURE_KEY,
	FACEBOOK_JOB_COLLECTION,
	FACEBOOK_SECRET_COLLECTIONS,
	FACEBOOK_WORKSPACE_CAPABILITIES,
	getFacebookChannelPackDto,
	isFacebookCollection,
} from './channel-pack.js';
import { hasFeatureCatalogKey, getFeatureCatalogEntry, validateFeatureCatalog } from '../feature-catalog.js';
import { PUBLISHING_JOB_COLLECTIONS } from '../publishing-history/constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const migrationPath = path.join(root, 'apps/pocketbase/pb_migrations/1785400000_facebook_channel_pack.js');
const rbacPath = path.join(root, 'apps/api/src/services/workspace-rbac.js');
const calendarArchPath = path.join(root, 'apps/api/src/services/calendar/calendar-architecture.js');

describe('facebook channel pack F1-Apply', () => {
	it('locks phase and feature key', () => {
		assert.equal(FACEBOOK_CHANNEL_PACK_PHASE, 'F2');
		assert.equal(FACEBOOK_FEATURE_KEY, 'facebook');
		assert.equal(FACEBOOK_JOB_COLLECTION, 'facebook_publish_jobs');
	});

	it('registers approved collections only', () => {
		assert.ok(FACEBOOK_COLLECTIONS.includes('facebook_accounts'));
		assert.ok(FACEBOOK_COLLECTIONS.includes('facebook_app_credentials'));
		assert.ok(FACEBOOK_SECRET_COLLECTIONS.includes('facebook_account_secrets'));
		assert.equal(isFacebookCollection('facebook_pages'), true);
		assert.equal(isFacebookCollection('pinterest_accounts'), false);
	});

	it('registers feature catalog key facebook', () => {
		assert.equal(validateFeatureCatalog().ok, true);
		assert.equal(hasFeatureCatalogKey('facebook'), true);
		const entry = getFeatureCatalogEntry('facebook');
		assert.equal(entry.group, 'core');
		assert.equal(entry.stage, 'reserved');
	});

	it('registers publishing job collection map', () => {
		assert.equal(PUBLISHING_JOB_COLLECTIONS.facebook, 'facebook_publish_jobs');
		assert.equal(PUBLISHING_JOB_COLLECTIONS.pinterest, 'pinterest_publish_jobs');
	});

	it('keeps Calendar SoT ref type without redesign', () => {
		const src = readFileSync(calendarArchPath, 'utf8');
		assert.ok(src.includes("'facebook_publish_jobs'"));
		assert.ok(src.includes("CALENDAR_CONSOLIDATION_PHASE = 'C10'"));
	});

	it('registers workspace RBAC permissions', () => {
		const rbac = readFileSync(rbacPath, 'utf8');
		for (const cap of FACEBOOK_WORKSPACE_CAPABILITIES) {
			assert.ok(rbac.includes(`'${cap}': true`), `missing capability map entry ${cap}`);
		}
		const editorBlock = rbac.slice(rbac.indexOf('editor: ['), rbac.indexOf('author: ['));
		const authorBlock = rbac.slice(rbac.indexOf('author: ['), rbac.indexOf('viewer: ['));
		const viewerBlock = rbac.slice(rbac.indexOf('viewer: ['), rbac.indexOf('custom: ['));
		assert.ok(editorBlock.includes('workspace.facebook.manage'));
		assert.ok(editorBlock.includes('workspace.facebook.publish'));
		assert.ok(authorBlock.includes('workspace.facebook.publish'));
		assert.ok(!authorBlock.includes('workspace.facebook.manage'));
		assert.ok(!viewerBlock.includes('workspace.facebook'));
	});

	it('registers channel capabilities with OAuth live and publish enabled after F4-6', () => {
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.connect, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishNow, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.queueImplemented, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.schedule, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.publishingHistory, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.insights, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.analytics, true);
		assert.equal(FACEBOOK_CHANNEL_CAPABILITIES.calendarProject, true);
		const dto = getFacebookChannelPackDto();
		assert.equal(dto.oauthImplemented, true);
		assert.equal(dto.graphImplemented, true);
		assert.equal(dto.publishImplemented, true);
		assert.equal(dto.queueImplemented, true);
	});

	it('ships PocketBase migration with API-only collections', () => {
		assert.equal(existsSync(migrationPath), true);
		const src = [
			readFileSync(migrationPath, 'utf8'),
			readFileSync(path.join(root, 'apps/pocketbase/pb_migrations/1785401000_facebook_oauth_platform.js'), 'utf8'),
		].join('\n');
		for (const name of FACEBOOK_COLLECTIONS) {
			assert.ok(src.includes(`"${name}"`), `missing ${name}`);
		}
		assert.match(src, /listRule:\s*null/);
		assert.match(src, /idx_facebook_publish_jobs_status_sched/);
		assert.doesNotMatch(src, /pinterest_accounts/);
		assert.doesNotMatch(src, /graph\.facebook/i);
	});
});
