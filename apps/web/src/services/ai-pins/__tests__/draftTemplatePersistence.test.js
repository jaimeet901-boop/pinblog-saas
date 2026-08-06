import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildPocketbaseClientMock,
	mockFetchSequence,
	mockJsonResponse,
} from '@/test-utils/mockApiFetch.js';

vi.mock('@/lib/apiServerClient', () => ({
	default: {
		fetch: vi.fn(),
	},
}));

vi.mock('@/lib/pocketbaseClient', async () => {
	const { buildPocketbaseClientMock } = await import('@/test-utils/mockApiFetch.js');
	const { vi: vitestVi } = await import('vitest');
	return buildPocketbaseClientMock(vitestVi);
});

import apiServerClient from '@/lib/apiServerClient';
import pb from '@/lib/pocketbaseClient';
import {
	duplicatePin,
	mapSavedPin,
	saveDrafts,
	updateDraftPin,
} from '../draftService.js';
import {
	ORIGINAL_TEMPLATE_UNAVAILABLE,
	buildTemplateSnapshotFields,
	formatTemplateVersionSnapshot,
	hasTemplateSnapshot,
	mapTemplateSnapshotFromRecord,
	toTemplateEditorPatch,
	toTemplateSnapshotPayload,
} from '../templateSnapshot.js';

const SAMPLE_CONFIG = {
	schemaVersion: 2,
	editorVersion: 2,
	layers: [{ id: 'title', type: 'text', text: 'Hello' }],
};

function previewPin(overrides = {}) {
	return {
		tempId: 'tmp_1',
		articleId: 'art_1',
		websiteId: 'web_1',
		title: 'Pin with template',
		description: 'Desc',
		overlayText: 'CTA',
		imagePrompt: 'prompt',
		imageUrl: 'https://cdn.example/pins/a.png',
		imageSource: 'ai_generated',
		sourceUrl: 'https://blog.example/recipes/sample-post',
		articleUrl: 'https://blog.example/recipes/sample-post',
		imageGenerationStatus: 'completed',
		templateId: 'tpl_1',
		templateName: 'Gallery Hero',
		templateVersion: '2.1.4@7c2f9ab',
		templateConfig: SAMPLE_CONFIG,
		templateThumbnail: 'https://cdn.example/thumbs/hero.png',
		templateSnapshotAt: '2026-07-26T08:00:00.000Z',
		suggestedKeywords: ['a'],
		suggestedHashtags: ['b'],
		...overrides,
	};
}

describe('template snapshot helpers', () => {
	it('formats template_version as revision@checksum', () => {
		expect(formatTemplateVersionSnapshot({
			editorVersion: 1,
			schemaVersion: 4,
			revision: 2,
			configChecksum: '7c2f9ab',
		})).toBe('1.4.2@7c2f9ab');
	});

	it('builds payload fields for save without clearing empty legacy pins', () => {
		expect(toTemplateSnapshotPayload({})).toEqual({});
		expect(hasTemplateSnapshot({})).toBe(false);

		const payload = toTemplateSnapshotPayload(previewPin());
		expect(payload.template_id).toBe('tpl_1');
		expect(payload.template_name).toBe('Gallery Hero');
		expect(payload.template_version).toBe('2.1.4@7c2f9ab');
		expect(payload.template_configuration).toEqual(SAMPLE_CONFIG);
		expect(payload.template_thumbnail).toBe('https://cdn.example/thumbs/hero.png');
		expect(payload.template_snapshot_at).toBe('2026-07-26T08:00:00.000Z');
	});

	it('PATCH omit leaves template metadata out (API must not clear)', () => {
		expect(toTemplateEditorPatch({})).toEqual({});
		const patch = toTemplateEditorPatch(previewPin());
		expect(patch.templateId).toBe('tpl_1');
		expect(patch.clearTemplate).toBeUndefined();
	});
});

describe('draft template persistence integration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		pb.authStore.record = { id: 'user_1' };
		pb.__mocks.create.mockReset();
		pb.__mocks.getOne.mockReset();
		pb.__mocks.update.mockReset();
		apiServerClient.fetch.mockReset();
	});

	it('Save Draft stores template metadata', async () => {
		apiServerClient.fetch.mockResolvedValue(mockJsonResponse({
			ok: true,
			status: 201,
			body: {
				items: [{
					id: 'pin_1',
					articleId: 'art_1',
					websiteId: 'web_1',
					title: 'Pin with template',
					image_url: 'https://cdn.example/pins/a.png',
					source_url: 'https://blog.example/recipes/sample-post',
					status: 'draft',
					template_id: 'tpl_1',
					template_name: 'Gallery Hero',
					template_version: '2.1.4@7c2f9ab',
					template_configuration: SAMPLE_CONFIG,
					template_thumbnail: 'https://cdn.example/thumbs/hero.png',
					template_snapshot_at: '2026-07-26T08:00:00.000Z',
				}],
			},
		}));

		const [saved] = await saveDrafts({
			previewPins: [previewPin()],
			panel: { targetAudience: '', toneOfVoice: '', language: 'en' },
		});

		const createArg = JSON.parse(apiServerClient.fetch.mock.calls[0][1].body).items[0];
		expect(createArg.template_id).toBe('tpl_1');
		expect(createArg.template_configuration).toEqual(SAMPLE_CONFIG);
		expect(createArg.template_version).toBe('2.1.4@7c2f9ab');
		expect(createArg.template_thumbnail).toContain('hero.png');
		expect(saved.templateId).toBe('tpl_1');
		expect(saved.templateConfig).toEqual(SAMPLE_CONFIG);
	});

	it('Reload Draft restores hydrated snapshot without requiring fetch', () => {
		const reloaded = mapSavedPin({
			id: 'pin_1',
			articleId: 'art_1',
			websiteId: 'web_1',
			title: 'Pin with template',
			image_url: 'https://cdn.example/pins/a.png',
			status: 'draft',
			template_id: 'tpl_1',
			template_name: 'Gallery Hero',
			template_version: '2.1.4@7c2f9ab',
			template_configuration: SAMPLE_CONFIG,
			template_thumbnail: 'https://cdn.example/thumbs/hero.png',
			template_snapshot_at: '2026-07-26T08:00:00.000Z',
		});

		expect(reloaded.templateId).toBe('tpl_1');
		expect(reloaded.templateName).toBe('Gallery Hero');
		expect(reloaded.templateVersion).toBe('2.1.4@7c2f9ab');
		expect(reloaded.templateConfig.layers[0].id).toBe('title');
		expect(reloaded.templateThumbnail).toContain('hero.png');
		expect(hasTemplateSnapshot(reloaded)).toBe(true);
	});

	it('Duplicate Draft preserves template metadata', async () => {
		mockFetchSequence(apiServerClient.fetch, [
			{
				ok: true,
				status: 200,
				body: {
					id: 'pin_1',
					articleId: 'art_1',
					websiteId: 'web_1',
					title: 'Pin with template',
					image_url: 'https://cdn.example/pins/a.png',
					image_source: 'ai_generated',
					source_url: 'https://blog.example/recipes/sample-post',
					status: 'draft',
					template_id: 'tpl_1',
					template_name: 'Gallery Hero',
					template_version: '2.1.4@7c2f9ab',
					template_configuration: SAMPLE_CONFIG,
					template_thumbnail: 'https://cdn.example/thumbs/hero.png',
					template_snapshot_at: '2026-07-26T08:00:00.000Z',
				},
			},
			{
				ok: true,
				status: 201,
				body: {
					items: [{
						id: 'pin_copy',
						articleId: 'art_1',
						websiteId: 'web_1',
						title: 'Pin with template (Copy)',
						image_url: 'https://cdn.example/pins/a.png',
						source_url: 'https://blog.example/recipes/sample-post',
						status: 'draft',
						template_id: 'tpl_1',
						template_name: 'Gallery Hero',
						template_version: '2.1.4@7c2f9ab',
						template_configuration: SAMPLE_CONFIG,
						template_thumbnail: 'https://cdn.example/thumbs/hero.png',
						template_snapshot_at: '2026-07-26T08:00:00.000Z',
					}],
				},
			},
		]);

		const copy = await duplicatePin({ id: 'pin_1' });
		const createArg = JSON.parse(apiServerClient.fetch.mock.calls[1][1].body).items[0];
		expect(createArg.template_id).toBe('tpl_1');
		expect(createArg.template_configuration).toEqual(SAMPLE_CONFIG);
		expect(copy.templateId).toBe('tpl_1');
		expect(copy.templateConfig).toEqual(SAMPLE_CONFIG);
	});

	it('Publish Draft path exposes restored templateConfig for compose', () => {
		const draft = mapSavedPin({
			id: 'pin_1',
			title: 'Ready',
			image_url: 'https://cdn.example/pins/a.png',
			status: 'draft',
			template_id: 'tpl_1',
			template_name: 'Gallery Hero',
			template_configuration: SAMPLE_CONFIG,
			template_thumbnail: 'https://cdn.example/thumbs/hero.png',
		});
		// Publishing / recompose reads pin.templateConfig from the restored draft.
		expect(draft.templateConfig).toEqual(SAMPLE_CONFIG);
		expect(buildTemplateSnapshotFields(draft)?.templateConfiguration).toEqual(SAMPLE_CONFIG);
	});

	it('Missing Template: keep snapshot and surface unavailable copy', () => {
		const draft = mapSavedPin({
			id: 'pin_1',
			title: 'Orphan template pin',
			image_url: 'https://cdn.example/pins/a.png',
			status: 'draft',
			template_id: 'tpl_deleted',
			template_name: 'Deleted Hero',
			template_configuration: SAMPLE_CONFIG,
			template_thumbnail: 'https://cdn.example/thumbs/hero.png',
			template_version: '2.1.4@7c2f9ab',
		});
		expect(draft.templateConfig).toEqual(SAMPLE_CONFIG);
		expect(ORIGINAL_TEMPLATE_UNAVAILABLE).toBe('Original template unavailable');
		// Snapshot remains authoritative even if live template is gone.
		expect(hasTemplateSnapshot(draft)).toBe(true);
	});

	it('Existing Drafts created before migration load normally', () => {
		const legacy = mapSavedPin({
			id: 'pin_legacy',
			articleId: 'art_1',
			websiteId: 'web_1',
			title: 'Legacy pin',
			image_url: 'https://cdn.example/pins/legacy.png',
			status: 'draft',
		});
		expect(legacy.templateId).toBe('');
		expect(legacy.templateConfig).toBeNull();
		expect(legacy.title).toBe('Legacy pin');
		expect(toTemplateSnapshotPayload(legacy)).toEqual({});
	});

	it('Edit Draft PATCH includes template fields when present and preserves them', async () => {
		apiServerClient.fetch.mockResolvedValue(mockJsonResponse({
			ok: true,
			body: {
				id: 'pin_1',
				title: 'Edited',
				description: 'Desc',
				overlayText: 'CTA',
				imageUrl: 'https://cdn.example/pins/a.png',
				imagePrompt: 'prompt',
				templateId: 'tpl_1',
				templateName: 'Gallery Hero',
				templateVersion: '2.1.4@7c2f9ab',
				templateConfiguration: SAMPLE_CONFIG,
				templateThumbnail: 'https://cdn.example/thumbs/hero.png',
				templateSnapshotAt: '2026-07-26T08:00:00.000Z',
			},
		}));
		pb.__mocks.update.mockResolvedValue({
			id: 'pin_1',
			title: 'Edited',
			image_url: 'https://cdn.example/pins/a.png',
			template_id: 'tpl_1',
			template_configuration: SAMPLE_CONFIG,
		});

		const updated = await updateDraftPin({
			pin: previewPin({ id: 'pin_1', title: 'Edited' }),
			accounts: [],
			boards: [],
			panel: {},
		});

		const body = JSON.parse(apiServerClient.fetch.mock.calls[0][1].body);
		expect(body.templateId).toBe('tpl_1');
		expect(body.templateConfiguration).toEqual(SAMPLE_CONFIG);
		expect(updated.templateConfig).toEqual(SAMPLE_CONFIG);
	});

	it('Export package preserves template metadata', async () => {
		const { buildPinExportPackage } = await import('../templateSnapshot.js');
		const pack = buildPinExportPackage(previewPin({ id: 'pin_1' }));
		expect(pack.template.id).toBe('tpl_1');
		expect(pack.template.configuration).toEqual(SAMPLE_CONFIG);
		expect(pack.template.version).toBe('2.1.4@7c2f9ab');
		expect(pack.template.thumbnail).toContain('hero.png');
	});
});
