/**
 * Server-side template configuration validation (size + shape guards).
 * Does not migrate or mutate documents — reject unsafe / oversized payloads.
 */

import { LAYER_TYPES } from '../constants/pin-engine.js';
import { isPrivateHostname } from '../utils/ssrf-guard.js';

const MAX_JSON_CHARS = 1_500_000;
const MAX_LAYERS = 200;
const MAX_STRING = 8_000;
const MAX_URL = 2_000;

function assertSafeUrl(value, field, issues) {
	const raw = String(value || '').trim();
	if (!raw) return;
	if (raw.length > MAX_URL) {
		issues.push({ field, reason: 'url_too_long' });
		return;
	}
	if (raw.startsWith('data:') || raw.startsWith('blob:') || raw.includes('{{')) return;
	try {
		const parsed = new URL(raw);
		if (!['http:', 'https:'].includes(parsed.protocol)) {
			issues.push({ field, reason: 'url_protocol', value: parsed.protocol });
		} else if (isPrivateHostname(parsed.hostname)) {
			issues.push({ field, reason: 'url_private_host', value: parsed.hostname });
		}
	} catch {
		issues.push({ field, reason: 'url_invalid' });
	}
}

function sanitizePlainText(value, max = 200) {
	return String(value || '')
		.replace(/[<>]/g, '')
		.trim()
		.slice(0, max);
}

/**
 * @param {unknown} configuration
 * @returns {{ ok: boolean, issues: object[], configuration: object|null }}
 */
export function validateTemplateConfiguration(configuration) {
	const issues = [];
	if (configuration == null) {
		return { ok: true, issues: [], configuration: {} };
	}
	if (typeof configuration !== 'object' || Array.isArray(configuration)) {
		return { ok: false, issues: [{ field: 'configuration', reason: 'must_be_object' }], configuration: null };
	}

	let serialized = '';
	try {
		serialized = JSON.stringify(configuration);
	} catch {
		return { ok: false, issues: [{ field: 'configuration', reason: 'not_serializable' }], configuration: null };
	}
	if (serialized.length > MAX_JSON_CHARS) {
		issues.push({ field: 'configuration', reason: 'payload_too_large', max: MAX_JSON_CHARS });
	}

	const layers = Array.isArray(configuration.layers) ? configuration.layers : null;
	if (layers) {
		if (layers.length > MAX_LAYERS) {
			issues.push({ field: 'layers', reason: 'too_many_layers', max: MAX_LAYERS });
		}
		layers.forEach((layer, index) => {
			if (!layer || typeof layer !== 'object') {
				issues.push({ field: `layers[${index}]`, reason: 'invalid_layer' });
				return;
			}
			if (layer.type && !LAYER_TYPES.includes(layer.type)) {
				issues.push({ field: `layers[${index}].type`, reason: 'unknown_layer_type', value: layer.type });
			}
			const props = layer.props && typeof layer.props === 'object' ? layer.props : {};
			['src', 'imageSrc', 'url', 'logoSrc'].forEach((key) => {
				if (props[key]) assertSafeUrl(props[key], `layers[${index}].props.${key}`, issues);
			});
			if (typeof props.text === 'string' && props.text.length > MAX_STRING) {
				issues.push({ field: `layers[${index}].props.text`, reason: 'text_too_long' });
			}
		});
	}

	const canvas = configuration.canvas;
	if (canvas && typeof canvas === 'object') {
		const w = Number(canvas.width);
		const h = Number(canvas.height);
		if (Number.isFinite(w) && (w < 64 || w > 8000)) {
			issues.push({ field: 'canvas.width', reason: 'out_of_range' });
		}
		if (Number.isFinite(h) && (h < 64 || h > 12000)) {
			issues.push({ field: 'canvas.height', reason: 'out_of_range' });
		}
	}

	const errors = issues.filter((i) => i.severity !== 'warning');
	return {
		ok: errors.length === 0,
		issues,
		configuration: errors.length === 0 ? configuration : null,
	};
}

export function sanitizeTemplateName(name) {
	const cleaned = sanitizePlainText(name, 120);
	return cleaned || 'Untitled template';
}

export function sanitizeMarketplaceMeta(meta) {
	if (!meta || typeof meta !== 'object') return null;
	const tags = Array.isArray(meta.tags)
		? meta.tags.map((t) => sanitizePlainText(t, 40)).filter(Boolean).slice(0, 24)
		: [];
	return {
		...meta,
		tags,
		description: meta.description != null ? sanitizePlainText(meta.description, 500) : meta.description,
	};
}
