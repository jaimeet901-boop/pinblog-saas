/**
 * Apply Phase 3 API-only collection rules to a running PocketBase via superuser API.
 * Use when migrate up cannot run against an encrypted data dir while serve is up.
 *
 * Usage:
 *   node --env-file=apps/api/.env apps/api/src/routes/workspace-isolation-phase3.apply-rules.mjs [PB_URL]
 */
import PocketBase from 'pocketbase';

const pbUrl = process.argv[2] || process.env.PB_AUDIT_URL || process.env.PB_BASE_URL || 'http://127.0.0.1:18111';
const email = process.env.PB_SUPERUSER_EMAIL;
const password = process.env.PB_SUPERUSER_PASSWORD;

const COLLECTIONS = [
	'websites',
	'website_articles',
	'ai_pins',
	'ai_pin_templates',
	'ai_pin_image_jobs',
	'ai_pin_generation_history',
	'brand_kits',
	'pinterest_boards',
	'pinterest_publish_events',
	'pinterest_oauth_states',
	'articles',
	'pins',
	'user_settings',
	'pinterest_accounts',
	'pinterest_publish_jobs',
	'pinterest_account_secrets',
	'_integratedAiMessages',
	'_integratedAiImages',
	'workspaces',
	'workspace_members',
	'workspace_settings',
	'workspace_activity',
	'workspace_notifications',
	'workspace_roles',
	'workspace_onboarding',
	'workspace_audit',
	'calendar_events',
	'templates',
	'wordpress_sites',
	'wordpress_api_logs',
	'wordpress_sync_runs',
	'pinterest_publish_history',
	'publish_jobs',
	'publish_history',
	'queue_jobs',
	'queue_job_events',
	'queue_workers',
	'queue_metrics',
	'ai_pin_reference_images',
	'ai_pin_generation_runs',
	'ai_pin_template_versions',
	'ai_pin_template_assets',
	'ai_pin_template_favorites',
	'ai_pin_template_preview_cache',
	'plans',
	'workspace_subscriptions',
	'credit_transactions',
	'credit_reservations',
	'workspace_usage',
	'billing_events',
	'billing_idempotency',
	'ai_providers',
	'ai_provider_secrets',
	'ai_models',
	'platform_settings',
	'notification_history',
	'notification_templates',
	'audit_logs',
	'system_logs',
	'security_events',
	'api_requests',
	'login_history',
	'system_health',
	'service_status',
	'worker_health',
	'provider_health',
	'health_incidents',
	'analytics_daily',
	'analytics_cache',
	'legal_pages',
	'legal_page_versions',
	'pinterest_app_credentials',
	'article_activity_history',
];

const API_ONLY = {
	listRule: null,
	viewRule: null,
	createRule: null,
	updateRule: null,
	deleteRule: null,
};

async function main() {
	if (!email || !password) {
		console.error('Missing PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD');
		process.exit(2);
	}
	const pb = new PocketBase(pbUrl);
	pb.autoCancellation(false);
	await pb.collection('_superusers').authWithPassword(email, password);

	let updated = 0;
	let already = 0;
	let missing = 0;
	for (const name of COLLECTIONS) {
		let col;
		try {
			col = await pb.collections.getOne(name, { requestKey: null });
		} catch {
			missing += 1;
			continue;
		}
		const isAlready =
			col.listRule == null &&
			col.viewRule == null &&
			col.createRule == null &&
			col.updateRule == null &&
			col.deleteRule == null;
		if (isAlready) {
			already += 1;
			continue;
		}
		await pb.collections.update(col.id, API_ONLY, { requestKey: null });
		updated += 1;
		console.log(`updated ${name}`);
	}

	// Backfill blank visibility (same as migration)
	let templates = [];
	try {
		templates = await pb.collection('ai_pin_templates').getFullList({ requestKey: null });
	} catch {
		templates = [];
	}
	let backfilled = 0;
	for (const row of templates) {
		const vis = String(row.visibility || '').trim();
		if (vis) continue;
		const meta = row.marketplace_meta && typeof row.marketplace_meta === 'object' ? row.marketplace_meta : {};
		const next =
			meta.official === true || String(meta.library || '') === 'chefia-pin-library-v1'
				? 'official'
				: 'private';
		await pb.collection('ai_pin_templates').update(row.id, { visibility: next }, { requestKey: null });
		backfilled += 1;
	}

	console.log(
		JSON.stringify({
			pbUrl,
			updated,
			already,
			missing,
			backfilled,
			totalTargets: COLLECTIONS.length,
		}),
	);
}

main().catch((error) => {
	console.error(error?.message || error);
	process.exit(1);
});
