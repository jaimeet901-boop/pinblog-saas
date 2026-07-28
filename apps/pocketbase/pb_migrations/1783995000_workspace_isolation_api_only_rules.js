/// <reference path="../pb_data/types.d.ts" />
/**
 * Phase 3 — PocketBase Security Hardening
 *
 * Force API-only rules (null list/view/create/update/delete) on every
 * application collection that holds tenant or platform data.
 *
 * Direct PocketBase SDK clients (even authenticated) cannot read or write
 * tenant rows. The Express API (superuser/admin client) remains the only
 * supported access layer.
 *
 * Intentionally NOT modified:
 * - users (auth collection — password / verify / profile flows)
 * - _superusers / other system collections
 *
 * Idempotent and safe to re-run on existing production databases.
 */

function findCollectionSafe(app, name) {
	try {
		return app.findCollectionByNameOrId(name);
	} catch (_) {
		return null;
	}
}

function isApiOnly(collection) {
	return (
		collection.listRule == null &&
		collection.viewRule == null &&
		collection.createRule == null &&
		collection.updateRule == null &&
		collection.deleteRule == null
	);
}

function applyApiOnlyRules(app, name) {
	const collection = findCollectionSafe(app, name);
	if (!collection) return { name, status: "missing" };
	if (isApiOnly(collection)) return { name, status: "already" };

	collection.listRule = null;
	collection.viewRule = null;
	collection.createRule = null;
	collection.updateRule = null;
	collection.deleteRule = null;
	app.save(collection);
	return { name, status: "updated" };
}

function collectionHasIndexMarker(collection, marker) {
	const indexes = Array.isArray(collection?.indexes) ? collection.indexes : [];
	return indexes.some((sql) => String(sql).includes(marker));
}

function ensureIndexIdempotent(collection, sql) {
	const indexes = Array.isArray(collection.indexes) ? collection.indexes.slice() : [];
	if (indexes.includes(sql)) return false;
	const marker = String(sql).match(/`(idx_[^`]+)`/);
	if (marker && indexes.some((existing) => String(existing).includes(marker[1]))) {
		return false;
	}
	indexes.push(sql);
	collection.indexes = indexes;
	return true;
}

/** Collections that previously allowed owner-scoped or auth-scoped client access. */
const LEGACY_CLIENT_RULE_COLLECTIONS = [
	"websites",
	"website_articles",
	"ai_pins",
	"ai_pin_templates",
	"ai_pin_image_jobs",
	"ai_pin_generation_history",
	"brand_kits",
	"pinterest_boards",
	"pinterest_publish_events",
	"pinterest_oauth_states",
	"articles",
	"pins",
	"user_settings",
	"pinterest_accounts",
	"pinterest_publish_jobs",
];

/**
 * Broader application surface — ensure API-only even if a collection was
 * already created with null rules (idempotent harden).
 */
const PLATFORM_AND_TENANT_COLLECTIONS = [
	// Secrets / integrated AI
	"pinterest_account_secrets",
	"_integratedAiMessages",
	"_integratedAiImages",
	// Tenancy
	"workspaces",
	"workspace_members",
	"workspace_settings",
	"workspace_activity",
	"workspace_notifications",
	"workspace_roles",
	"workspace_onboarding",
	"workspace_audit",
	"calendar_events",
	"templates",
	// Content / publishing
	"wordpress_sites",
	"wordpress_api_logs",
	"wordpress_sync_runs",
	"pinterest_publish_history",
	"publish_jobs",
	"publish_history",
	"queue_jobs",
	"queue_job_events",
	"queue_workers",
	"queue_metrics",
	// Pin engine extras
	"ai_pin_reference_images",
	"ai_pin_generation_runs",
	"ai_pin_template_versions",
	"ai_pin_template_assets",
	"ai_pin_template_favorites",
	"ai_pin_template_preview_cache",
	// Plans / credits / billing
	"plans",
	"workspace_subscriptions",
	"credit_transactions",
	"credit_reservations",
	"workspace_usage",
	"billing_events",
	"billing_idempotency",
	// Platform / admin
	"ai_providers",
	"ai_provider_secrets",
	"ai_models",
	"platform_settings",
	"notification_history",
	"notification_templates",
	"audit_logs",
	"system_logs",
	"security_events",
	"api_requests",
	"login_history",
	"system_health",
	"service_status",
	"worker_health",
	"provider_health",
	"health_incidents",
	"analytics_daily",
	"analytics_cache",
	"legal_pages",
	"legal_page_versions",
	"pinterest_app_credentials",
	"article_activity_history",
];

/** Workspace relation indexes for Phase 2 filter performance (additive). */
const WORKSPACE_RELATION_INDEXES = [
	{ collection: "websites", sql: "CREATE INDEX `idx_isolation_websites_workspace` ON `websites` (`workspace`)" },
	{ collection: "ai_pins", sql: "CREATE INDEX `idx_isolation_ai_pins_workspace` ON `ai_pins` (`workspace`)" },
	{ collection: "articles", sql: "CREATE INDEX `idx_isolation_articles_workspace` ON `articles` (`workspace`)" },
	{ collection: "pins", sql: "CREATE INDEX `idx_isolation_pins_workspace` ON `pins` (`workspace`)" },
	{ collection: "user_settings", sql: "CREATE INDEX `idx_isolation_user_settings_workspace` ON `user_settings` (`workspace`)" },
	{ collection: "brand_kits", sql: "CREATE INDEX `idx_isolation_brand_kits_workspace` ON `brand_kits` (`workspace`)" },
	{ collection: "pinterest_accounts", sql: "CREATE INDEX `idx_isolation_pinterest_accounts_workspace` ON `pinterest_accounts` (`workspace`)" },
	{ collection: "pinterest_boards", sql: "CREATE INDEX `idx_isolation_pinterest_boards_workspace` ON `pinterest_boards` (`workspace`)" },
	{ collection: "pinterest_publish_jobs", sql: "CREATE INDEX `idx_isolation_pinterest_publish_jobs_workspace` ON `pinterest_publish_jobs` (`workspace`)" },
	{ collection: "ai_pin_image_jobs", sql: "CREATE INDEX `idx_isolation_ai_pin_image_jobs_workspace` ON `ai_pin_image_jobs` (`workspace`)" },
	{ collection: "ai_pin_generation_history", sql: "CREATE INDEX `idx_isolation_ai_pin_gen_history_workspace` ON `ai_pin_generation_history` (`workspace`)" },
	{ collection: "ai_pin_templates", sql: "CREATE INDEX `idx_isolation_ai_pin_templates_workspace` ON `ai_pin_templates` (`workspace`)" },
	{ collection: "wordpress_sites", sql: "CREATE INDEX `idx_isolation_wordpress_sites_workspace` ON `wordpress_sites` (`workspace`)" },
	{ collection: "publish_jobs", sql: "CREATE INDEX `idx_isolation_publish_jobs_workspace` ON `publish_jobs` (`workspace`)" },
	{ collection: "queue_jobs", sql: "CREATE INDEX `idx_isolation_queue_jobs_workspace` ON `queue_jobs` (`workspace`)" },
];

migrate(
	(app) => {
		const names = Array.from(
			new Set([...LEGACY_CLIENT_RULE_COLLECTIONS, ...PLATFORM_AND_TENANT_COLLECTIONS]),
		);

		for (const name of names) {
			applyApiOnlyRules(app, name);
		}

		for (const entry of WORKSPACE_RELATION_INDEXES) {
			const collection = findCollectionSafe(app, entry.collection);
			if (!collection) continue;
			if (!collection.fields.getByName("workspace")) continue;
			const marker = String(entry.sql).match(/`(idx_[^`]+)`/);
			if (marker && collectionHasIndexMarker(collection, marker[1])) continue;
			if (!ensureIndexIdempotent(collection, entry.sql)) continue;
			try {
				app.save(collection);
			} catch (error) {
				const message = String(error?.message || error || "");
				if (!/already exists|duplicate/i.test(message)) throw error;
			}
		}
	},
	(app) => {
		// Security harden is additive. Down migration does not restore weaker
		// owner-scoped client rules (would reintroduce cross-workspace risk).
		void app;
	},
);
