/**
 * Layer factory — creates normalized layer objects for ADD commands.
 */

import { createLayerId, normalizeLayer } from '@/lib/pinLayerSchema';

const PRESETS = {
	background: { type: 'background', name: 'Background', x: 0, y: 0, width: 1000, height: 1500 },
	image: { type: 'image', name: 'Image', x: 80, y: 80, width: 840, height: 840 },
	aiImage: { type: 'aiImage', name: 'AI Image', x: 80, y: 80, width: 840, height: 840 },
	text: { type: 'text', name: 'Text', x: 80, y: 1000, width: 840, height: 200 },
	shape: { type: 'shape', name: 'Shape', x: 200, y: 200, width: 240, height: 240 },
	badge: { type: 'badge', name: 'Badge', x: 100, y: 100, width: 220, height: 64 },
	cta: { type: 'cta', name: 'CTA', x: 250, y: 1200, width: 500, height: 72 },
	sticker: { type: 'sticker', name: 'Sticker', x: 100, y: 100, width: 160, height: 160 },
	logo: { type: 'logo', name: 'Logo', x: 80, y: 1360, width: 160, height: 80 },
	divider: { type: 'divider', name: 'Divider', x: 120, y: 900, width: 760, height: 24 },
	gradient: { type: 'gradient', name: 'Gradient', x: 0, y: 900, width: 1000, height: 600 },
};

/**
 * @param {string} type
 * @param {object} [overrides]
 */
export function createLayer(type = 'text', overrides = {}) {
	const base = PRESETS[type] || PRESETS.text;
	return normalizeLayer({
		...base,
		...overrides,
		id: overrides.id || createLayerId(),
		type: base.type,
		props: {
			...(overrides.props || {}),
		},
	}, 0, new Set());
}

export function listCreatableLayerTypes() {
	return Object.keys(PRESETS);
}
