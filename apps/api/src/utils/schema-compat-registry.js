/**
 * Schema compatibility registry — High Priority #4.
 *
 * Authority:
 * - PRIMARY: apps/pocketbase/pb_migrations/*.js (PocketBase applies on boot)
 * - COMPAT:  apps/api/src/utils/ensure-*.js (idempotent gap-fill for older DBs)
 *
 * New schema MUST ship as a migration first. Ensures only mirror additive
 * missing collections/fields/rules — they must not invent schema without a
 * sibling migration ID listed here.
 *
 * See docs/schema-authority.md
 */

/** @typedef {'startup'|'lazy'} SchemaCompatMode */

/**
 * @typedef {object} SchemaCompatEntry
 * @property {string} id
 * @property {string} ensureModule - path relative to apps/api/src/utils/
 * @property {string} ensureExport
 * @property {string[]} migrationIds - pb_migrations file prefixes (without .js)
 * @property {string} [hookPath] - optional pb_hooks relative path
 * @property {SchemaCompatMode} mode
 * @property {string} concern
 */

/** @type {readonly SchemaCompatEntry[]} */
export const SCHEMA_COMPAT_REGISTRY = Object.freeze([
	Object.freeze({
		id: 'users-privileged-rules',
		ensureModule: 'ensure-users-privileged-rules.js',
		ensureExport: 'ensureUsersPrivilegedRules',
		migrationIds: ['1785500000_users_privileged_fields_lockdown'],
		hookPath: 'pb_hooks/users-privileged-fields.pb.js',
		mode: 'startup',
		concern: 'users create/update rules block privilege escalation',
	}),
	Object.freeze({
		id: 'facebook-oauth',
		ensureModule: 'ensure-facebook-oauth-schema.js',
		ensureExport: 'ensureFacebookOAuthSchema',
		migrationIds: [
			'1785400000_facebook_channel_pack',
			'1785401000_facebook_oauth_platform',
			'1785401100_fix_facebook_app_credentials_schema',
			'1785401200_fix_facebook_hub_collections',
		],
		mode: 'startup',
		concern: 'Facebook Hub / OAuth collections',
	}),
	Object.freeze({
		id: 'authentication-providers',
		ensureModule: 'ensure-authentication-providers-schema.js',
		ensureExport: 'ensureAuthenticationProvidersSchema',
		migrationIds: ['1785600000_authentication_providers'],
		hookPath: 'pb_hooks/oauth2-auth.pb.js',
		mode: 'startup',
		concern: 'Login authentication providers (Google first; Apple/Microsoft/GitHub/Discord reserved)',
	}),
	Object.freeze({
		id: 'wordpress-integration',
		ensureModule: 'ensure-wordpress-integration-schema.js',
		ensureExport: 'ensureWordpressIntegrationSchema',
		migrationIds: [
			'1783989000_wordpress_integration_foundation',
			'1783995250_wordpress_sites_sync_claim_fields',
			'1783973000_wordpress_platform',
			'1786600000_repair_husk_collection_schemas',
		],
		mode: 'startup',
		concern: 'WordPress sites sync + claim fields + wordpress_api_logs husk repair',
	}),
	Object.freeze({
		id: 'article-lifecycle',
		ensureModule: 'ensure-article-lifecycle-schema.js',
		ensureExport: 'ensureArticleLifecycleSchema',
		migrationIds: ['1783990000_article_lifecycle'],
		mode: 'startup',
		concern: 'website_articles lifecycle + article_activity_history',
	}),
	Object.freeze({
		id: 'credits-engine',
		ensureModule: 'ensure-credits-engine-schema.js',
		ensureExport: 'ensureCreditsEngineSchema',
		migrationIds: [
			'1783991000_credits_engine',
			'1783962000_plans_credits',
			'1786600000_repair_husk_collection_schemas',
		],
		mode: 'startup',
		concern: 'plans/credits wallet + reservations',
	}),
	Object.freeze({
		id: 'billing-automation',
		ensureModule: 'ensure-billing-automation-schema.js',
		ensureExport: 'ensureBillingAutomationSchema',
		migrationIds: [
			'1783992000_billing_automation',
			'1786600000_repair_husk_collection_schemas',
		],
		mode: 'startup',
		concern: 'billing automation + idempotency',
	}),
	Object.freeze({
		id: 'workspace-enterprise',
		ensureModule: 'ensure-workspace-enterprise-schema.js',
		ensureExport: 'ensureWorkspaceEnterpriseSchema',
		migrationIds: [
			'1783993000_workspace_enterprise',
			'1786600000_repair_husk_collection_schemas',
		],
		mode: 'startup',
		concern: 'workspace_members + workspace_roles',
	}),
	Object.freeze({
		id: 'workspace-ownership',
		ensureModule: 'ensure-workspace-ownership-schema.js',
		ensureExport: 'ensureWorkspaceOwnershipSchema',
		migrationIds: [
			'1783994000_workspace_ownership_onboarding',
			'1786600000_repair_husk_collection_schemas',
		],
		mode: 'startup',
		concern: 'workspace ownership / onboarding / audit',
	}),
	Object.freeze({
		id: 'website-lifecycle',
		ensureModule: 'ensure-website-lifecycle-schema.js',
		ensureExport: 'ensureWebsiteLifecycleSchema',
		migrationIds: ['1785300100_website_lifecycle'],
		mode: 'startup',
		concern: 'websites lifecycle_state / removed_at',
	}),
	Object.freeze({
		id: 'website-articles',
		ensureModule: 'ensure-website-articles-schema.js',
		ensureExport: 'ensureWebsiteArticlesSchema',
		migrationIds: [
			'1737465000_pinblog_schema',
			'1783989000_wordpress_integration_foundation',
			'1783995000_workspace_isolation_api_only_rules',
		],
		mode: 'lazy',
		concern: 'website_articles collection + discovery fields (API-only rules)',
	}),
	Object.freeze({
		id: 'legal-pages',
		ensureModule: 'ensure-legal-pages-schema.js',
		ensureExport: 'ensureLegalPagesSchema',
		migrationIds: [
			'1783988000_legal_pages',
			'1786600000_repair_husk_collection_schemas',
		],
		mode: 'lazy',
		concern: 'legal_pages + legal_page_versions',
	}),
	Object.freeze({
		id: 'notification-templates',
		ensureModule: 'ensure-notification-templates-schema.js',
		ensureExport: 'ensureNotificationTemplatesSchema',
		migrationIds: [
			'1783970000_admin_console',
			'1786600000_repair_husk_collection_schemas',
		],
		mode: 'startup',
		concern: 'notification_templates husk repair',
	}),
	Object.freeze({
		id: 'ai-pins-publish-fields',
		ensureModule: 'ensure-ai-pins-publish-fields.js',
		ensureExport: 'ensureAiPinsPublishFields',
		migrationIds: ['1783986000_ai_pins_source_url', '1786800000_ai_pins_channel'],
		mode: 'lazy',
		concern: 'ai_pins source_url / image_origin / channel',
	}),
]);

export function listStartupSchemaCompatEntries() {
	return SCHEMA_COMPAT_REGISTRY.filter((entry) => entry.mode === 'startup');
}

export function listLazySchemaCompatEntries() {
	return SCHEMA_COMPAT_REGISTRY.filter((entry) => entry.mode === 'lazy');
}

export function listAllEnsureModuleFilenames() {
	return SCHEMA_COMPAT_REGISTRY.map((entry) => entry.ensureModule);
}

/**
 * Resolve migration filename candidates for an entry (with .js).
 */
export function migrationFilenamesForEntry(entry) {
	return (entry?.migrationIds || []).map((id) => `${id}.js`);
}

/** @type {readonly SchemaCompatMode[]} */
export const SCHEMA_COMPAT_MODES = Object.freeze(['startup', 'lazy']);

/**
 * Pure registry governance checks (no I/O). Used by tests and CI guard.
 * @param {readonly SchemaCompatEntry[]} [registry]
 */
export function validateSchemaCompatRegistry(registry = SCHEMA_COMPAT_REGISTRY) {
	const errors = [];
	const ids = new Set();
	const ensureModules = new Set();

	for (const entry of registry) {
		if (!entry?.id) {
			errors.push('registry entry missing id');
			continue;
		}
		if (ids.has(entry.id)) {
			errors.push(`duplicate registry id: ${entry.id}`);
		}
		ids.add(entry.id);

		if (!SCHEMA_COMPAT_MODES.includes(entry.mode)) {
			errors.push(`${entry.id}: invalid mode "${entry.mode}"`);
		}
		if (!entry.ensureModule) {
			errors.push(`${entry.id}: missing ensureModule`);
		} else if (ensureModules.has(entry.ensureModule)) {
			errors.push(`${entry.id}: duplicate ensureModule ${entry.ensureModule}`);
		} else {
			ensureModules.add(entry.ensureModule);
		}
		if (!entry.ensureExport) {
			errors.push(`${entry.id}: missing ensureExport`);
		}
		if (!Array.isArray(entry.migrationIds) || entry.migrationIds.length === 0) {
			errors.push(`${entry.id}: migrationIds must be non-empty`);
		}
	}

	return { ok: errors.length === 0, errors };
}
