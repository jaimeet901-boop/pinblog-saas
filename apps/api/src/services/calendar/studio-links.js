/**
 * Shared Studio deep-link helpers for Calendar Scheduled Items.
 * Calendar stays channel-agnostic — these are opaque deepLinks values only.
 */

/**
 * Build a Content Studio URL that opens a specific ai_pins record.
 * @param {{ pinId?: string, websiteId?: string, studioPath?: string }} [options]
 */
export function buildStudioPinHref(options = {}) {
	const pinId = String(options.pinId || '').trim();
	const websiteId = String(options.websiteId || '').trim();
	const studioPath = String(options.studioPath || '/app/ai-pins').trim() || '/app/ai-pins';
	const params = new URLSearchParams();
	if (websiteId) params.set('websiteId', websiteId);
	if (pinId) params.set('pinId', pinId);
	const query = params.toString();
	return query ? `${studioPath}?${query}` : studioPath;
}

/**
 * Opaque Studio deepLinks payload for Scheduled Items.
 */
export function buildStudioDeepLinks(pin = {}, extras = {}) {
	const pinId = String(
		pin.id
		|| extras.studioItemId
		|| extras.studioPinId
		|| '',
	).trim();
	const websiteId = String(
		pin.websiteId
		|| pin.website_id
		|| extras.websiteId
		|| '',
	).trim();
	const studioPath = String(extras.studioPath || '/app/ai-pins').trim() || '/app/ai-pins';

	return {
		studioPinId: pinId,
		studioItemId: pinId,
		studioHref: pinId ? buildStudioPinHref({ pinId, websiteId, studioPath }) : '',
		studioPath,
		destinationUrl: pin.source_url || pin.sourceUrl || pin.destination_url || extras.destinationUrl || '',
		createdAt: pin.created || pin.createdAt || extras.createdAt || '',
		description: pin.description || extras.description || '',
		overlayText: pin.overlay_text || pin.overlayText || extras.overlayText || '',
		...extras,
	};
}
