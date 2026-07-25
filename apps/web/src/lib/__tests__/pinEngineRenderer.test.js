import { describe, expect, it, beforeEach } from 'vitest';
import {
	createEmptyLayerDocument,
	createLayerId,
	getDrawableLayers,
	isV2Document,
	normalizeEditorDocument,
	normalizeLayer,
} from '../pinLayerSchema.js';
import {
	describeDocumentKind,
	migrateDocument,
	migrateV1ProceduralToV2,
} from '../pinLayerMigrate.js';
import {
	applyVariablesToString,
	listRegisteredVariables,
	registerVariable,
	resetVariableRegistryForTests,
	resolveVariables,
	resolveVariablesInDocument,
} from '../pinVariableRegistry.js';
import {
	UnsupportedRenderFormatError,
	getRenderTarget,
	MINIMAL_PNG_BYTES,
} from '../pinRenderTargets.js';
import {
	composeDocument,
	createMockRenderSurface,
	renderDocument,
} from '../pinLayerCompositor.js';
import {
	buildPreviewCacheKey,
	canonicalizeConfiguration,
	createTemplateUuid,
	hashTemplateConfiguration,
	nextRevision,
} from '../pinTemplateIdentity.js';
import { createDefaultTemplateConfig, isV2TemplateConfig, normalizeTemplateConfig } from '../pinTemplates.js';
import { DOCUMENT_SCHEMA_VERSION_LAYERS, EDITOR_VERSION_LAYERS } from '../pinEngineConstants.js';

describe('pinLayerSchema', () => {
	it('detects v2 documents', () => {
		expect(isV2Document({ editorVersion: 2, layers: [] })).toBe(true);
		expect(isV2Document(createDefaultTemplateConfig())).toBe(false);
		expect(isV2Document({ editorVersion: 2 })).toBe(false);
	});

	it('normalizes layers with unique ids and draw order', () => {
		const doc = normalizeEditorDocument({
			editorVersion: 2,
			layers: [
				{ type: 'text', zIndex: 2, props: { text: '{{title}}' } },
				{ id: 'lyr_dup', type: 'shape', zIndex: 1 },
				{ id: 'lyr_dup', type: 'background', zIndex: 0 },
			],
		});
		expect(doc.schemaVersion).toBe(DOCUMENT_SCHEMA_VERSION_LAYERS);
		expect(doc.editorVersion).toBe(EDITOR_VERSION_LAYERS);
		expect(doc.layers).toHaveLength(3);
		const ids = new Set(doc.layers.map((l) => l.id));
		expect(ids.size).toBe(3);
		expect(doc.layers[0].type).toBe('background');
		expect(getDrawableLayers({
			layers: [
				...doc.layers,
				{ ...normalizeLayer({ type: 'text', visible: false }, 9), visible: false },
			],
		})).toHaveLength(3);
	});

	it('createEmptyLayerDocument is a valid v2 doc', () => {
		const doc = createEmptyLayerDocument({ category: 'recipes' });
		expect(isV2Document(doc)).toBe(true);
		expect(doc.category).toBe('recipes');
		expect(createLayerId().startsWith('lyr_')).toBe(true);
	});
});

describe('pinLayerMigrate', () => {
	it('migrates v1 procedural to v2 without mutating detection of original', () => {
		const v1 = createDefaultTemplateConfig();
		const v2 = migrateV1ProceduralToV2(v1, { category: 'desserts' });
		expect(isV2Document(v1)).toBe(false);
		expect(isV2Document(v2)).toBe(true);
		expect(v2.layers.some((l) => l.type === 'text')).toBe(true);
		expect(describeDocumentKind(v1).kind).toBe('procedural');
		expect(describeDocumentKind(v2).kind).toBe('layers');
	});

	it('migrateDocument 1→2 is optional and idempotent at target', () => {
		const result = migrateDocument(createDefaultTemplateConfig(), { targetSchemaVersion: 2 });
		expect(result.changed).toBe(true);
		expect(result.to).toBe(2);
		const again = migrateDocument(result.document, { targetSchemaVersion: 2 });
		expect(again.changed).toBe(false);
	});
});

describe('pinVariableRegistry', () => {
	beforeEach(() => {
		resetVariableRegistryForTests();
	});

	it('resolves built-in tokens', () => {
		const map = resolveVariables({ title: 'Hello', imageUrl: 'https://img.test/a.png' });
		expect(map['{{title}}']).toBe('Hello');
		expect(map['{{image}}']).toBe('https://img.test/a.png');
		expect(listRegisteredVariables()).toContain('{{cta}}');
	});

	it('supports registerVariable extension without compositor changes', () => {
		registerVariable({
			token: '{{custom_spice}}',
			resolve: (ctx) => String(ctx.spice || ''),
		});
		expect(applyVariablesToString('Use {{custom_spice}}', { spice: 'cumin' })).toBe('Use cumin');
	});

	it('resolves tokens inside documents', () => {
		const doc = resolveVariablesInDocument({
			editorVersion: 2,
			layers: [{ type: 'text', props: { text: '{{title}}' } }],
		}, { title: 'Pasta' });
		expect(doc.layers[0].props.text).toBe('Pasta');
	});
});

describe('pinRenderTargets', () => {
	it('encodes PNG from mock surface', async () => {
		const target = getRenderTarget('png');
		const surface = createMockRenderSurface(10, 10);
		const bytes = await target.encode(surface);
		expect(bytes[0]).toBe(0x89);
		expect(bytes[1]).toBe(0x50);
		expect(bytes.byteLength).toBe(MINIMAL_PNG_BYTES.byteLength);
	});

	it('stubs unsupported formats', async () => {
		await expect(getRenderTarget('webp').encode({})).rejects.toBeInstanceOf(UnsupportedRenderFormatError);
		await expect(getRenderTarget('pdf').encode({})).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
	});
});

describe('pinLayerCompositor', () => {
	it('composes visible layers and skips hidden', async () => {
		const doc = normalizeEditorDocument({
			editorVersion: 2,
			layers: [
				{ type: 'background', zIndex: 0, props: { color: '#112233' } },
				{ type: 'text', zIndex: 1, visible: false, props: { text: 'Hidden' } },
				{ type: 'text', zIndex: 2, props: { text: '{{title}}' } },
				{ type: 'shape', zIndex: 3, props: { shape: 'rect', fill: '#fff' } },
				{ type: 'divider', zIndex: 4 },
				{ type: 'gradient', zIndex: 5, props: { colors: ['#0000', '#000'] } },
				{ type: 'cta', zIndex: 6, props: { text: '{{cta}}' } },
			],
		});
		const resolved = resolveVariablesInDocument(doc, { title: 'Cake', cta: 'Get Recipe' });
		const surface = createMockRenderSurface(doc.canvas.width, doc.canvas.height);
		await composeDocument(resolved, surface);
		expect(surface.ops.some((op) => op.op === 'fillText' && op.text === 'Cake')).toBe(true);
		expect(surface.ops.some((op) => op.op === 'fillText' && op.text === 'Hidden')).toBe(false);
		expect(surface.ops.some((op) => op.op === 'fillText' && op.text === 'Get Recipe')).toBe(true);
	});

	it('renderDocument returns PNG bytes via mock surface', async () => {
		const raw = createEmptyLayerDocument();
		raw.layers = [
			{ type: 'background', width: 1000, height: 1500, props: { color: '#000' } },
			{ type: 'text', x: 40, y: 100, width: 900, height: 120, props: { text: '{{title}}' } },
		];
		const result = await renderDocument(raw, {
			variables: { title: 'Test Pin' },
			createSurface: createMockRenderSurface,
		});
		expect(result.mimeType).toBe('image/png');
		expect(result.format).toBe('png');
		expect(result.bytes[0]).toBe(0x89);
		expect(result.document.layers[1].props.text).toBe('Test Pin');
	});

	it('rejects non-v2 documents', async () => {
		await expect(renderDocument(createDefaultTemplateConfig(), {
			createSurface: createMockRenderSurface,
		})).rejects.toThrow(/v2 layer document/);
	});
});

describe('pinTemplateIdentity', () => {
	it('creates uuid and stable checksums', async () => {
		const a = createTemplateUuid();
		const b = createTemplateUuid();
		expect(a).not.toBe(b);
		expect(a).toMatch(/^[0-9a-f-]{36}$/i);

		const cfg = { b: 2, a: 1 };
		expect(canonicalizeConfiguration(cfg)).toBe(canonicalizeConfiguration({ a: 1, b: 2 }));
		const hash = await hashTemplateConfiguration(cfg);
		expect(hash).toHaveLength(64);
		expect(await hashTemplateConfiguration({ a: 1, b: 2 })).toBe(hash);
		expect(await hashTemplateConfiguration({ a: 1, b: 3 })).not.toBe(hash);

		expect(nextRevision(undefined)).toBe(1);
		expect(nextRevision(3)).toBe(4);
		expect(buildPreviewCacheKey({
			templateId: 't1',
			configChecksum: hash,
			format: 'PNG',
		})).toBe(`t1:${hash}:png`);
	});
});

describe('v1 compatibility passthrough', () => {
	it('normalizeTemplateConfig leaves v1 shape intact and does not invent layers', () => {
		const v1 = normalizeTemplateConfig(createDefaultTemplateConfig());
		expect(v1.layers).toBeUndefined();
		expect(v1.canvas.width).toBe(1000);
		expect(isV2TemplateConfig(v1)).toBe(false);
	});

	it('normalizeTemplateConfig does not strip v2 layers', () => {
		const v2 = createEmptyLayerDocument();
		v2.layers = [{ type: 'text', props: { text: 'Keep me' } }];
		const out = normalizeTemplateConfig(v2);
		expect(out.layers).toHaveLength(1);
		expect(isV2TemplateConfig(out)).toBe(true);
	});
});
