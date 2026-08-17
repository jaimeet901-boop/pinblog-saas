/**
 * AI-CROSS-02 Phase 1 — web studio channel wiring (source contracts).
 * Run: node --test src/services/ai-pins/aiPinsLibraryChannel.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, '../..');

function readWeb(relativePath) {
	return readFileSync(path.join(webSrc, relativePath), 'utf8');
}

describe('AI-CROSS-02 web studio channel', () => {
	it('ContentStudioPage sends existing studioChannel on list/save/duplicate/mutate', () => {
		const page = readWeb('pages/app/ContentStudioPage.jsx');
		assert.match(page, /const studioChannel = product\.destinationId === 'facebook' \? 'facebook' : 'pinterest'/);
		assert.match(page, /\/ai-pins\/pins\?websiteId=\$\{encodeURIComponent\(websiteId\)\}&channel=\$\{encodeURIComponent\(studioChannel\)\}/);
		assert.match(page, /saveDrafts\(\{\s*previewPins,\s*panel,\s*channel: studioChannel,/);
		assert.match(page, /duplicatePin\(pin, \{ channel: studioChannel \}\)/);
		assert.match(page, /deleteDraftPin\(pinId, \{ channel: studioChannel \}\)/);
		assert.match(page, /ensurePinsSourceUrl\(list\.map\(\(pin\) => pin\.id\), \{ channel: studioChannel \}\)/);
		assert.match(page, /\/ai-pins\/pins\/\$\{encodeURIComponent\(pin\.id\)\}\?channel=\$\{encodeURIComponent\(studioChannel\)\}/);
		assert.match(page, /channel: studioChannel/);
		assert.doesNotMatch(page, /user-facing channel selector/i);
		assert.doesNotMatch(page, /<Select[^>]*channel/);
	});

	it('draftService sends channel as a request-level value and not item.channel', () => {
		const src = readWeb('services/ai-pins/draftService.js');
		assert.match(src, /export async function saveDrafts\(\{ previewPins, panel, channel, duplicateFromPinId \}/);
		assert.match(src, /\.\.\.\(channel \? \{ channel \} : \{\}\)/);
		assert.match(src, /duplicateFromPinId/);
		assert.match(src, /withStudioChannelQuery/);
		assert.match(src, /\/ai-pins\/pins\/\$\{encodeURIComponent\(pin\.id\)\}/);
		assert.match(src, /\/ai-pins\/pins\/\$\{readyPin\.id\}\/editor/);
		assert.doesNotMatch(src, /payload\.channel\s*=/);
		assert.doesNotMatch(src, /items: payloads\.map/);
	});

	it('does not change shared Articles, Brand Kit, Reference Images, or Templates APIs', () => {
		const page = readWeb('pages/app/ContentStudioPage.jsx');
		assert.match(page, /\/ai-pins\/articles/);
		assert.match(page, /brandKits/);
		assert.match(page, /reference-images|Reference Images|referenceImages/);
		assert.match(page, /PinTemplateChooser|templates/);
		assert.doesNotMatch(page, /\/ai-pins\/articles\?.*channel=/);
	});
});
