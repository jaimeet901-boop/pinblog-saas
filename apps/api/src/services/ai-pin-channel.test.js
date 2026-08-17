/**
 * AI-CROSS-02 Phase 1 — ai_pins studio channel.
 * Run: node --test src/services/ai-pin-channel.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	assertImageJobPinChannel,
	assertPinStudioChannel,
	buildAiPinsLibraryChannelClause,
	isPinPublishableOnChannel,
	parseOptionalStudioChannel,
	parseRequiredStudioChannel,
	pinMatchesStudioChannel,
	pinVisibleInLibrary,
	recordChannel,
	stampDraftChannel,
} from './ai-pin-channel.js';
import { stripClientWorkspaceFields } from './ai-pin-draft-ownership.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSrc = path.resolve(here, '..');
const repoRoot = path.resolve(apiSrc, '../../..');

function readSrc(relativePath) {
	return readFileSync(path.join(apiSrc, relativePath), 'utf8');
}

function readRepo(relativePath) {
	return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const MIXED_ROWS = [
	{ id: 'pin-p', workspace: 'ws-a', websiteId: 'site-a', channel: 'pinterest' },
	{ id: 'pin-f', workspace: 'ws-a', websiteId: 'site-a', channel: 'facebook' },
	{ id: 'pin-empty', workspace: 'ws-a', websiteId: 'site-a', channel: '' },
	{ id: 'pin-null', workspace: 'ws-a', websiteId: 'site-a' },
	{ id: 'pin-other-ws', workspace: 'ws-b', websiteId: 'site-a', channel: 'pinterest' },
];

function libraryRows(channel, workspace = 'ws-a') {
	return MIXED_ROWS.filter((row) => (
		row.workspace === workspace && pinVisibleInLibrary(row, channel)
	));
}

describe('AI-CROSS-02 library visibility', () => {
	it('Pinterest list excludes facebook rows and keeps empty legacy rows', () => {
		const ids = libraryRows('pinterest').map((row) => row.id);
		assert.deepEqual(ids, ['pin-p', 'pin-empty', 'pin-null']);
		assert.equal(ids.includes('pin-f'), false);
		assert.equal(ids.includes('pin-other-ws'), false);
	});

	it('Facebook list excludes pinterest rows and keeps empty legacy rows', () => {
		const ids = libraryRows('facebook').map((row) => row.id);
		assert.deepEqual(ids, ['pin-f', 'pin-empty', 'pin-null']);
		assert.equal(ids.includes('pin-p'), false);
	});

	it('empty legacy rows remain visible in both libraries', () => {
		assert.equal(pinVisibleInLibrary({ id: 'legacy', channel: '' }, 'pinterest'), true);
		assert.equal(pinVisibleInLibrary({ id: 'legacy', channel: null }, 'facebook'), true);
		assert.equal(pinVisibleInLibrary({ id: 'legacy' }, 'pinterest'), true);
		assert.equal(pinVisibleInLibrary({ id: 'legacy' }, 'facebook'), true);
	});

	it('library filter clause includes requested channel or empty/null', () => {
		assert.equal(
			buildAiPinsLibraryChannelClause('pinterest'),
			'(channel = "pinterest" || channel = "" || channel = null)',
		);
		assert.equal(
			buildAiPinsLibraryChannelClause('facebook'),
			'(channel = "facebook" || channel = "" || channel = null)',
		);
	});
});

describe('AI-CROSS-02 channel parse + stamp', () => {
	it('Pinterest draft stamps pinterest and Facebook draft stamps facebook', () => {
		assert.equal(parseRequiredStudioChannel('pinterest'), 'pinterest');
		assert.equal(parseRequiredStudioChannel('facebook'), 'facebook');
		assert.equal(stampDraftChannel({ requestChannel: 'pinterest' }), 'pinterest');
		assert.equal(stampDraftChannel({ requestChannel: 'facebook' }), 'facebook');
	});

	it('client item.channel cannot override server channel', () => {
		const stripped = stripClientWorkspaceFields({
			title: 'Pin',
			channel: 'facebook',
			websiteId: 'site-a',
		});
		assert.equal(Object.prototype.hasOwnProperty.call(stripped, 'channel'), false);
		const stamped = stampDraftChannel({
			requestChannel: 'pinterest',
			sourceRecord: null,
		});
		assert.equal(stamped, 'pinterest');
		assert.notEqual(stamped, 'facebook');
	});

	it('invalid or missing channel → 422', () => {
		assert.throws(() => parseRequiredStudioChannel('instagram'), (error) => (
			error.status === 422 && /facebook or pinterest/.test(error.message)
		));
		assert.throws(() => parseRequiredStudioChannel(''), (error) => error.status === 422);
		assert.throws(() => parseRequiredStudioChannel(undefined), (error) => error.status === 422);
		assert.equal(parseOptionalStudioChannel(''), null);
		assert.equal(parseOptionalStudioChannel(undefined), null);
	});

	it('duplicate preserves DB channel including empty legacy', () => {
		assert.equal(
			stampDraftChannel({
				requestChannel: 'facebook',
				sourceRecord: { id: 'src', channel: 'pinterest' },
			}),
			'pinterest',
		);
		assert.equal(
			stampDraftChannel({
				requestChannel: 'facebook',
				sourceRecord: { id: 'src', channel: 'facebook' },
			}),
			'facebook',
		);
		assert.equal(
			stampDraftChannel({
				requestChannel: 'facebook',
				sourceRecord: { id: 'src', channel: '' },
			}),
			'',
		);
		assert.equal(
			stampDraftChannel({
				requestChannel: 'pinterest',
				sourceRecord: { id: 'src' },
			}),
			'',
		);
	});
});

describe('AI-CROSS-02 mutation and publish guards', () => {
	it('wrong-channel GET/PATCH/DELETE/editor → 404 without leaking the record', () => {
		const facebookPin = { id: 'secret-fb', title: 'Secret', channel: 'facebook' };
		assert.throws(
			() => assertPinStudioChannel(facebookPin, 'pinterest'),
			(error) => error.status === 404 && error.message === 'Pin not found',
		);
		assert.doesNotThrow(() => assertPinStudioChannel(facebookPin, 'facebook'));
		assert.doesNotThrow(() => assertPinStudioChannel({ id: 'legacy' }, 'pinterest'));
		assert.doesNotThrow(() => assertPinStudioChannel({ id: 'legacy', channel: '' }, 'facebook'));
		assert.equal(pinMatchesStudioChannel(facebookPin, null), true);
		assert.equal(recordChannel(facebookPin), 'facebook');
	});

	it('Pinterest rejects facebook pin; Facebook rejects pinterest pin; empty still allowed', () => {
		assert.equal(isPinPublishableOnChannel({ channel: 'facebook' }, 'pinterest'), false);
		assert.equal(isPinPublishableOnChannel({ channel: 'pinterest' }, 'facebook'), false);
		assert.equal(isPinPublishableOnChannel({ channel: 'pinterest' }, 'pinterest'), true);
		assert.equal(isPinPublishableOnChannel({ channel: 'facebook' }, 'facebook'), true);
		assert.equal(isPinPublishableOnChannel({ channel: '' }, 'pinterest'), true);
		assert.equal(isPinPublishableOnChannel({}, 'facebook'), true);
	});

	it('image job pinId cross-channel guard rejects stamped mismatch and omitted request', () => {
		assert.throws(
			() => assertImageJobPinChannel({ id: 'p1', channel: 'facebook' }, 'pinterest'),
			(error) => error.status === 404 && error.message === 'Pin not found',
		);
		assert.throws(
			() => assertImageJobPinChannel({ id: 'p1', channel: 'pinterest' }, null),
			(error) => error.status === 404 && error.message === 'Pin not found',
		);
		assert.doesNotThrow(() => assertImageJobPinChannel({ id: 'p1', channel: 'pinterest' }, 'pinterest'));
		assert.doesNotThrow(() => assertImageJobPinChannel({ id: 'legacy', channel: '' }, 'facebook'));
		assert.doesNotThrow(() => assertImageJobPinChannel({ id: 'legacy' }, null));
		assert.doesNotThrow(() => assertImageJobPinChannel(null, 'pinterest'));
	});
});

describe('AI-CROSS-02 route wiring', () => {
	it('GET /pins requires channel and filters workspace + website + channel-or-empty', () => {
		const src = readSrc('routes/ai-pins.js');
		const start = src.indexOf("router.get('/pins'");
		const end = src.indexOf("router.get('/pins/:pinId'");
		const handler = src.slice(start, end);
		assert.match(handler, /parseRequiredStudioChannel\(req\.query\.channel\)/);
		assert.match(handler, /channel = \{\:channel\} \|\| channel = "" \|\| channel = null/);
		assert.match(handler, /listWorkspaceResourcesFull\('ai_pins'/);
		assert.match(handler, /getOwnedWebsite/);
	});

	it('workspace isolation remains intact and is applied before channel', () => {
		const src = readSrc('routes/ai-pins.js');
		assert.match(src, /getWorkspaceOwnedRecord\('ai_pins', pinId, req, \{ notFoundMessage: 'Pin not found' \}\)/);
		assert.match(src, /listWorkspaceResourcesFull\('ai_pins', req/);
		const owned = src.indexOf("getWorkspaceOwnedRecord('ai_pins'");
		const channelAssert = src.indexOf('assertPinStudioChannel(pin, requested)');
		assert.ok(owned >= 0 && channelAssert > owned);
		assert.equal(libraryRows('pinterest', 'ws-a').some((row) => row.workspace !== 'ws-a'), false);
		assert.equal(libraryRows('pinterest', 'ws-a').some((row) => row.id === 'pin-other-ws'), false);
	});

	it('GET/PATCH/DELETE/editor/ensure-source-url enforce channel via getOwnedAiPin after workspace', () => {
		const src = readSrc('routes/ai-pins.js');
		assert.match(src, /getWorkspaceOwnedRecord\('ai_pins'/);
		assert.match(src, /assertPinStudioChannel\(pin, requested\)/);
		assert.ok(
			src.indexOf("getWorkspaceOwnedRecord('ai_pins'") < src.indexOf('assertPinStudioChannel(pin, requested)'),
			'workspace isolation must run before channel 404',
		);
		assert.match(src, /router\.get\('\/pins\/:pinId'/);
		assert.match(src, /router\.patch\('\/pins\/:pinId'/);
		assert.match(src, /router\.delete\('\/pins\/:pinId'/);
		assert.match(src, /router\.patch\('\/pins\/:pinId\/editor'/);
		assert.match(src, /router\.post\('\/pins\/ensure-source-url'/);
		const patchStart = src.indexOf("router.patch('/pins/:pinId'");
		const patchEnd = src.indexOf("router.delete('/pins/:pinId'");
		const patchHandler = src.slice(patchStart, patchEnd);
		assert.doesNotMatch(patchHandler, /updates\.channel\s*=/);
		assert.doesNotMatch(patchHandler, /\['channel'/);
	});

	it('Pinterest publish rejects facebook-stamped pins with 404', () => {
		const src = readSrc('routes/pinterest.js');
		assert.match(src, /isPinPublishableOnChannel\(pin, 'pinterest'\)/);
		assert.match(src, /One or more selected pins were not found/);
	});

	it('Facebook publish rejects pinterest-stamped pins as not found', () => {
		const src = readSrc('services/facebook/publish.js');
		assert.match(src, /isPinPublishableOnChannel\(aiPin, 'facebook'\)/);
		assert.match(src, /AI pin not found/);
	});

	it('image jobs with pinId assert channel before reuse', () => {
		const src = readSrc('routes/ai-pin-images.js');
		assert.match(src, /assertImageJobPinChannel\(pin, requestedChannel\)/);
		assert.ok(
			src.indexOf('assertImageJobPinChannel(pin, requestedChannel)')
				< src.indexOf('existingActiveJob'),
			'cross-channel guard must run before job reuse',
		);
		assert.match(src, /jobs\/:jobId\/regenerate/);
		assert.match(src, /assertImageJobPinChannel\(/);
	});

	it('additive channel migration does not backfill or rewrite rows', () => {
		const migration = readRepo('apps/pocketbase/pb_migrations/1786800000_ai_pins_channel.js');
		assert.match(migration, /name: "channel"/);
		assert.match(migration, /required: false/);
		assert.match(migration, /pinterest/);
		assert.match(migration, /facebook/);
		assert.match(migration, /idx_ai_pins_workspace_website_channel/);
		assert.match(migration, /`workspace`, `websiteId`, `channel`/);
		assert.doesNotMatch(migration, /findRecordsByFilter/);
		assert.doesNotMatch(migration, /\.save\(record\)/);
		assert.doesNotMatch(migration, /for \(const record/);
	});
});
