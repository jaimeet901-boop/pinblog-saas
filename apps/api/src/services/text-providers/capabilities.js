/**
 * Canonical provider capability schema for the Universal AI Runtime.
 */

import { PROVIDER_CATALOG } from '../ai-provider-catalog.js';

/**
 * @typedef {{
 *   text: boolean,
 *   image: boolean,
 *   streaming: boolean,
 *   vision: boolean,
 *   embeddings: boolean,
 *   functionCalling: boolean,
 *   maxTokens: number,
 *   supportedModels: string[],
 * }} ProviderCapabilities
 */

/** @type {Record<string, Partial<ProviderCapabilities> & { flags?: string[] }>} */
export const PROVIDER_CAPABILITY_DEFAULTS = {
	openai: {
		text: true,
		image: true,
		streaming: true,
		vision: true,
		embeddings: true,
		functionCalling: true,
		maxTokens: 128000,
	},
	gemini: {
		text: true,
		image: true,
		streaming: true,
		vision: true,
		embeddings: false,
		functionCalling: true,
		maxTokens: 1048576,
	},
	claude: {
		text: true,
		image: false,
		streaming: true,
		vision: true,
		embeddings: false,
		functionCalling: true,
		maxTokens: 200000,
	},
	openrouter: {
		text: true,
		image: false,
		streaming: true,
		vision: true,
		embeddings: false,
		functionCalling: true,
		maxTokens: 128000,
	},
	deepseek: {
		text: true,
		image: false,
		streaming: true,
		vision: false,
		embeddings: false,
		functionCalling: true,
		maxTokens: 64000,
	},
	replicate: {
		text: true,
		image: true,
		streaming: false,
		vision: false,
		embeddings: false,
		functionCalling: false,
		maxTokens: 8192,
	},
	ollama: {
		text: true,
		image: false,
		streaming: true,
		vision: false,
		embeddings: true,
		functionCalling: false,
		maxTokens: 32768,
	},
	huggingface: {
		text: true,
		image: false,
		streaming: false,
		vision: false,
		embeddings: true,
		functionCalling: false,
		maxTokens: 8192,
	},
	mistral: {
		text: true,
		image: false,
		streaming: true,
		vision: false,
		embeddings: true,
		functionCalling: true,
		maxTokens: 128000,
	},
	grok: {
		text: true,
		image: false,
		streaming: true,
		vision: false,
		embeddings: false,
		functionCalling: true,
		maxTokens: 128000,
	},
	fal: {
		text: false,
		image: true,
		streaming: false,
		vision: false,
		embeddings: false,
		functionCalling: false,
		maxTokens: 0,
	},
	flux: {
		text: false,
		image: true,
		streaming: false,
		vision: false,
		embeddings: false,
		functionCalling: false,
		maxTokens: 0,
	},
};

const REQUEST_TYPE_TO_CAPABILITY = {
	text: 'text',
	generate: 'text',
	stream: 'streaming',
	streaming: 'streaming',
	image: 'image',
	vision: 'vision',
	embeddings: 'embeddings',
	embedding: 'embeddings',
	function: 'functionCalling',
	'function-calling': 'functionCalling',
	tools: 'functionCalling',
};

/**
 * @param {string} code
 * @param {Partial<ProviderCapabilities>|string[]|object|null} [override]
 * @returns {ProviderCapabilities}
 */
export function normalizeProviderCapabilities(code, override = null) {
	const normalized = String(code || '').trim().toLowerCase();
	const catalog = PROVIDER_CATALOG.find((item) => item.code === normalized);
	const defaults = PROVIDER_CAPABILITY_DEFAULTS[normalized] || {
		text: true,
		image: false,
		streaming: false,
		vision: false,
		embeddings: false,
		functionCalling: false,
		maxTokens: 8192,
	};

	/** @type {Partial<ProviderCapabilities>} */
	let fromOverride = {};
	if (Array.isArray(override)) {
		const set = new Set(override.map((item) => String(item || '').toLowerCase()));
		fromOverride = {
			text: set.has('text'),
			image: set.has('image'),
			streaming: set.has('stream') || set.has('streaming'),
			vision: set.has('vision'),
			embeddings: set.has('embeddings') || set.has('embedding'),
			functionCalling: set.has('function') || set.has('functioncalling') || set.has('tools'),
		};
	} else if (override && typeof override === 'object') {
		fromOverride = override;
	}

	const supportedModels = Array.isArray(fromOverride.supportedModels) && fromOverride.supportedModels.length > 0
		? fromOverride.supportedModels.map(String)
		: Array.isArray(catalog?.models)
			? catalog.models.map(String)
			: [];

	return {
		text: Boolean(fromOverride.text ?? defaults.text),
		image: Boolean(fromOverride.image ?? defaults.image),
		streaming: Boolean(fromOverride.streaming ?? defaults.streaming),
		vision: Boolean(fromOverride.vision ?? defaults.vision),
		embeddings: Boolean(fromOverride.embeddings ?? defaults.embeddings),
		functionCalling: Boolean(fromOverride.functionCalling ?? defaults.functionCalling),
		maxTokens: Number(fromOverride.maxTokens) > 0
			? Number(fromOverride.maxTokens)
			: Number(defaults.maxTokens) || 8192,
		supportedModels,
	};
}

export function capabilitiesToFlags(capabilities) {
	const caps = capabilities || {};
	/** @type {string[]} */
	const flags = [];
	if (caps.text) flags.push('text');
	if (caps.image) flags.push('image');
	if (caps.streaming) flags.push('streaming');
	if (caps.vision) flags.push('vision');
	if (caps.embeddings) flags.push('embeddings');
	if (caps.functionCalling) flags.push('functionCalling');
	return flags;
}

export function mapRequestTypeToCapabilityKey(requestType) {
	const key = String(requestType || 'text').trim().toLowerCase();
	return REQUEST_TYPE_TO_CAPABILITY[key] || 'text';
}

/**
 * @param {ProviderCapabilities} capabilities
 * @param {string} requestType
 */
export function providerSupportsRequestType(capabilities, requestType) {
	const capKey = mapRequestTypeToCapabilityKey(requestType);
	if (capKey === 'text') return Boolean(capabilities?.text);
	if (capKey === 'streaming') return Boolean(capabilities?.streaming || capabilities?.text);
	return Boolean(capabilities?.[capKey]);
}
