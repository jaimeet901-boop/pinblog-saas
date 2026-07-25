/**
 * Watermark pipeline stub — future Brand Kit / marketplace watermarking.
 * Export engine calls applyWatermarkPipeline; default is pass-through.
 */

/** @type {Map<string, Function>} */
const watermarkHooks = new Map();

/**
 * @param {string} id
 * @param {(input: { document: object, settings: object, watermark: object|null, context: object }) => object|Promise<object>} hook
 */
export function registerWatermarkHook(id, hook) {
	const key = String(id || '').trim();
	if (!key) throw new Error('watermark hook id required');
	if (typeof hook !== 'function') throw new Error('watermark hook must be a function');
	watermarkHooks.set(key, hook);
}

export function listWatermarkHooks() {
	return [...watermarkHooks.keys()];
}

/**
 * Apply registered watermark hooks in registration order.
 * Must return a document (normalized or raw layers doc).
 */
export async function applyWatermarkPipeline({
	document,
	settings,
	watermark = null,
	context = {},
}) {
	let current = document;
	if (!watermark && watermarkHooks.size === 0) {
		return current;
	}
	for (const hook of watermarkHooks.values()) {
		current = await hook({
			document: current,
			settings,
			watermark,
			context,
		});
	}
	return current;
}

export function resetWatermarkHooksForTests() {
	watermarkHooks.clear();
}
