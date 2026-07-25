/**
 * Optional document migrators. Never forced on pin generate.
 * PocketBase-independent.
 */

import {
	DOCUMENT_SCHEMA_VERSION,
	DOCUMENT_SCHEMA_VERSION_LAYERS,
	EDITOR_VERSION_LAYERS,
	EDITOR_VERSION_PROCEDURAL,
} from './pinEngineConstants.js';
import {
	createEmptyLayerDocument,
	createLayerId,
	isV2Document,
	normalizeEditorDocument,
} from './pinLayerSchema.js';

/**
 * Build a best-effort v2 document from a v1 procedural config.
 * For editor "Convert" flows only — never auto-save over v1.
 * @param {object} v1Config
 * @param {object} [options]
 */
export function migrateV1ProceduralToV2(v1Config, options = {}) {
	const width = Number(v1Config?.canvas?.width) || 1000;
	const height = Number(v1Config?.canvas?.height) || 1500;
	const doc = createEmptyLayerDocument({
		width,
		height,
		category: options.category || 'general',
	});

	const bgColor = String(v1Config?.background?.color || '#111111');
	const margin = Number(v1Config?.layout?.safeMargin) || 88;
	const titleColor = String(v1Config?.typography?.textColor || '#FFFFFF');
	const fontFamily = String(v1Config?.typography?.fontFamily || 'Georgia, serif');
	const fontSize = Number(v1Config?.typography?.fontSize) || 72;

	doc.layers = [
		{
			id: createLayerId(),
			type: 'background',
			name: 'Background',
			x: 0,
			y: 0,
			width,
			height,
			zIndex: 0,
			props: { color: bgColor, imageSrc: '' },
		},
		{
			id: createLayerId(),
			type: 'image',
			name: 'Featured image',
			x: 0,
			y: 0,
			width,
			height: Math.round(height * 0.72),
			zIndex: 1,
			props: {
				src: '{{image}}',
				fit: 'cover',
				focusX: 0.5,
				focusY: Number(v1Config?.layout?.foodFocusY) || 0.38,
			},
		},
		{
			id: createLayerId(),
			type: 'gradient',
			name: 'Readability gradient',
			x: 0,
			y: Math.round(height * 0.45),
			width,
			height: Math.round(height * 0.55),
			zIndex: 2,
			props: {
				colors: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)'],
				angle: 90,
			},
		},
		{
			id: createLayerId(),
			type: 'text',
			name: 'Title',
			x: margin,
			y: Math.round(height * 0.58),
			width: width - margin * 2,
			height: 220,
			zIndex: 3,
			props: {
				text: '{{title}}',
				fontFamily,
				fontSize,
				fontWeight: Number(v1Config?.typography?.fontWeight) || 800,
				color: titleColor,
				align: String(v1Config?.layout?.textAlign || 'center'),
				lineHeight: Number(v1Config?.typography?.lineHeight) || 1.1,
				maxLines: Number(v1Config?.typography?.maxLines) || 3,
				shadow: v1Config?.typography?.textShadow !== false,
			},
		},
	];

	if (v1Config?.layout?.showCta !== false) {
		doc.layers.push({
			id: createLayerId(),
			type: 'cta',
			name: 'CTA',
			x: Math.round(width * 0.25),
			y: Math.round(height * 0.78),
			width: Math.round(width * 0.5),
			height: 64,
			zIndex: 4,
			props: {
				text: '{{cta}}',
				fill: String(v1Config?.buttonStyle?.background || '#FFFFFF'),
				textColor: String(v1Config?.buttonStyle?.textColor || '#1C1917'),
				padding: 16,
				fontSize: 28,
			},
		});
	}

	return normalizeEditorDocument(doc);
}

/**
 * Future stub — v2 → v3 additive upgrades.
 * @param {object} doc
 */
export function migrateV2toV3(doc) {
	if (!isV2Document(doc) && Number(doc?.schemaVersion) < 2) {
		throw new Error('migrateV2toV3 requires a v2 layer document');
	}
	const normalized = normalizeEditorDocument(doc);
	return {
		document: {
			...normalized,
			schemaVersion: 3,
		},
		from: DOCUMENT_SCHEMA_VERSION_LAYERS,
		to: 3,
		changed: normalized.schemaVersion !== 3,
	};
}

/**
 * Future stub — v3 → v4.
 * @param {object} doc
 */
export function migrateV3toV4(doc) {
	const schemaVersion = Number(doc?.schemaVersion ?? doc?.schema_version);
	if (schemaVersion < 3) {
		throw new Error('migrateV3toV4 requires schemaVersion >= 3');
	}
	return {
		document: {
			...doc,
			schemaVersion: 4,
			editorVersion: doc.editorVersion ?? EDITOR_VERSION_LAYERS,
		},
		from: 3,
		to: 4,
		changed: schemaVersion !== 4,
	};
}

/**
 * @param {object} doc
 * @param {{ targetSchemaVersion: number, category?: string }} options
 */
export function migrateDocument(doc, options = {}) {
	const target = Number(options.targetSchemaVersion);
	if (!Number.isFinite(target)) {
		throw new Error('targetSchemaVersion is required');
	}

	let current = doc;
	let from = Number(current?.schemaVersion ?? current?.schema_version);
	if (!Number.isFinite(from)) {
		from = isV2Document(current) ? DOCUMENT_SCHEMA_VERSION_LAYERS : DOCUMENT_SCHEMA_VERSION;
	}

	if (from === target) {
		return { document: isV2Document(current) ? normalizeEditorDocument(current) : current, from, to: target, changed: false };
	}

	if (from === 1 && target >= 2) {
		current = migrateV1ProceduralToV2(current, options);
		from = DOCUMENT_SCHEMA_VERSION_LAYERS;
	}
	if (from === 2 && target >= 3) {
		current = migrateV2toV3(current).document;
		from = 3;
	}
	if (from === 3 && target >= 4) {
		current = migrateV3toV4(current).document;
		from = 4;
	}

	if (from !== target) {
		throw new Error(`Cannot migrate schemaVersion ${from} → ${target}`);
	}

	return {
		document: isV2Document(current) ? normalizeEditorDocument(current) : current,
		from: Number(doc?.schemaVersion ?? DOCUMENT_SCHEMA_VERSION),
		to: target,
		changed: true,
	};
}

export function describeDocumentKind(doc) {
	if (isV2Document(doc)) {
		return {
			kind: 'layers',
			editorVersion: EDITOR_VERSION_LAYERS,
			schemaVersion: Number(doc.schemaVersion) || DOCUMENT_SCHEMA_VERSION_LAYERS,
		};
	}
	return {
		kind: 'procedural',
		editorVersion: EDITOR_VERSION_PROCEDURAL,
		schemaVersion: DOCUMENT_SCHEMA_VERSION,
	};
}
