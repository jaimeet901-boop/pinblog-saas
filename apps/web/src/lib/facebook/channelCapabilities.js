/**
 * Facebook channel pack capabilities for web UI (mirrors API channel-pack.js).
 * Keep in sync with apps/api/src/services/facebook/channel-pack.js.
 */

export const FACEBOOK_CHANNEL_CAPABILITIES = Object.freeze({
	connect: true,
	listAccounts: true,
	listPages: true,
	publishNow: true,
	queueImplemented: true,
	schedule: true,
	calendarProject: true,
	calendarMutate: true,
	insights: false,
	publishingHistory: false,
	analytics: false,
});

export function getFacebookChannelCapabilities() {
	return { ...FACEBOOK_CHANNEL_CAPABILITIES };
}
