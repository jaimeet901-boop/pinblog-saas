/**
 * Destination URL helpers for Pinterest publish (API).
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

export function resolvePinDestinationUrl(pin = {}, article = null, fallback = '') {
	return normalizeDestinationUrl(
		pin.source_url
		|| pin.sourceUrl
		|| pin.destination_url
		|| pin.destinationUrl
		|| pin.articleUrl
		|| article?.url
		|| fallback,
	);
}

export function validatePinForPinterestPublish(pin = {}, article = null) {
	const errors = [];
	const title = String(pin.title || '').trim();
	const imageUrl = String(pin.image_url || pin.imageUrl || '').trim();
	const rawDestination = String(
		pin.source_url
		|| pin.sourceUrl
		|| pin.destination_url
		|| pin.destinationUrl
		|| pin.articleUrl
		|| article?.url
		|| '',
	).trim();
	const destinationUrl = normalizeDestinationUrl(rawDestination);

	if (!title) errors.push(`Pin "${pin.title || pin.id}" needs a title before publishing`);
	if (!imageUrl) errors.push(`Pin "${pin.title || pin.id}" must have an image URL before publishing`);
	if (!rawDestination) {
		errors.push(`Pin "${pin.title || pin.id}" is missing a destination URL (original article URL)`);
	} else if (!destinationUrl) {
		errors.push(`Pin "${pin.title || pin.id}" has an invalid destination URL`);
	}

	return { ok: errors.length === 0, errors, destinationUrl };
}
