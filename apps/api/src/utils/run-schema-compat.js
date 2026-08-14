/**
 * Run startup schema compatibility ensures from the registry.
 * Migrations remain authoritative; this only gap-fills older PocketBase volumes.
 */
import logger from './logger.js';
import { listStartupSchemaCompatEntries } from './schema-compat-registry.js';

const ensureLoaders = {
	ensureUsersPrivilegedRules: () => import('./ensure-users-privileged-rules.js'),
	ensureFacebookOAuthSchema: () => import('./ensure-facebook-oauth-schema.js'),
	ensureAuthenticationProvidersSchema: () => import('./ensure-authentication-providers-schema.js'),
	ensureWordpressIntegrationSchema: () => import('./ensure-wordpress-integration-schema.js'),
	ensureArticleLifecycleSchema: () => import('./ensure-article-lifecycle-schema.js'),
	ensureCreditsEngineSchema: () => import('./ensure-credits-engine-schema.js'),
	ensureBillingAutomationSchema: () => import('./ensure-billing-automation-schema.js'),
	ensureWorkspaceEnterpriseSchema: () => import('./ensure-workspace-enterprise-schema.js'),
	ensureWorkspaceOwnershipSchema: () => import('./ensure-workspace-ownership-schema.js'),
	ensureWebsiteLifecycleSchema: () => import('./ensure-website-lifecycle-schema.js'),
	ensureNotificationTemplatesSchema: () => import('./ensure-notification-templates-schema.js'),
};

/**
 * Fire-and-forget startup compat (preserves previous main.js soft-warn behavior).
 * @param {object} pocketbaseClient
 * @param {{ entries?: object[] }} [options]
 */
export function runStartupSchemaCompat(pocketbaseClient, options = {}) {
	const entries = options.entries || listStartupSchemaCompatEntries();
	for (const entry of entries) {
		const loader = ensureLoaders[entry.ensureExport];
		if (!loader) {
			logger.warn('schema compat: missing loader', { id: entry.id, ensureExport: entry.ensureExport });
			continue;
		}
		loader()
			.then((mod) => {
				const fn = mod?.[entry.ensureExport];
				if (typeof fn !== 'function') {
					logger.warn('schema compat: export missing', { id: entry.id, ensureExport: entry.ensureExport });
					return null;
				}
				return fn(pocketbaseClient);
			})
			.then(() => {
				logger.info('schema compat ensure completed', {
					id: entry.id,
					migrations: entry.migrationIds,
					mode: 'compat',
				});
			})
			.catch((error) => {
				logger.warn(`schema compat ensure skipped (${entry.id})`, {
					message: error?.message || String(error),
					migrations: entry.migrationIds,
				});
			});
	}
	return { scheduled: entries.length };
}

/**
 * Await all startup ensures (for tests / controlled boot). Soft-fail per entry.
 */
export async function runStartupSchemaCompatAwait(pocketbaseClient, options = {}) {
	const entries = options.entries || listStartupSchemaCompatEntries();
	const results = [];
	for (const entry of entries) {
		const loader = ensureLoaders[entry.ensureExport];
		if (!loader) {
			results.push({ id: entry.id, ok: false, reason: 'missing_loader' });
			continue;
		}
		try {
			const mod = await loader();
			const fn = mod?.[entry.ensureExport];
			if (typeof fn !== 'function') {
				results.push({ id: entry.id, ok: false, reason: 'missing_export' });
				continue;
			}
			await fn(pocketbaseClient);
			results.push({ id: entry.id, ok: true, migrations: entry.migrationIds });
		} catch (error) {
			results.push({
				id: entry.id,
				ok: false,
				reason: error?.message || String(error),
				migrations: entry.migrationIds,
			});
		}
	}
	return results;
}
