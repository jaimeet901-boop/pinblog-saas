/**
 * Facebook publish error formatting for Studio UI.
 */

export function formatFacebookPublishError(error) {
	const message = String(error?.message || error || '').trim();
	if (!message) return 'Facebook publish failed';
	return message;
}
