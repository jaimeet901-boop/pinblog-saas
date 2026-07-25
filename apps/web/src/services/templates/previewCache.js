/**
 * Client preview cache — keyed by templateId + config_checksum + format.
 * Never invalidate by timestamp alone.
 */

import { buildPreviewCacheKey } from '@/lib/pinTemplateIdentity';

const DEFAULT_LIMIT = 200;
const memory = new Map();

function touch(key, entry) {
	memory.delete(key);
	memory.set(key, { ...entry, touchedAt: Date.now() });
	while (memory.size > DEFAULT_LIMIT) {
		const oldest = memory.keys().next().value;
		memory.delete(oldest);
	}
}

/**
 * @param {{ templateId: string, configChecksum: string, format?: string }} keyParts
 */
export function getCachedPreview(keyParts) {
	const key = buildPreviewCacheKey(keyParts);
	const hit = memory.get(key);
	if (!hit) return null;
	touch(key, hit);
	return hit;
}

/**
 * @param {{ templateId: string, configChecksum: string, format?: string, imageUrl: string, source?: string }} entry
 */
export function setCachedPreview(entry) {
	if (!entry?.configChecksum || !entry?.imageUrl) return null;
	const key = buildPreviewCacheKey(entry);
	touch(key, {
		imageUrl: entry.imageUrl,
		source: entry.source || 'memory',
		configChecksum: entry.configChecksum,
		templateId: entry.templateId,
		format: entry.format || 'png',
	});
	return key;
}

export function clearPreviewCache() {
	memory.clear();
}

export function previewCacheSize() {
	return memory.size;
}

/**
 * Resolve card thumbnail: memory → provided previewUrl if checksum matches → thumbnail fallback.
 * Does NOT regenerate pixels.
 */
export function resolveGalleryThumbnail(template) {
	const checksum = template.configChecksum || '';
	if (checksum) {
		const cached = getCachedPreview({
			templateId: template.id,
			configChecksum: checksum,
			format: 'png',
		});
		if (cached?.imageUrl) return { url: cached.imageUrl, fromCache: true };
	}

	if (template.previewCached && template.previewUrl) {
		if (checksum) {
			setCachedPreview({
				templateId: template.id,
				configChecksum: checksum,
				imageUrl: template.previewUrl,
				source: 'server',
			});
		}
		return { url: template.previewUrl, fromCache: true };
	}

	return {
		url: template.previewUrl || template.thumbnail || '',
		fromCache: false,
	};
}
