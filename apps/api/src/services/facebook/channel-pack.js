/**
 * Facebook Channel Pack — foundation registry (F2).
 *
 * OAuth + Hub + Admin credentials live. No publish / queue workers.
 * See docs/facebook-channel-pack-schema.md
 */

/** @type {'F2'} */
export const FACEBOOK_CHANNEL_PACK_PHASE = 'F2';

/** Plan / product feature catalog key (must match AI_FACEBOOK_PAGES_PRODUCT.featureFlag). */
export const FACEBOOK_FEATURE_KEY = 'facebook';

/** Unified Calendar channel id + job SoT collection. */
export const FACEBOOK_CALENDAR_CHANNEL = 'facebook';
export const FACEBOOK_JOB_COLLECTION = 'facebook_publish_jobs';

/**
 * Approved PocketBase collections for the Facebook channel pack.
 */
export const FACEBOOK_COLLECTIONS = Object.freeze([
	'facebook_accounts',
	'facebook_account_secrets',
	'facebook_pages',
	'facebook_oauth_states',
	'facebook_publish_jobs',
	'facebook_publish_events',
	'facebook_publish_history',
	'facebook_app_credentials',
]);

/** Collections that must never be exposed to the PocketBase JS SDK / client. */
export const FACEBOOK_SECRET_COLLECTIONS = Object.freeze([
	'facebook_account_secrets',
	'facebook_oauth_states',
	'facebook_app_credentials',
]);

/**
 * Channel pack capabilities (product surface), distinct from workspace RBAC strings.
 */
export const FACEBOOK_CHANNEL_CAPABILITIES = Object.freeze({
	connect: true,
	listAccounts: true,
	listPages: true,
	publishNow: true,
	queueImplemented: true,
	schedule: false, // F5
	calendarProject: true,
	calendarMutate: true,
	insights: false, // F7
	publishingHistory: false, // F7
});

/** Workspace RBAC capability strings for Facebook (registered in workspace-rbac.js). */
export const FACEBOOK_WORKSPACE_CAPABILITIES = Object.freeze([
	'workspace.facebook.manage',
	'workspace.facebook.publish',
]);

export function getFacebookChannelPackDto() {
	return {
		phase: FACEBOOK_CHANNEL_PACK_PHASE,
		featureKey: FACEBOOK_FEATURE_KEY,
		calendarChannel: FACEBOOK_CALENDAR_CHANNEL,
		jobCollection: FACEBOOK_JOB_COLLECTION,
		collections: [...FACEBOOK_COLLECTIONS],
		secretCollections: [...FACEBOOK_SECRET_COLLECTIONS],
		channelCapabilities: { ...FACEBOOK_CHANNEL_CAPABILITIES },
		workspaceCapabilities: [...FACEBOOK_WORKSPACE_CAPABILITIES],
		oauthImplemented: true,
		graphImplemented: true,
		publishImplemented: true,
		queueImplemented: true,
	};
}

export function isFacebookCollection(name) {
	return FACEBOOK_COLLECTIONS.includes(String(name || '').trim());
}
