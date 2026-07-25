/**
 * Layer document schema — normalize, ids, v2 detection.
 * PocketBase-independent. Spec: docs/template-engine-configuration-schema.md
 */

import {
	DOCUMENT_SCHEMA_VERSION_LAYERS,
	EDITOR_VERSION_LAYERS,
	LAYER_TYPES,
	TEMPLATE_CATEGORIES,
	isLayerType,
} from './pinEngineConstants.js';

function clampNumber(value, min, max, fallback) {
	const num = Number(value);
	if (!Number.isFinite(num)) return fallback;
	return Math.max(min, Math.min(max, num));
}

function randomId(prefix) {
	const rand = typeof globalThis.crypto?.randomUUID === 'function'
		? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
		: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
	return `${prefix}_${rand}`;
}

export function createLayerId() {
	return randomId('lyr');
}

export function createGroupId() {
	return randomId('grp');
}

/**
 * @param {unknown} config
 * @returns {boolean}
 */
export function isV2Document(config) {
	if (!config || typeof config !== 'object') return false;
	const editorVersion = Number(config.editorVersion ?? config.editor_version);
	return editorVersion === EDITOR_VERSION_LAYERS && Array.isArray(config.layers);
}

export function createEmptyLayerDocument({
	width = 1000,
	height = 1500,
	category = 'general',
} = {}) {
	return {
		editorVersion: EDITOR_VERSION_LAYERS,
		schemaVersion: DOCUMENT_SCHEMA_VERSION_LAYERS,
		canvas: { width, height },
		category: TEMPLATE_CATEGORIES.includes(category) ? category : 'general',
		meta: {
			brandKitId: null,
			variantGroupId: null,
			autoLayoutProfile: null,
			marketplaceMeta: null,
		},
		groups: [],
		layers: [],
	};
}

function normalizeMeta(meta) {
	const source = meta && typeof meta === 'object' ? meta : {};
	return {
		brandKitId: source.brandKitId ?? source.brand_kit_id ?? null,
		variantGroupId: source.variantGroupId ?? source.variant_group_id ?? null,
		autoLayoutProfile: source.autoLayoutProfile ?? null,
		marketplaceMeta: source.marketplaceMeta ?? null,
	};
}

function normalizeGroup(group, index) {
	const source = group && typeof group === 'object' ? group : {};
	const id = String(source.id || '').trim() || createGroupId();
	const childIds = Array.isArray(source.childIds)
		? source.childIds.map((c) => String(c)).filter(Boolean)
		: Array.isArray(source.child_ids)
			? source.child_ids.map((c) => String(c)).filter(Boolean)
			: [];
	return {
		id,
		name: String(source.name || `Group ${index + 1}`),
		childIds,
		locked: Boolean(source.locked),
		visible: source.visible !== false,
	};
}

function defaultPropsForType(type) {
	switch (type) {
		case 'background':
			return { color: '#111111', imageSrc: '' };
		case 'image':
		case 'aiImage':
			return { src: '{{image}}', fit: 'cover', focusX: 0.5, focusY: 0.38 };
		case 'text':
			return {
				text: '{{title}}',
				fontFamily: 'Georgia, "Times New Roman", serif',
				fontSize: 72,
				fontWeight: 800,
				color: '#FFFFFF',
				align: 'center',
				lineHeight: 1.1,
				maxLines: 4,
				shadow: true,
			};
		case 'shape':
			return { shape: 'rect', fill: '#FFFFFF', stroke: '', strokeWidth: 0 };
		case 'badge':
		case 'cta':
			return {
				text: '{{cta}}',
				fill: '#FFFFFF',
				textColor: '#1C1917',
				padding: 18,
				fontSize: 28,
			};
		case 'sticker':
		case 'logo':
			return { src: '{{logo}}', fit: 'contain' };
		case 'divider':
			return { color: '#FFFFFF', thickness: 2 };
		case 'gradient':
			return { colors: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)'], angle: 90 };
		default:
			return {};
	}
}

function normalizeProps(type, props) {
	const base = defaultPropsForType(type);
	const source = props && typeof props === 'object' ? props : {};
	const merged = { ...base, ...source };

	if (type === 'image' || type === 'aiImage' || type === 'sticker' || type === 'logo') {
		const fit = String(merged.fit || 'cover').toLowerCase();
		merged.fit = ['cover', 'contain', 'fill'].includes(fit) ? fit : 'cover';
		merged.src = String(merged.src || merged.imageSrc || '');
		merged.focusX = clampNumber(merged.focusX, 0, 1, 0.5);
		merged.focusY = clampNumber(merged.focusY, 0, 1, 0.38);
	}
	if (type === 'background') {
		merged.color = String(merged.color || '#111111');
		merged.imageSrc = String(merged.imageSrc || merged.src || '');
	}
	if (type === 'text') {
		merged.text = String(merged.text ?? '');
		merged.fontSize = clampNumber(merged.fontSize, 8, 400, 72);
		merged.fontWeight = clampNumber(merged.fontWeight, 100, 900, 800);
		merged.lineHeight = clampNumber(merged.lineHeight, 0.8, 2.5, 1.1);
		merged.maxLines = clampNumber(merged.maxLines, 1, 20, 4);
		merged.align = ['left', 'center', 'right'].includes(String(merged.align))
			? String(merged.align)
			: 'center';
		merged.shadow = Boolean(merged.shadow);
	}
	if (type === 'shape') {
		const shape = String(merged.shape || 'rect').toLowerCase();
		merged.shape = ['rect', 'ellipse'].includes(shape) ? shape : 'rect';
		merged.strokeWidth = clampNumber(merged.strokeWidth, 0, 64, 0);
	}
	if (type === 'badge' || type === 'cta') {
		merged.text = String(merged.text ?? '');
		merged.padding = clampNumber(merged.padding, 0, 80, 18);
		merged.fontSize = clampNumber(merged.fontSize, 8, 120, 28);
	}
	if (type === 'divider') {
		merged.thickness = clampNumber(merged.thickness, 1, 40, 2);
	}
	if (type === 'gradient') {
		merged.colors = Array.isArray(merged.colors) && merged.colors.length
			? merged.colors.map((c) => String(c))
			: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)'];
		merged.angle = clampNumber(merged.angle, 0, 360, 90);
	}
	return merged;
}

/**
 * @param {object} layer
 * @param {number} index
 * @param {Set<string>} usedIds
 */
export function normalizeLayer(layer, index = 0, usedIds = new Set()) {
	const source = layer && typeof layer === 'object' ? layer : {};
	let type = String(source.type || 'text');
	if (!isLayerType(type)) {
		type = LAYER_TYPES.includes(type) ? type : 'text';
		if (!isLayerType(type)) type = 'text';
	}

	let id = String(source.id || '').trim();
	if (!id || usedIds.has(id)) {
		id = createLayerId();
	}
	usedIds.add(id);

	return {
		id,
		type,
		name: String(source.name || `${type} ${index + 1}`),
		x: clampNumber(source.x, -4000, 8000, 0),
		y: clampNumber(source.y, -4000, 8000, 0),
		width: clampNumber(source.width, 1, 8000, 200),
		height: clampNumber(source.height, 1, 8000, 80),
		rotation: clampNumber(source.rotation, -3600, 3600, 0),
		opacity: clampNumber(source.opacity, 0, 1, 1),
		borderRadius: clampNumber(source.borderRadius, 0, 2000, 0),
		zIndex: clampNumber(source.zIndex ?? index, -100000, 100000, index),
		visible: source.visible !== false,
		locked: Boolean(source.locked),
		groupId: source.groupId != null ? String(source.groupId) : (source.group_id != null ? String(source.group_id) : null),
		props: normalizeProps(type, source.props),
	};
}

/**
 * Normalize a v2 editor document for the compositor.
 * @param {unknown} input
 */
export function normalizeEditorDocument(input) {
	const source = input && typeof input === 'object' ? input : {};
	const usedIds = new Set();
	const layersRaw = Array.isArray(source.layers) ? source.layers : [];
	const layers = layersRaw
		.map((layer, index) => normalizeLayer(layer, index, usedIds))
		.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));

	const category = String(source.category || 'general');
	const schemaVersion = Number(source.schemaVersion ?? source.schema_version);
	return {
		editorVersion: EDITOR_VERSION_LAYERS,
		schemaVersion: Number.isFinite(schemaVersion) && schemaVersion >= 2
			? Math.floor(schemaVersion)
			: DOCUMENT_SCHEMA_VERSION_LAYERS,
		canvas: {
			width: clampNumber(source?.canvas?.width, 400, 4000, 1000),
			height: clampNumber(source?.canvas?.height, 400, 6000, 1500),
		},
		category: TEMPLATE_CATEGORIES.includes(category) ? category : 'general',
		meta: normalizeMeta(source.meta),
		groups: (Array.isArray(source.groups) ? source.groups : []).map(normalizeGroup),
		layers,
	};
}

/**
 * Visible layers only, sorted for draw.
 * @param {{ layers?: object[] }} doc
 */
export function getDrawableLayers(doc) {
	const layers = Array.isArray(doc?.layers) ? doc.layers : [];
	return layers
		.filter((layer) => layer && layer.visible !== false)
		.slice()
		.sort((a, b) => a.zIndex - b.zIndex || String(a.id).localeCompare(String(b.id)));
}
