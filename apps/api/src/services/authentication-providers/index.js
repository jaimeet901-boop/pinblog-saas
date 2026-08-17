export {
	AUTH_PROVIDERS_COLLECTION,
	AUTH_PROVIDER_IDS,
	AUTH_PROVIDER_CATALOG,
	getAuthProviderCatalogEntry,
	isManagedAuthProvider,
	defaultAuthRedirectUri,
} from './catalog.js';

export {
	AUTH_PROVIDER_VERSION,
	AUTH_PROVIDER_STATUS,
	deriveAuthProviderStatus,
	authStatusToPillTone,
} from './status.js';

export {
	listAuthenticationProvidersPublic,
	getAuthenticationProviderPublic,
	getAuthenticationProviderCredentials,
	listEnabledAuthenticationCredentials,
	upsertAuthenticationProvider,
	rotateAuthenticationProviderSecret,
	resetAuthenticationProvider,
	testAuthenticationProviderConnection,
	ensureAuthenticationProvidersSeeded,
} from './credentials.js';

export { applyAuthenticationProvidersToPocketBase } from './apply-to-pocketbase.js';
export { planAuthenticationProvidersApply } from './apply-plan.js';
export { testProviderCredentials } from './test-connection.js';
export {
	AUTH_OAUTH2_MAPPED_FIELDS,
	normalizeAuthOAuth2MappedFields,
} from './oauth2-mapped-fields.js';
