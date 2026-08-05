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
| **Observability mirror** | `queue_jobs` rows upserted by `queue/mirrors.js` | Admin queue monitor; mirrors channel state |
| **Scheduling (Calendar)** | Channel job collections | **Never** `queue_jobs` alone |
| **Publishing History** | Channel collections + history tables | Read model |

---

## Channel executors (legacy pollers)

These modules **poll PocketBase channel collections** and perform external I/O (Pinterest, WordPress, AI providers):

| Channel | Collection | Executor | Started from |
|---------|------------|----------|--------------|
| Pinterest publish | `pinterest_publish_jobs` | `apps/api/src/services/pinterest-publish-queue.js` | `main.js` → `startPinterestPublishQueue()` |
| WordPress publish | `publish_jobs` | `apps/api/src/services/wordpress-publish-queue.js` | `main.js` → `startWordpressPublishQueue()` |
| AI pin image | `ai_pin_image_jobs` | `apps/api/src/services/ai-pin-image-queue.js` | `main.js` → `startAIPinImageQueue()` |

After create/update, executors (and some routes) call mirror helpers to reflect state into `queue_jobs` for the admin UI.

---

## Native queue engine

`apps/api/src/services/queue/engine.js` polls **`queue_jobs`** but processes **native types only**:

- `webhook_delivery`
- `email_notification`
- `notification`
- `media_upload`
- `analytics_refresh`
- `health_check`

It does **not** execute `pinterest_publishing`, `wordpress_publishing`, or `image_generation` jobs today. Specialized worker IDs registered in the engine fleet are metadata for admin observability, not active executors for channel publish types.

Started from `main.js` → `startQueueEngine()`.

---

## Producers (job creation)

| Producer | Creates | Typical mirror |
|----------|---------|----------------|
| `routes/pinterest.js` | `pinterest_publish_jobs` | `mirrorPinterestJob` |
| `services/publish-pipeline.js` | `pinterest_publish_jobs` (workflow) | via pipeline |
| `services/wordpress-publish.js` | `publish_jobs` | `mirrorWordpressJob` |
| `routes/ai-pin-images.js` | `ai_pin_image_jobs` | `mirrorImageJob` |
| `services/analytics/refresh.js` | native `queue_jobs` | direct enqueue |
| `services/article-lifecycle.js`, `pin-generation.js`, `template-export.js` | native `queue_jobs` | direct enqueue |
| `routes/admin/queue.js` | native `queue_jobs` (admin) | — |

---

## Consumers (read surfaces)

| Consumer | Reads | Notes |
|----------|-------|-------|
| Admin Queue Monitor | `queue_jobs` via `/admin/queue/*` | Includes mirrored channel jobs |
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

## Mirror layer

`apps/api/src/services/queue/mirrors.js` upserts mirrored rows in `queue_jobs` when channel jobs change. Mirrors:

- Do **not** execute external publishes
- May fail silently (`.catch(() => null)`) — admin view can lag channel SoT
- Must not be retired until Phase **9d** proves single-processor safety

---

## Phase 9 roadmap (reference)

| Sub-phase | Scope | Runtime change |
|-----------|-------|----------------|
| **9a** (this doc) | Ownership docs + health visibility | **None** |
| **9b** | Pinterest poller env flag | Optional pause (future) |
| **9c** | WordPress + AI image flags | Optional pause (future) |
| **9d** | Mirror retirement | High risk; last |

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
