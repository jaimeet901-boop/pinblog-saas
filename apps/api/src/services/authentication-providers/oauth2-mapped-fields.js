/**
 * Safe PocketBase users.oauth2.mappedFields for login IdPs.
 *
 * NEVER map provider id → record primary key `id`. Google subject IDs are long
 * numeric strings that fail PocketBase id validation → "Failed to create record."
 */

export const AUTH_OAUTH2_MAPPED_FIELDS = Object.freeze({
	id: '',
	name: 'name',
	username: 'username',
	avatarURL: 'avatar',
});

/**
 * Normalize / repair mappedFields from a prior bad config.
 * @param {object} [existing]
 */
export function normalizeAuthOAuth2MappedFields(existing = {}) {
	const current = existing && typeof existing === 'object' ? existing : {};
	const next = {
		...AUTH_OAUTH2_MAPPED_FIELDS,
		...current,
		// Force-clear primary-key mapping even if previously saved as "id".
		id: '',
	};

	if (!next.name) next.name = AUTH_OAUTH2_MAPPED_FIELDS.name;
	if (next.avatarURL === 'avatarURL') next.avatarURL = AUTH_OAUTH2_MAPPED_FIELDS.avatarURL;

	return next;
}
