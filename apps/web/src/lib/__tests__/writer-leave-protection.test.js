import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	captureGenerationSnapshot,
	isArticleContentDirty,
	isDirtyAfterSuccessfulSave,
	resolveGenerationEditorRestore,
	shouldClearDirtyAfterPublish,
	shouldWarnOnLeave,
} from '../writer-leave-protection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const writerPagePath = path.resolve(here, '../../pages/app/WriterPage.jsx');

describe('High Priority #1 — Writer leave protection during AI generation', () => {
	it('editing an article marks it dirty', () => {
		expect(isArticleContentDirty({
			article: { seo_title: 'A' },
			currentFingerprint: 'fp-edited',
			savedFingerprint: 'fp-saved',
		})).toBe(true);

		expect(isArticleContentDirty({
			article: { seo_title: 'A' },
			currentFingerprint: 'fp-saved',
			savedFingerprint: 'fp-saved',
		})).toBe(false);

		expect(isArticleContentDirty({
			article: { seo_title: 'New' },
			currentFingerprint: 'fp-new',
			savedFingerprint: null,
		})).toBe(true);
	});

	it('starting AI generation keeps dirty protection active (even if article cleared)', () => {
		expect(shouldWarnOnLeave({
			articleDirty: false,
			generating: true,
			genPhase: 'writing',
			stream: '',
		})).toBe(true);

		// Simulated mid-generation: article null ⇒ articleDirty false, but generating true.
		expect(shouldWarnOnLeave({
			articleDirty: isArticleContentDirty({ article: null }),
			generating: true,
			genPhase: 'connecting',
			stream: 'partial…',
		})).toBe(true);
	});

	it('browser refresh / internal navigation warn while generating or dirty', () => {
		expect(shouldWarnOnLeave({ articleDirty: true, generating: false })).toBe(true);
		expect(shouldWarnOnLeave({ articleDirty: false, generating: true })).toBe(true);
		expect(shouldWarnOnLeave({ articleDirty: false, generating: false, genPhase: 'idle' })).toBe(false);
	});

	it('Save Draft clears dirty state', () => {
		expect(isDirtyAfterSuccessfulSave({
			article: { id: '1' },
			currentFingerprint: 'same',
			savedFingerprint: 'same',
		})).toBe(false);
	});

	it('Publish clears dirty state only after success', () => {
		expect(shouldClearDirtyAfterPublish({ persistSucceeded: false })).toBe(false);
		expect(shouldClearDirtyAfterPublish({ persistSucceeded: true })).toBe(true);
	});

	it('failed or cancelled generation keeps leave protection when stream remains', () => {
		expect(shouldWarnOnLeave({
			articleDirty: false,
			generating: false,
			genPhase: 'failed',
			stream: 'partial tokens',
		})).toBe(true);
		expect(shouldWarnOnLeave({
			articleDirty: false,
			generating: false,
			genPhase: 'cancelled',
			stream: 'partial tokens',
		})).toBe(true);
		expect(shouldWarnOnLeave({
			articleDirty: false,
			generating: false,
			genPhase: 'failed',
			stream: '',
		})).toBe(false);
	});

	it('restores prior article snapshot on failed/cancelled generation', () => {
		const snapshot = captureGenerationSnapshot({
			article: { seo_title: 'Prior draft' },
			articleBaseline: { seo_title: 'Prior draft' },
			savedFingerprint: 'fp-1',
		});
		expect(snapshot.article.seo_title).toBe('Prior draft');

		expect(resolveGenerationEditorRestore({ outcome: 'success', snapshot }).restore).toBe(false);
		const failed = resolveGenerationEditorRestore({ outcome: 'failed', snapshot });
		expect(failed.restore).toBe(true);
		expect(failed.snapshot.article.seo_title).toBe('Prior draft');

		const cancelled = resolveGenerationEditorRestore({ outcome: 'cancelled', snapshot });
		expect(cancelled.restore).toBe(true);
	});

	it('WriterPage wires leave protection through generating and restores on failure', () => {
		const src = readFileSync(writerPagePath, 'utf8');
		expect(src).toContain("from '@/lib/writer-leave-protection'");
		expect(src).toContain('shouldWarnOnLeave');
		expect(src).toContain('captureGenerationSnapshot');
		expect(src).toContain('resolveGenerationEditorRestore');
		expect(src).toMatch(/shouldWarnOnLeave\([\s\S]*generating/);
		// Must not keep the old early-false when article is null without generation guards.
		expect(src).not.toMatch(/const isDirty = useMemo\(\(\) => \{\s*if \(!article\) return false;/);
	});
});
