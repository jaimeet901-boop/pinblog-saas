import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildArticlePersistPayload,
	resolveArticlePersistRequest,
	resolvePersistedArticleId,
	simulateWriterPersistSequence,
} from '../writer-article-persist.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const writerPagePath = path.resolve(here, '../../pages/app/WriterPage.jsx');

describe('Critical #3 — Writer publish respects savedArticleId', () => {
	it('new article → creates one article (POST)', () => {
		const request = resolveArticlePersistRequest(null);
		expect(request).toEqual({
			method: 'POST',
			path: '/content/articles',
			createsNew: true,
			articleId: null,
		});

		const sim = simulateWriterPersistSequence(['publish']);
		expect(sim.createCount).toBe(1);
		expect(sim.updateCount).toBe(0);
		expect(sim.articleIds).toEqual(['art-1']);
	});

	it('Save Draft → updates same article after first create', () => {
		const first = resolveArticlePersistRequest(null);
		expect(first.createsNew).toBe(true);

		const afterSave = resolveArticlePersistRequest('art-saved');
		expect(afterSave).toEqual({
			method: 'PATCH',
			path: '/content/articles/art-saved',
			createsNew: false,
			articleId: 'art-saved',
		});

		const sim = simulateWriterPersistSequence(['save', 'save', 'save']);
		expect(sim.createCount).toBe(1);
		expect(sim.updateCount).toBe(2);
		expect(new Set(sim.articleIds).size).toBe(1);
		expect(sim.finalSavedArticleId).toBe('art-1');
	});

	it('Publish after Save Draft → updates existing article (never duplicates)', () => {
		const sim = simulateWriterPersistSequence(['save', 'publish']);
		expect(sim.createCount).toBe(1);
		expect(sim.updateCount).toBe(1);
		expect(sim.articleIds).toEqual(['art-1', 'art-1']);
		expect(sim.finalSavedArticleId).toBe('art-1');

		const publishRequest = resolveArticlePersistRequest('draft-99');
		expect(publishRequest.method).toBe('PATCH');
		expect(publishRequest.path).toBe('/content/articles/draft-99');
		expect(publishRequest.createsNew).toBe(false);
	});

	it('multiple publishes never create duplicates', () => {
		const sim = simulateWriterPersistSequence(['publish', 'publish', 'publish', 'save']);
		expect(sim.createCount).toBe(1);
		expect(sim.updateCount).toBe(3);
		expect(sim.articleIds.every((id) => id === 'art-1')).toBe(true);
	});

	it('existing scheduling still uses update when draft already saved', () => {
		const sim = simulateWriterPersistSequence(['save', 'schedule']);
		expect(sim.createCount).toBe(1);
		expect(sim.updateCount).toBe(1);
		expect(sim.finalSavedArticleId).toBe('art-1');

		const schedulePayload = buildArticlePersistPayload({
			form: { keyword: 'pasta', language: 'en', country: 'US', tone: 'friendly' },
			article: { seo_title: 'Pasta', meta_description: 'm', slug: 'pasta' },
			persistBody: { sections: [] },
			status: 'scheduled',
			scheduledAt: '2030-01-01T12:00:00.000Z',
		});
		expect(schedulePayload.status).toBe('scheduled');
		expect(schedulePayload.scheduled_at).toBe('2030-01-01T12:00:00.000Z');

		const scheduleRequest = resolveArticlePersistRequest('art-1');
		expect(scheduleRequest.createsNew).toBe(false);
	});

	it('resolvePersistedArticleId keeps existing id and adopts created id', () => {
		expect(resolvePersistedArticleId('keep-me', { id: 'other' })).toBe('keep-me');
		expect(resolvePersistedArticleId(null, { id: 'created-1' })).toBe('created-1');
		expect(resolvePersistedArticleId('', {})).toBe(null);
	});

	it('whitespace-only savedArticleId is treated as missing (creates new)', () => {
		expect(resolveArticlePersistRequest('   ').createsNew).toBe(true);
		expect(resolveArticlePersistRequest('  id-1  ').path).toBe('/content/articles/id-1');
	});

	it('WriterPage publishToWp uses shared persist helper (no always-POST)', () => {
		const src = readFileSync(writerPagePath, 'utf8');
		expect(src).toContain("from '@/lib/writer-article-persist'");
		expect(src).toMatch(/const publishToWp[\s\S]*resolveArticlePersistRequest\(savedArticleId\)/);
		expect(src).toMatch(/const save = async[\s\S]*resolveArticlePersistRequest\(savedArticleId\)/);
		const publishBlock = src.slice(src.indexOf('const publishToWp'), src.indexOf('const openScheduleModal'));
		expect(publishBlock).toContain('resolveArticlePersistRequest(savedArticleId)');
		expect(publishBlock).not.toMatch(/fetch\('\/content\/articles',\s*\{\s*method:\s*'POST'/);
	});
});
