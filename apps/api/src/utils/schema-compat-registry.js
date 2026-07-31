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
		id: 'wordpress-integration',
		ensureModule: 'ensure-wordpress-integration-schema.js',
		ensureExport: 'ensureWordpressIntegrationSchema',
		migrationIds: [
			'1783989000_wordpress_integration_foundation',
			'1783995250_wordpress_sites_sync_claim_fields',
		],
		mode: 'startup',
		concern: 'WordPress sites sync + claim fields',
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
		migrationIds: ['1783991000_credits_engine', '1783962000_plans_credits'],
		mode: 'startup',
		concern: 'plans/credits wallet + reservations',
	}),
	Object.freeze({
		id: 'billing-automation',
		ensureModule: 'ensure-billing-automation-schema.js',
		ensureExport: 'ensureBillingAutomationSchema',
		migrationIds: ['1783992000_billing_automation'],
		mode: 'startup',
		concern: 'billing automation + idempotency',
	}),
	Object.freeze({
		id: 'workspace-enterprise',
		ensureModule: 'ensure-workspace-enterprise-schema.js',
		ensureExport: 'ensureWorkspaceEnterpriseSchema',
		migrationIds: ['1783993000_workspace_enterprise'],
		mode: 'startup',
		concern: 'workspace_members + workspace_roles',
	}),
	Object.freeze({
		id: 'workspace-ownership',
		ensureModule: 'ensure-workspace-ownership-schema.js',
		ensureExport: 'ensureWorkspaceOwnershipSchema',
		migrationIds: ['1783994000_workspace_ownership_onboarding'],
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
		migrationIds: ['1783988000_legal_pages'],
		mode: 'lazy',
		concern: 'legal_pages + legal_page_versions',
	}),
	Object.freeze({
		id: 'ai-pins-publish-fields',
		ensureModule: 'ensure-ai-pins-publish-fields.js',
		ensureExport: 'ensureAiPinsPublishFields',
		migrationIds: ['1783986000_ai_pins_source_url'],
		mode: 'lazy',
		concern: 'ai_pins source_url / image_origin',
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
