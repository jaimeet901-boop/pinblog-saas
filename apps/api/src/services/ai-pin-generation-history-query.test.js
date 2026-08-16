/**
 * WS-06 Facebook generation history query + writes.
 * Run: node --test src/services/ai-pin-generation-history-query.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import {
	parseGenerationHistoryChannel,
	buildGenerationHistoryChannelFilter,
	resolveGenerationHistoryExtraFilter,
	resolveGenerationHistoryWriteChannel,
} from './ai-pin-generation-history-query.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSrc = path.resolve(here, '..');

function readSrc(relativePath) {
	return readFileSync(path.join(apiSrc, relativePath), 'utf8');
}

function applyChannelFilter(rows, channel) {
	if (!channel) return rows;
	return rows.filter((row) => row?.metadata?.channel === channel);
}

function andWorkspaceScope(scope, extraFilter = '') {
	const extra = String(extraFilter || '').trim();
	if (!extra) return scope;
	return `(${scope}) && (${extra})`;
}

const MIXED_ROWS = [
	{ id: 'fb-1', metadata: { channel: 'facebook' } },
	{ id: 'pin-1', metadata: { channel: 'pinterest' } },
	{ id: 'legacy-1', metadata: {} },
	{ id: 'other-ws', metadata: { channel: 'facebook' } },
];

describe('WS-06 GET /ai-pins/history channel filter', () => {
	it('A. channel=facebook returns only Facebook rows', () => {
		const extraFilter = resolveGenerationHistoryExtraFilter({ channel: 'facebook' });
		assert.equal(extraFilter, 'metadata.channel = "facebook"');
		const matched = applyChannelFilter(MIXED_ROWS, 'facebook');
		assert.deepEqual(matched.map((row) => row.id), ['fb-1', 'other-ws']);
		assert.ok(matched.every((row) => row.metadata.channel === 'facebook'));
	});

	it('B. Pinterest rows are excluded from channel=facebook', () => {
		const matched = applyChannelFilter(MIXED_ROWS, 'facebook');
		assert.equal(matched.some((row) => row.metadata.channel === 'pinterest'), false);
		assert.equal(matched.some((row) => row.id === 'pin-1'), false);
		assert.equal(matched.some((row) => row.id === 'legacy-1'), false);
	});

	it('C. channel=pinterest returns only Pinterest rows', () => {
		const extraFilter = resolveGenerationHistoryExtraFilter({ channel: 'pinterest' });
		assert.equal(extraFilter, 'metadata.channel = "pinterest"');
		const matched = applyChannelFilter(MIXED_ROWS, 'pinterest');
		assert.deepEqual(matched.map((row) => row.id), ['pin-1']);
		assert.ok(matched.every((row) => row.metadata.channel === 'pinterest'));
	});

	it('D. unknown channel returns 422 VALIDATION_ERROR', () => {
		assert.throws(
			() => parseGenerationHistoryChannel('instagram'),
			(error) => error.status === 422 && error.errorCode === 'VALIDATION_ERROR',
		);
		assert.throws(
			() => resolveGenerationHistoryExtraFilter({ channel: 'twitter' }),
			(error) => error.status === 422 && error.errorCode === 'VALIDATION_ERROR',
		);
	});

	it('E. workspace scope AND channel filter are both applied', () => {
		const ownership = readSrc('services/workspace-ownership.js');
		const route = readSrc('routes/ai-pins.js');
		const history = route.slice(
			route.indexOf("router.get('/history'"),
			route.indexOf("router.delete('/history"),
		);

		assert.match(ownership, /export function andWorkspaceScope/);
		assert.match(ownership, /return `\(\$\{scope\}\) && \(\$\{extra\}\)`/);
		assert.match(ownership, /const filter = andWorkspaceScope\(req, extraFilter\)/);
		assert.match(history, /parseGenerationHistoryChannel\(req\.query\.channel\)/);
		assert.match(history, /buildGenerationHistoryChannelFilter\(channel\)/);
		assert.match(
			history,
			/listWorkspaceResources\('ai_pin_generation_history', req, \{[\s\S]*extraFilter/,
		);
		assert.doesNotMatch(history, /facebook_page|pageId|userId/);

		const combined = andWorkspaceScope(
			'workspace = "ws_1"',
			buildGenerationHistoryChannelFilter('facebook'),
		);
		assert.equal(combined, '(workspace = "ws_1") && (metadata.channel = "facebook")');
		assert.match(combined, /workspace = "ws_1"/);
		assert.match(combined, /metadata\.channel = "facebook"/);
	});

	it('F. no channel parameter preserves existing unfiltered behavior', () => {
		assert.equal(parseGenerationHistoryChannel(undefined), null);
		assert.equal(parseGenerationHistoryChannel(''), null);
		assert.equal(parseGenerationHistoryChannel('   '), null);
		assert.equal(resolveGenerationHistoryExtraFilter({}), '');
		assert.equal(resolveGenerationHistoryExtraFilter({ page: '1' }), '');
		assert.deepEqual(applyChannelFilter(MIXED_ROWS, null).map((row) => row.id), [
			'fb-1',
			'pin-1',
			'legacy-1',
			'other-ws',
		]);

		const history = readSrc('routes/ai-pins.js');
		const handler = history.slice(
			history.indexOf("router.get('/history'"),
			history.indexOf("router.delete('/history"),
		);
		assert.ok(
			handler.indexOf('parseGenerationHistoryChannel') < handler.indexOf('try {'),
			'unknown channel must 422 before the empty-list catch',
		);
		assert.match(handler, /listWorkspaceResources\('ai_pin_generation_history'/);
		assert.doesNotMatch(handler, /collection\('ai_pin_generation_history'\)\.getList/);
	});
});

describe('WS-06 Facebook image/edit history writes', () => {
	it('G. Facebook image history writes metadata.channel=facebook', () => {
		assert.equal(
			resolveGenerationHistoryWriteChannel({ channel: 'facebook' }),
			'facebook',
		);
		assert.equal(
			resolveGenerationHistoryWriteChannel({ exportProfileId: 'facebook_post' }),
			'facebook',
		);

		const queue = readSrc('services/ai-pin-image-queue.js');
		const imageWrite = queue.slice(
			queue.indexOf("event_type: 'image'"),
			queue.indexOf('ai_credits_used: 0'),
		);
		assert.match(imageWrite, /resolveGenerationHistoryWriteChannel/);
		assert.match(imageWrite, /channel: promptPayload\.channel/);
		assert.match(imageWrite, /exportProfileId: promptPayload\.exportProfileId/);
	});

	it('H. Facebook edit history writes metadata.channel=facebook', () => {
		const route = readSrc('routes/ai-pins.js');
		const editorWrite = route.slice(
			route.indexOf("event_type: 'edit'"),
			route.indexOf('ai_credits_used: 0'),
		);
		assert.match(editorWrite, /channel: normalizeStudioPromptChannel\(req\.body\?\.channel\)/);
		assert.equal(resolveGenerationHistoryWriteChannel({ channel: 'facebook' }), 'facebook');
	});
});
