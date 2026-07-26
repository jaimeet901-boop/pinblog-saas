/**
 * PreviewService — build a publish preview model (no React).
 * Design Library hook point: openDesignLibraryChooser opens the read-only gallery chooser.
 */

import {
	formatImageSourceLabel,
	resolvePinDestinationUrl,
	validatePinForPinterestPublish,
} from '@/lib/pinPublishDestination.js';

/**
 * Design Library / Template Gallery integration seam.
 * Callers open PinTemplateChooser when available === true.
 */
export function openDesignLibraryChooser({ onSelect } = {}) {
	return {
		available: true,
		message: '',
		onSelect: typeof onSelect === 'function' ? onSelect : null,
	};
}

/**
 * Build preview DTO for a pin before publish.
 */
export function buildPinPreview({
	pin,
	account,
	board,
	websiteUrl = '',
	article,
}) {
	const destinationUrl = resolvePinDestinationUrl(pin, article, websiteUrl);

	return {
		id: pin?.id || pin?.tempId || '',
		imageUrl: pin?.imageUrl || '',
		title: pin?.title || 'Untitled pin',
		description: pin?.description || '',
		overlayText: pin?.overlayText || '',
		boardId: board?.boardId || pin?.boardId || '',
		boardName: board?.name || pin?.boardName || 'No board selected',
		accountId: account?.id || pin?.accountId || '',
		accountLabel: account?.label || account?.accountName || account?.username || pin?.accountLabel || 'No account',
		websiteUrl: destinationUrl,
		destinationUrl,
		articleUrl: destinationUrl,
		sourceUrl: destinationUrl,
		imageSource: pin?.imageSource || '',
		imageOrigin: pin?.imageOrigin || '',
		imageSourceLabel: formatImageSourceLabel(pin),
		templateName: pin?.templateName || '',
		status: pin?.status || 'draft',
		scheduledAt: pin?.scheduledAt || '',
	};
}

export function validatePreviewReady(preview) {
	const base = validatePinForPinterestPublish({
		title: preview?.title,
		imageUrl: preview?.imageUrl,
		sourceUrl: preview?.destinationUrl || preview?.websiteUrl || preview?.sourceUrl,
		boardId: preview?.boardId,
		accountId: preview?.accountId,
	}, { requireBoard: true, requireAccount: true });

	return {
		ok: base.ok,
		errors: base.errors,
		destinationUrl: base.destinationUrl,
	};
}
