/**
 * Reserved extension slots — future features plug in without rewriting the editor.
 * Smart Guides | Snap | AI Auto Layout | Brand Kits | Animation | Video Timeline
 */

export const EDITOR_EXTENSION_IDS = Object.freeze([
	'smartGuides',
	'snap',
	'aiAutoLayout',
	'brandKits',
	'animation',
	'videoTimeline',
]);

export function createEditorExtensionsState() {
	return {
		smartGuides: { enabled: false, thresholdPx: 4 },
		snap: { enabled: false, gridSize: 8 },
		aiAutoLayout: { enabled: false, profile: null },
		brandKits: { enabled: false, brandKitId: null },
		animation: { enabled: false, timeline: null },
		videoTimeline: { enabled: false, durationMs: 0 },
	};
}

/**
 * No-op hooks future modules can replace via registerEditorExtension.
 * @type {Map<string, object>}
 */
const extensionHandlers = new Map();

export function registerEditorExtension(id, handlers) {
	if (!EDITOR_EXTENSION_IDS.includes(id)) {
		throw new Error(`Unknown editor extension: ${id}`);
	}
	extensionHandlers.set(id, handlers || {});
}

export function getEditorExtension(id) {
	return extensionHandlers.get(id) || null;
}

/**
 * Called after a command applies — extensions may annotate UI overlays (not mutate doc).
 */
export function notifyExtensionsAfterCommand(context) {
	for (const handlers of extensionHandlers.values()) {
		if (typeof handlers.onAfterCommand === 'function') {
			handlers.onAfterCommand(context);
		}
	}
}
