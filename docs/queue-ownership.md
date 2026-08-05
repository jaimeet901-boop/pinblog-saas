# Queue Ownership — Chef IA / PinBlog SaaS

**Phase 9a:** Governance and observability documentation only. Runtime execution is unchanged until later Phase 9 sub-phases.

## Purpose

Chef IA runs **multiple queue-related loops in one API process**. This document defines **who owns execution**, **who owns observability**, and **what must not become source-of-truth** during consolidation.

Canonical machine-readable catalog: `apps/api/src/services/queue/ownership.js`

Health exposure: `/api/health` → `queue.ownership` and core service `queue.meta.ownership`

---

## Source of truth hierarchy

| Layer | Store / module | Role |
|-------|----------------|------|
| **Execution (channel jobs)** | `pinterest_publish_jobs`, `publish_jobs`, `ai_pin_image_jobs` | Real publish/generation work |
| **Execution (native jobs)** | `queue_jobs` types processed by `queue/engine.js` | Webhooks, analytics refresh, health checks, etc. |
| **Legacy observability rows** | `queue_jobs` with `source_collection` set | Historical mirror rows; **no new writes** (9d-6) |
| **Scheduling (Calendar)** | Channel job collections | **Never** `queue_jobs` alone |
| **Publishing History** | Channel collections + history tables | Read model |

---

## Channel executors (legacy pollers)

These modules **poll PocketBase channel collections** and perform external I/O (Pinterest, WordPress, AI providers):

| Channel | Collection | Executor | Started from | Env flag |
|---------|------------|----------|--------------|----------|
| Pinterest publish | `pinterest_publish_jobs` | `apps/api/src/services/pinterest-publish-queue.js` | `main.js` → `startPinterestPublishQueue()` | `PINTEREST_QUEUE_ENABLED` |
| WordPress publish | `publish_jobs` | `apps/api/src/services/wordpress-publish-queue.js` | `main.js` → `startWordpressPublishQueue()` | `WORDPRESS_QUEUE_ENABLED` |
| AI pin image | `ai_pin_image_jobs` | `apps/api/src/services/ai-pin-image-queue.js` | `main.js` → `startAIPinImageQueue()` | `AI_PIN_IMAGE_QUEUE_ENABLED` |

Each flag gates **legacy poller startup only**. When unset or `true`/`1`, behavior is unchanged. When `false`/`0`, the poller does not start (no timer, no stuck recovery); enqueue APIs and calendar mutations still create and update channel job collections.

Channel jobs are **not** mirrored into `queue_jobs` (mirror writes retired 9d-6). Enable admin dual-read for channel-native admin views.

---

## Producers (job creation)

| Producer | Creates |
|----------|---------|
| `routes/pinterest.js` | `pinterest_publish_jobs` |
| `services/publish-pipeline.js` | `pinterest_publish_jobs` (workflow) |
| `services/wordpress-publish.js` | `publish_jobs` |
| `routes/ai-pin-images.js` | `ai_pin_image_jobs` |
| `services/analytics/refresh.js` | native `queue_jobs` |
| `services/article-lifecycle.js`, `pin-generation.js`, `template-export.js` | native `queue_jobs` |
| `routes/admin/queue.js` | native `queue_jobs` (admin) |

---

## Native queue engine

`apps/api/src/services/queue/engine.js` polls **`queue_jobs`** but processes **native types only`:

- `webhook_delivery`
- `email_notification`
- `notification`
- `media_upload`
- `analytics_refresh`
- `health_check`

It does **not** execute `pinterest_publishing`, `wordpress_publishing`, or `image_generation` jobs today. Specialized worker IDs registered in the engine fleet are metadata for admin observability, not active executors for channel publish types.

Started from `main.js` → `startQueueEngine()`.

---

## Consumers (read surfaces)

| Consumer | Reads | Notes |
|----------|-------|-------|
| Admin Queue Monitor | `queue_jobs` + channel collections (dual-read) | Enable `ADMIN_QUEUE_DUAL_READ_ENABLED` |
| Calendar | Channel collections | `queue_jobs` optional enrichment; **not SoT** |
| Publishing History | Channel collections | Read model |
| Health monitor | `computeQueueSummary()` + ownership catalog | Observability |
| Workspace dashboard | Channel jobs + `queue_jobs` | Mixed view |

---

## Related schedulers (not publish executors)

| Module | Role |
|--------|------|
| `wordpress-sync-scheduler.js` | Due WordPress site sync via `next_sync_at` |
| `pinterest-analytics-sync.js` | Pinterest analytics refresh scheduling |
| `billing/index.js` worker | Billing automation (separate subsystem) |

These are **not** replacements for channel publish pollers.

---

## Legacy mirror rows (retired writes)

Channel mirror **writes** were removed in Phase **9d-4/9d-6**. Existing `queue_jobs` rows with `source_collection` set remain readable via `findBySource()` for:

- Admin dual-read legacy merge
- Optional calendar enrichment
- Metrics `breakdown.mirroredChannel` counts

No new mirror rows are created. Optional DB cleanup: run `scripts/inventory-queue-mirrors.mjs`.

---

## Phase 9 roadmap (reference)

| Sub-phase | Scope | Runtime change |
|-----------|-------|----------------|
| **9a** | Ownership docs + health visibility | **None** |
| **9b** (implemented) | `PINTEREST_QUEUE_ENABLED` — Pinterest poller only | Optional execution pause; scheduling unchanged |
| **9c** (implemented) | `WORDPRESS_QUEUE_ENABLED`, `AI_PIN_IMAGE_QUEUE_ENABLED` | Optional execution pause; enqueue unchanged |
| **9d-4** (implemented) | Remove mirror write call sites | Mirror writes stopped |
| **9d-6** (implemented) | Remove `mirrors.js`, `upsertMirroredJob`, `QUEUE_MIRRORS_ENABLED` | Cleanup only |

### Phase 9d — Mirror retirement

**Status:** **Complete** through 9d-6. Enable admin dual-read + channel controls in production.

| Sub-phase | Scope | Status |
|-----------|-------|--------|
| **9d-0** | Docs + inventory script | Done |
| **9d-1** | Metrics breakdown (`native` / `mirroredChannel`) | Done |
| **9d-2** | Admin dual-read | Done |
| **9d-3** | Admin channel controls | Done |
| **9d-4a/b/c** | Per-channel mirror write removal | Done |
| **9d-6** | Final mirror module cleanup | Done |

Full inventory and staging notes: **[queue-mirror-retirement.md](./queue-mirror-retirement.md)**

**Production recommendation:** `ADMIN_QUEUE_DUAL_READ_ENABLED=true` + `ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED=true`

### Channel poller flags

| Flag | Poller | Job creation / calendar |
|------|--------|-------------------------|
| `PINTEREST_QUEUE_ENABLED` | Pinterest publish | Unchanged when disabled |
| `WORDPRESS_QUEUE_ENABLED` | WordPress publish | Unchanged when disabled |
| `AI_PIN_IMAGE_QUEUE_ENABLED` | AI pin image | Unchanged when disabled |

| Value | Effect |
|-------|--------|
| unset, `true`, `1` | Poller runs (default) |
| `false`, `0` | Poller does not start — jobs accumulate until re-enabled + restart |

Status helpers expose `enabled` and `disabledByEnv`. Requires process restart to toggle.

### Admin dual-read flag (`ADMIN_QUEUE_DUAL_READ_ENABLED`)

| Value | Admin Queue read path |
|-------|------------------------|
| unset, `false`, `0` | **Disabled** — `queue_jobs` only (current production behavior) |
| `true`, `1` | Dual-read — merge native `queue_jobs` + channel collections |

Unknown values default to **disabled**. Requires process restart to toggle. Read path only when channel controls are disabled — enable `ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED` for synthetic id mutate support (9d-3).

Module: `apps/api/src/services/queue/admin-read/`. Additive DTO fields when enabled: `readSource`, `queueJobId`. Channel-only rows use synthetic id `{sourceCollection}:{sourceId}`.

### Admin channel controls flag (`ADMIN_QUEUE_CHANNEL_CONTROLS_ENABLED`)

| Value | Admin Queue mutate path |
|-------|-------------------------|
| unset, `false`, `0` | **Disabled** — all controls require `queue_jobs.id` (current production behavior) |
| `true`, `1` | Resolve synthetic / channel ids → mutate channel SoT via trusted adapters |

Unknown values default to **disabled**. Requires process restart. Works with dual-read synthetic ids. Channel delete is blocked (422); cancel instead. Legacy mirror rows sync via `syncMirrorQueueJob` when `queueJobId` exists.

Module: `apps/api/src/services/queue/admin-controls/`.

---

## Invariants (Constitution)

1. **Calendar scheduling SoT** remains channel job collections.
2. **Publishing History** remains a read model over channel data.
3. **Do not remove legacy executors** without proven replacement (Phase 9b–9d).
4. **Workspace ownership** on jobs is enforced via `queue/job-ownership.js` — never from untrusted client fields alone.

---

## Changing queue behavior (future engineers)

1. Read this document and `docs/schema-authority.md`.
2. Identify whether the change affects **execution**, **mirrors**, or **native engine**.
3. Run staging E2E: Pinterest publish, WordPress publish, AI image job, admin queue view, calendar item, publishing history row.
4. Keep one subsystem per commit; prefer env flags before deletion.
