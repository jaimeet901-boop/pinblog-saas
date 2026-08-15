const GENERIC_IMAGE_ERROR = 'Image generation is unavailable right now. Please try again later.';
const ARTICLE_IMAGE_FALLBACK = 'Using article image.';
const GENERIC_TEXT_ERROR = 'AI generation is unavailable right now. Please try again later.';

export function userSafeImageError({ status = '', hasError = false } = {}) {
	if (String(status).toLowerCase() === 'fallback') {
		return ARTICLE_IMAGE_FALLBACK;
	}
	return hasError ? GENERIC_IMAGE_ERROR : '';
}

export function userSafeTextError() {
	return GENERIC_TEXT_ERROR;
}

export { ARTICLE_IMAGE_FALLBACK, GENERIC_IMAGE_ERROR, GENERIC_TEXT_ERROR };
