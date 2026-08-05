# Schema authority for Chef IA / pinblog-saas

## Single source of truth

**Primary:** `apps/pocketbase/pb_migrations/*.js`

PocketBase applies these on startup (`--migrationsDir`). New collections, fields, indexes, and API rules MUST be added here first.

**Compat only:** `apps/api/src/utils/ensure-*.js`

Idempotent gap-fill for existing production volumes that lag migrations. Ensures must not invent schema without a sibling migration registered in `apps/api/src/utils/schema-compat-registry.js`.

**Registry:** `apps/api/src/utils/schema-compat-registry.js`

Every ensure module is listed with:

- `migrationIds` — authoritative PocketBase migration file prefixes
- `mode` — `startup` (API boot via `runStartupSchemaCompat`) or `lazy` (on-demand import elsewhere)
- `ensureModule` / `ensureExport` — loader wiring

## Fresh installs

1. Start PocketBase with migrations dir → schema is complete.
2. Start API → startup ensures no-op (already present).

## Existing installs

1. Deploy new PocketBase binary/data with migrations (preferred).
2. API boot still runs startup ensures so missing fields/rules self-heal without manual admin intervention if a migration was skipped.

## Changing schema

1. Add/update a PocketBase migration.
2. Update the matching ensure (additive only) if older DBs must self-heal.
3. Register migration IDs in `schema-compat-registry.js`.
4. Keep API routes/services behavior unchanged.

## Governance and CI

Production readiness CI runs an explicit schema governance check:

```bash
node --test src/utils/schema-compat-registry.test.js
```

This verifies:

- Every registry entry references existing migration files
- Every `ensure-*.js` module is registered (no orphans)
- Startup ensures are wired only through `runStartupSchemaCompat` in `main.js`
- Lazy ensures are not loaded at API startup
- Policy documentation remains present

The same tests also run as part of `npm run test --prefix apps/api`.

## Retirement criteria (ensures are not removed casually)

An ensure module may be **retired** only when **all** of the following are true:

1. **Migration coverage:** Every field, collection, index, and rule the ensure gap-fills exists in a shipped PocketBase migration that has been deployed to all supported production volumes.
2. **Registry update:** The entry is removed from `schema-compat-registry.js` in the same change series (never delete an ensure file while it remains registered, and vice versa).
3. **Loader cleanup:** For `startup` entries, remove the matching loader from `run-schema-compat.js` only after the registry entry is removed.
4. **Verification:** `schema-compat-registry.test.js` passes and a staging boot on a migration-only database shows the ensure would no-op (no missing schema).
5. **Explicit review:** Retirement is a deliberate architecture change — not a drive-by cleanup during unrelated work.

Until retirement criteria are met, **compat ensures remain required** for lagging databases. Phase 8+ repair plans treat ensures as **governed**, not eliminated.

## What must never happen

- New schema introduced only in an ensure without a migration
- Removing `runStartupSchemaCompat()` from API boot while compat ensures exist
- Deleting ensure modules while production DBs may lag migrations
- Changing ensure behavior from additive gap-fill to destructive schema mutation
