/**
 * Destination URL helpers for AI Pins → Pinterest publish.
 */

export function normalizeDestinationUrl(value) {
	const raw = String(value || '').trim();
	if (!raw) return '';
	try {
		const parsed = new URL(raw);
		if (!/^https?:$/i.test(parsed.protocol)) return '';
		return parsed.toString();
	} catch {
		return '';
	}
}

export function isValidHttpUrl(value) {
	return Boolean(normalizeDestinationUrl(value));
}

/**
 * Prefer permanent pin source_url, then explicit overrides, then live article URL.
 */
export function resolvePinDestinationUrl(pin = {}, article = null, fallback = '') {
	return normalizeDestinationUrl(
		pin.sourceUrl
		|| pin.source_url
		|| pin.destinationUrl
		|| pin.destination_url
		|| pin.articleUrl
		|| article?.url
		|| fallback,
	);
}

export function formatImageSourceLabel(pin = {}) {
	const origin = String(pin.imageOrigin || pin.image_origin || '').trim().toLowerCase();
	const source = String(pin.imageSource || pin.image_source || '').trim().toLowerCase();

	if (origin === 'ai' || source === 'ai_generated') return 'AI Generated';
	if (origin === 'body' || source === 'body_image' || source === 'body') return 'Body Image';
	if (source === 'featured_fallback' && origin === 'body') return 'Body Image';
	return 'Featured Image';
}

export function normalizeImageOrigin(value, { imageSource = '' } = {}) {
	const raw = String(value || '').trim().toLowerCase();
	if (raw === 'ai' || raw === 'ai_generated') return 'ai';
	if (raw === 'body' || raw === 'body_image') return 'body';
	if (raw === 'featured' || raw === 'featured_image') return 'featured';

	const source = String(imageSource || '').trim().toLowerCase();
	if (source === 'ai_generated') return 'ai';
	if (source === 'body_image' || source === 'body') return 'body';
	return 'featured';
}

/**
 * Validate a pin is ready to publish to Pinterest.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePinForPinterestPublish(pin = {}, { requireBoard = false, requireAccount = false } = {}) {
	const errors = [];
	const title = String(pin.title || '').trim();
	const imageUrl = String(pin.imageUrl || pin.image_url || '').trim();
	const rawDestination = String(
		pin.sourceUrl
		|| pin.source_url
		|| pin.destinationUrl
		|| pin.destination_url
		|| pin.articleUrl
		|| '',
	).trim();
	const destinationUrl = normalizeDestinationUrl(rawDestination);

	if (!title) errors.push('Title is required');
	if (!imageUrl) errors.push('Pin image is required');
	if (!rawDestination) {
		errors.push('Destination URL is required (original article URL)');
	} else if (!destinationUrl) {
		errors.push('Destination URL must be a valid http(s) URL');
	}
	if (requireBoard && !String(pin.boardId || pin.pinterest_board_id || '').trim()) {
		errors.push('Pinterest board is required');
	}
	if (requireAccount && !String(pin.accountId || pin.pinterest_account_id || '').trim()) {
		errors.push('Pinterest account is required');
	}

	return { ok: errors.length === 0, errors, destinationUrl };
}
