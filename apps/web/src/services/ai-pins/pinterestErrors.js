/** Pass-through — show the exact Pinterest failure report as stored. */
export const PINTEREST_TRIAL_ACCESS_UI_MESSAGE =
	'Your Pinterest developer app is still in Trial Access. Production publishing is not yet allowed.';

export function isPinterestTrialAccessError(message) {
	const text = String(message || '').toLowerCase();
	if (!text.includes('trial access')) {
		return false;
	}
	return text.includes('create pin')
		|| text.includes('may not create')
		|| text.includes('production');
}

export function formatPinterestPublishError(message) {
	return message == null ? '' : String(message);
}
