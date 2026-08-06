/**
 * Single entry for Content Studio asset resolution (F6-2 prompts + F6-3 export profiles).
 */

import { getExportProfile } from '@/lib/pinExportProfiles';
import { resolveChannelPromptPack } from '@/lib/studio/promptPacks';
import {
	resolveAspectRatiosForProduct,
	resolveDefaultAspectRatioIdForProduct,
	resolveDefaultExportProfileId,
	resolveExportProfileIdForAspect,
	resolveExportProfilesForProduct,
	resolvePreviewAspectClass,
} from '@/lib/studio/exportProfilePack';
import { resolveTemplatePack } from '@/lib/studio/templatePacks';

/**
 * Resolve studio assets for a product + workspace config.
 *
 * @param {object} product
 * @param {object|null|undefined} config
 */
export function resolveStudioAssets(product, config = {}) {
	const channel = product?.destinationId === 'facebook' ? 'facebook' : 'pinterest';
	const aspectRatios = resolveAspectRatiosForProduct(product);
	const defaultExportProfileId = resolveDefaultExportProfileId(product);
	const defaultAspectRatioId = resolveDefaultAspectRatioIdForProduct(product, config);

	return {
		channel,
		promptPack: resolveChannelPromptPack(config, channel),
		templatePack: resolveTemplatePack(product),
		aspectRatios,
		exportProfiles: resolveExportProfilesForProduct(product),
		defaultExportProfileId,
		defaultAspectRatioId,
		resolveExportProfile(profileId) {
			return getExportProfile(profileId || defaultExportProfileId);
		},
		resolveExportProfileIdForAspect(aspectRatioId) {
			return resolveExportProfileIdForAspect(product, aspectRatioId);
		},
		resolvePreviewAspectClass(aspectRatioId) {
			return resolvePreviewAspectClass(product, aspectRatioId);
		},
	};
}
