/**
 * Schema authority for Chef IA / pinblog-saas
 *
 * ## Single source of truth
 *
 * **Primary:** `apps/pocketbase/pb_migrations/*.js`
 * PocketBase applies these on startup (`--migrationsDir`). New collections,
 * fields, indexes, and API rules MUST be added here first.
 *
 * **Compat only:** `apps/api/src/utils/ensure-*.js`
 * Idempotent gap-fill for existing production volumes that lag migrations.
 * Ensures must not invent schema without a sibling migration registered in
 * `apps/api/src/utils/schema-compat-registry.js`.
 *
 * ## Fresh installs
 *
 * 1. Start PocketBase with migrations dir → schema is complete.
 * 2. Start API → startup ensures no-op (already present).
 *
 * ## Existing installs
 *
 * 1. Deploy new PocketBase binary/data with migrations (preferred).
 * 2. API boot still runs startup ensures so missing fields/rules self-heal
 *    without manual admin intervention if a migration was skipped.
 *
 * ## Changing schema
 *
 * 1. Add/update a PocketBase migration.
 * 2. Update the matching ensure (additive only) if older DBs must self-heal.
 * 3. Register migration IDs in `schema-compat-registry.js`.
 * 4. Keep API routes/services behavior unchanged.
 */
