# Template Engine — `schema_version` Upgrade Notes

Guidance for evolving `configuration.schemaVersion` / denormalized `ai_pin_templates.schema_version` without breaking existing pins.

Companion: [template-engine-configuration-schema.md](./template-engine-configuration-schema.md).

---

## Version map

| `schemaVersion` | Meaning | Introduced |
|-----------------|---------|------------|
| **1** | v1 procedural template (`canvas` + layout/typography…, no `layers`) | Legacy / Module 1 |
| **2** | v2 layer document (`editorVersion: 2`, `layers[]`, `groups[]`) | Module 2 |
| **3** | Reserved — additive layer props / new layer types only | Future |
| **4** | Reserved — structural changes (e.g. nested frames, multi-page) | Future |

`editorVersion` remains the **editor interaction** flag (`1` procedural UI, `2` layer editor).  
`schemaVersion` is the **document format** flag the compositor/migrators branch on.

---

## Hard rules

1. **Never** force-migrate stored v1 configs to v2 on open or generate.  
2. Compositor dual-path: `isV2Document(doc)` → layer compositor; else procedural renderer.  
3. Unknown `schemaVersion` for a known `editorVersion` → treat as closest supported **reader**, refuse silent write-upgrades.  
4. Every migration helper is **optional** and **idempotent** (`migrateV2toV3(doc)` returns a new object; caller decides whether to save).  
5. After any persisted configuration change: recompute `config_checksum`, bump `revision` (optimistic lock).  
6. Preview cache invalidation is **checksum-only** (ignore `updated` / `last_used_at`).  
7. `template_uuid` never changes across schema upgrades or export/import.

---

## Upgrade playbook (v2 → v3 → v4)

### When to bump

| Change type | Action |
|-------------|--------|
| New optional layer prop with safe default | Keep `schemaVersion`; document default in normalize |
| New `LAYER_TYPES` value | Keep version if old readers ignore unknown types; else bump + migrator |
| Rename / remove field | Bump `schemaVersion`; write migrator; keep reader for N−1 |
| Change coordinate system or canvas semantics | Bump; migrator required |

### Migrator contract

```text
migrateDocument(doc, { targetSchemaVersion }) → { document, from, to, changed }
```

- Input may be raw or normalized.  
- Output document must pass `normalizeEditorDocument`.  
- Set `schemaVersion` to `targetSchemaVersion`.  
- Do not mutate PocketBase; persistence is the caller’s job.  
- Place migrators in `pinLayerMigrate.js` (client) and mirror on server when Module 6 lands.

### Reader compatibility matrix (target)

| Writer \ Reader | v1 | v2 | v3 | v4 |
|-----------------|----|----|----|----|
| v1 | ✓ procedural | ✓ procedural | ✓ procedural | ✓ procedural |
| v2 | ✗ (use procedural fallback only if mis-detected) | ✓ compositor | ✓ compositor + ignore unknown | ✓ |
| v3 | — | read via migrate-down or forward-compatible normalize | ✓ | ✓ |
| v4 | — | — | migrate-down or forward-compatible | ✓ |

Until v3/v4 exist, only **v1** and **v2** are implemented.

---

## Checklist for a new schema version

1. Update `DOCUMENT_SCHEMA_VERSION*` constants (web + api).  
2. Extend `normalizeEditorDocument` with defaults for new fields.  
3. Add `migrateV{n}toV{n+1}` + tests.  
4. Update [template-engine-configuration-schema.md](./template-engine-configuration-schema.md).  
5. Ensure preview cache still keys on `config_checksum`.  
6. Do **not** rewrite existing rows in a PocketBase migration unless an explicit data backfill is approved.

---

## Preview cache & checksum

```text
cacheKey = template_id + ":" + config_checksum + ":" + format
```

- On template save: new checksum → old cache rows miss naturally (optional TTL via `expires_at`).  
- Do not invalidate by `updated` timestamp alone (clock skew / no-op saves).  
- Soft-deleted cache rows may remain until swept; lookup must ignore `deleted_at != null`.
