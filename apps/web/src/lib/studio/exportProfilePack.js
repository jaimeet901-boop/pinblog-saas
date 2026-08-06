/**
 * Product-driven studio export profile pack (F6-3).
 */

import { getExportProfile } from '@/lib/pinExportProfiles';

/** Pinterest aspect presets — unchanged labels/frames; compose maps to export profiles. */
export const PINTEREST_STUDIO_ASPECT_RATIOS = Object.freeze([
	{
		id: 'tall',
		label: 'Tall',
		ratio: '1:2',
		frame: 'tall',
		match: ['1:2'],
		exportProfileId: 'pinterest_standard',
		previewAspectClass: 'aspect-[2/3]',
	},
	{
		id: 'pinterest',
		label: 'Pinterest',
		ratio: '2:3',
		frame: 'pin',
		match: ['2:3', '2/3'],
		exportProfileId: 'pinterest_standard',
		previewAspectClass: 'aspect-[2/3]',
	},
	{
		id: 'classic',
		label: 'Classic',
		ratio: '3:4',
		frame: 'classic',
		match: ['3:4', '3/4'],
		exportProfileId: 'pinterest_standard',
		previewAspectClass: 'aspect-[2/3]',
	},
	{
		id: 'custom',
		label: 'Custom',
		ratio: 'Free',
		frame: 'custom',
		match: [],
		exportProfileId: 'pinterest_standard',
		previewAspectClass: 'aspect-[2/3]',
	},
]);

export const FACEBOOK_STUDIO_ASPECT_RATIOS = Object.freeze([
	{
		id: 'link_post',
		label: 'Link Post',
		ratio: '1.91:1',
		frame: 'landscape',
		match: ['1.91:1', '1200/630'],
		exportProfileId: 'facebook_post',
		previewAspectClass: 'aspect-[1200/630]',
	},
	{
		id: 'story',
		label: 'Story',
		ratio: '9:16',
		frame: 'story',
		match: ['9:16'],
		exportProfileId: 'facebook_story',
		previewAspectClass: 'aspect-[9/16]',
	},
]);

export function resolveAspectRatiosForProduct(product) {
	if (product?.studioAssets?.aspectRatios?.length) {
		return product.studioAssets.aspectRatios;
	}
	return product?.destinationId === 'facebook'
		? FACEBOOK_STUDIO_ASPECT_RATIOS
		: PINTEREST_STUDIO_ASPECT_RATIOS;
}

export function resolveExportProfileIdsForProduct(product) {
	if (Array.isArray(product?.studioAssets?.exportProfileIds) && product.studioAssets.exportProfileIds.length) {
		return product.studioAssets.exportProfileIds;
	}
	return product?.destinationId === 'facebook'
		? ['facebook_post', 'facebook_story']
		: ['pinterest_standard'];
}

export function resolveExportProfilesForProduct(product) {
	return resolveExportProfileIdsForProduct(product).map((id) => getExportProfile(id));
}

export function resolveDefaultExportProfileId(product) {
	return product?.studioAssets?.defaultExportProfileId
		|| (product?.destinationId === 'facebook' ? 'facebook_post' : 'pinterest_standard');
}

export function resolveDefaultAspectRatioIdForProduct(product, config) {
	const aspectRatios = resolveAspectRatiosForProduct(product);
	if (product?.destinationId === 'facebook') {
		return aspectRatios[0]?.id || 'link_post';
	}
	const ratio = String(config?.pinterest?.imageRatio || config?.pinterest?.value?.imageRatio || '').trim();
	const match = aspectRatios.find((item) => (
		Array.isArray(item.match)
		&& item.match.some((token) => ratio === token || ratio.includes(token))
	));
	return match?.id || 'pinterest';
}

export function resolveExportProfileIdForAspect(product, aspectRatioId) {
	const aspectRatios = resolveAspectRatiosForProduct(product);
	const match = aspectRatios.find((item) => item.id === aspectRatioId);
	return match?.exportProfileId || resolveDefaultExportProfileId(product);
}

export function resolvePreviewAspectClass(product, aspectRatioId) {
	const aspectRatios = resolveAspectRatiosForProduct(product);
	const match = aspectRatios.find((item) => item.id === aspectRatioId);
	return match?.previewAspectClass || 'aspect-[2/3]';
}
