# Queue Mirror Retirement — Phase 9d Plan

**Status:** Phase 9d-0 (docs/inventory), **9d-1** (mirror write flag + metrics breakdown), and **9d-2** (admin dual-read foundation) implemented.  
**Runtime default:** Mirrors **enabled** when `QUEUE_MIRRORS_ENABLED` is unset. Admin dual-read **disabled** when `ADMIN_QUEUE_DUAL_READ_ENABLED` is unset. No mirror call sites removed.

Companion doc: [queue-ownership.md](./queue-ownership.md)

Machine-readable ownership catalog: `apps/api/src/services/queue/ownership.js` (`channelMirrors.envFlag`)

Manual inventory script (optional, never auto-run): `scripts/inventory-queue-mirrors.mjs`

---

## Purpose

Chef IA maintains **two observability layers** for channel work:

1. **Channel collections** (source of truth for execution and scheduling)
2. **`queue_jobs` mirrors** (upserted by `apps/api/src/services/queue/mirrors.js` for Admin Queue)

Phase **9d** retires the mirror write path once admin and health can operate on channel-native reads. Phase **9d-0** documents the inventory and roadmap only.

---

## Validation verdict (read-only, pre-9d-0)

| Check | Result |
|-------|--------|
| Admin Queue depends on mirrored `queue_jobs` | **Yes — critical** |
| Unified engine executes channel types | **No** — `source_collection` jobs excluded |
| Calendar depends on mirrors | **Optional enrichment only** |
| Publishing History depends on mirrors | **No** |
| Safe to remove mirrors today | **No** |

**Phase 9d mirror retirement is NOT READY** until admin dual-read and control routing exist (future 9d-2+).

---

## Mirror inventory

### Core module

| Module | Role |
|--------|------|
| `apps/api/src/services/queue/mirrors.js` | `mirrorPinterestJob`, `mirrorWordpressJob`, `mirrorImageJob` |
| `apps/api/src/services/queue/jobs.js` | `upsertMirroredJob()`, `findBySource()` |

All channel mirrors upsert rows in `queue_jobs` with:

- `source_collection` — channel PocketBase collection name
- `source_id` — channel job record id
- `type` — `pinterest_publishing` \| `wordpress_publishing` \| `image_generation`

Native jobs use `source_collection=""` and are processed by `queue/engine.js`.

### Mirror write call sites

#### `mirrorPinterestJob` → `pinterest_publish_jobs`

| File | Trigger |
|------|---------|
| `apps/api/src/routes/pinterest.js` | Job create (schedule/publish API) |
| `apps/api/src/services/publish-pipeline.js` | WP workflow creates Pinterest job; waiting-provider promote |
| `apps/api/src/services/pinterest-publish-queue.js` | Worker claim, complete, fail/retry |

#### `mirrorWordpressJob` → `publish_jobs`

| File | Trigger |
|------|---------|
| `apps/api/src/services/wordpress-publish.js` | Job enqueue |
| `apps/api/src/services/wordpress-publish-queue.js` | Worker claim, complete, fail/retry |

#### `mirrorImageJob` → `ai_pin_image_jobs`

| File | Trigger |
|------|---------|
| `apps/api/src/routes/ai-pin-images.js` | Job create |
| `apps/api/src/services/ai-pin-image-queue.js` | Fail/retry path; worker claim |

### Side effects on mirror write

| Effect | When |
|--------|------|
| `queue_jobs` create/update | Every successful upsert |
| `queue_events` append | When `eventMessage` provided |
| `writeQueueAudit` | Pinterest/WordPress terminal states (`published` / `failed`) |

Mirrors may fail silently at call sites (`.catch(() => null)`) — admin view can lag channel SoT.

---

## Producer matrix

| Producer | Channel collection | Mirror function | Also writes |
|----------|-------------------|-----------------|-------------|
| `routes/pinterest.js` | `pinterest_publish_jobs` | `mirrorPinterestJob` | Channel job + events |
| `services/publish-pipeline.js` | `pinterest_publish_jobs` | `mirrorPinterestJob` | Channel job |
| `services/pinterest-publish-queue.js` | `pinterest_publish_jobs` | `mirrorPinterestJob` | Status transitions |
| `services/wordpress-publish.js` | `publish_jobs` | `mirrorWordpressJob` | Channel job |
| `services/wordpress-publish-queue.js` | `publish_jobs` | `mirrorWordpressJob` | Status transitions |
| `routes/ai-pin-images.js` | `ai_pin_image_jobs` | `mirrorImageJob` | Channel job |
| `services/ai-pin-image-queue.js` | `ai_pin_image_jobs` | `mirrorImageJob` | Status transitions |
| `routes/admin/queue.js` | native `queue_jobs` | — | Direct enqueue (no mirror) |
| `services/analytics/refresh.js` etc. | native `queue_jobs` | — | Direct enqueue |

**Not producers:** Calendar mutations write channel collections only (mirror may follow from route/poller, not calendar adapter directly).

---

## Consumer matrix

| Consumer | Reads | Mirror dependency | Severity if mirrors removed |
|----------|-------|-------------------|----------------------------|
| **Admin Queue** (`routes/admin/queue.js`) | `queue_jobs` | **Critical** — channel jobs visible only via mirrors | Admin blind to channel work |
| **Admin controls** (`queue/controls.js`) | `queue_jobs` by id | **Critical** — `syncSourceStatus()` writes back to channel | Cancel/retry broken |
| **Health** (`queue/metrics.js` → `computeQueueSummary`) | All `queue_jobs` counts | **Partial** — mirrored rows inflate queue depth | Misleading metrics |
| **Health monitor** (`health/monitor.js`) | Via `computeQueueSummary` | Partial | Same |
| **Calendar C8** (`resolveQueueMirrorForSource`) | Optional `queue_jobs` lookup | **Low** — channel fields are fallback | UX: lose `queueJobId` deep links |
| **Publishing History** | Channel collections | **None** | Unaffected |
| **Workspace dashboard** | Channel collections | **None** | Unaffected |
| **Workspace history** | Channel collections | **None** | Unaffected |
| **Legacy health-check** | Poller status only | None | Unaffected |
| **Queue engine fleet** | Worker metadata | Cosmetic (`specialized-mirror` role) | Unaffected |
| **Website control center** | Mixed channel + `queue_jobs` | Partial | Partial count drift |
| **Frontend AdminQueuePage** | `/admin/queue/*` API | Via admin API | Same as Admin Queue |

---

## Dependency graph

```
                    PRODUCERS (routes, pollers, pipeline)
                                    │
                                    ▼
                    CHANNEL COLLECTIONS (SoT)
                    pinterest_publish_jobs | publish_jobs | ai_pin_image_jobs
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
            LEGACY POLLERS                   mirror*Job()
            (execution)                            │
                    │                               ▼
                    │                      queue_jobs (mirrored rows)
                    │                      source_collection + source_id
                    │                               │
        ┌───────────┼───────────┬───────────────────┼──────────────────┐
        ▼           ▼           ▼                   ▼                  ▼
   Calendar    Publishing   Workspace          Admin Queue         Health metrics
   (optional    History      dashboard          (CRITICAL)          (partial)
    mirror
    enrich)
```

**Reverse path (admin → channel):**

```
Admin cancel/retry/pause on queue_jobs.id
        → queue/controls.js
        → syncSourceStatus()
        → channel collection update
```

Removing mirrors without replacing this path breaks admin operations.

---

## Unified engine boundary

`queue/engine.js` does **not** execute channel job types today:

- `loadClaimableNativeJobs()` filters `source_collection=""`
- `claimNativeJob()` returns null when `source_collection` is set
- `NATIVE_JOB_TYPES` excludes `pinterest_publishing`, `wordpress_publishing`, `image_generation`

`SPECIALIZED_WORKERS` in the engine registers mirror worker IDs for observability only (`meta.role: specialized-mirror`).

---

## Rollback strategy

### During mirror write flag (9d-1 — implemented)

| Env | Effect |
|-----|--------|
| unset / `true` / `1` | Mirror writes unchanged (default) |
| `false` / `0` | `mirrorPinterestJob`, `mirrorWordpressJob`, `mirrorImageJob` return early — no upsert, events, or audit |

| Action | Effect |
|--------|--------|
| Set `QUEUE_MIRRORS_ENABLED=true` or unset | Mirror writes resume on next job event |
| Restart API | Required after env change |

### During mirror call-site removal (9d-4+, future)

| Action | Effect |
|--------|--------|
| Revert commit (one channel per commit) | Mirror calls restored |
| Re-run backfill script | Re-mirror active channel jobs into `queue_jobs` |
| Keep existing `queue_jobs` rows | Do not hard-delete until soak period ends |

### Production safety

- Default all new flags to **current behavior** (mirrors on, admin unchanged)
- Never disable mirrors in production until admin dual-read is verified (9d-2+)
- One channel per commit for mirror removal

---

## Staging strategy

### Environment

- Staging PocketBase with representative mirrored rows and active channel jobs
- Independent control of poller flags (9b/9c) and mirror flag `QUEUE_MIRRORS_ENABLED` (9d-1)

### Staging matrix (future phases)

| Step | Config | Expected |
|------|--------|----------|
| S1 | All defaults | Baseline — admin shows channel jobs via mirrors |
| S2 | `QUEUE_MIRRORS_ENABLED=false` | New jobs not mirrored; existing mirror rows still in admin; `breakdown.mirroredChannel` stops growing |
| S3 | S2 + create jobs | Channel SoT updates; admin missing new jobs until dual-read |
| S4 | Re-enable mirrors | New jobs mirror again |
| S5 | Dual-read on (9d-2+) | Admin shows channel jobs without new mirror writes |

### Soak criteria (before irreversible cleanup)

- 7+ days staging with mirrors off and dual-read on
- Admin E2E: list, detail, cancel, retry for all three channels
- Health breakdown metrics validated
- No orphaned active channel jobs invisible in admin

### E2E checklist (run before each 9d sub-phase)

- [ ] Pinterest schedule → admin visible → publish completes
- [ ] WordPress publish → admin visible → pipeline continues
- [ ] AI image job → admin visible → completes
- [ ] Native webhook/analytics jobs in admin
- [ ] Calendar item renders (with/without mirror enrichment)
- [ ] Publishing History row correct
- [ ] `/api/health` queue block sane

---

## Commit roadmap

### Phase 9d-0 — Preparation (implemented)

| Commit | Scope | Runtime change |
|--------|-------|----------------|
| 9d-0 | `docs/queue-mirror-retirement.md`, `docs/queue-ownership.md`, optional inventory script | **None** |

### Phase 9d-1 — Mirror write flag + metrics breakdown (implemented)

| Commit | Files | Runtime change |
|--------|-------|----------------|
| 9d-1 | `queue/mirrors.js`, `queue/metrics.js`, `health/monitor.js`, `queue/ownership.js`, `.env.example`, docs | Additive flag; **default unchanged** |

**9d-1 deliverables:**

- `isQueueMirrorsEnabled()` / `getQueueMirrorsStatus()`
- Gate on three public mirror functions only
- `computeQueueSummary().breakdown`: `{ native, mirroredChannel }`
- Health payload: additive `breakdown` + `mirrors` fields

### Phase 9d-2 — Admin dual-read (implemented)

| Commit | Scope |
|--------|-------|
| 9d-2 | `queue/admin-read/*`, `routes/admin/queue.js` (flag-gated read path), unit tests |

Env flag: `ADMIN_QUEUE_DUAL_READ_ENABLED` (default **off**).

When enabled:

- `GET /admin/queue/jobs` merges native `queue_jobs` + channel collections
- `GET /admin/queue/jobs/:id` resolves synthetic `{collection}:{id}` or native id
- Channel rows preferred over mirrored `queue_jobs` with matching `source_collection` + `source_id`
- Orphan mirrors (channel deleted) omitted from list

Not in 9d-2: admin controls, events on synthetic ids, frontend changes.

### Phase 9d-3 — Admin controls on channel refs (planned)

| Commit | Scope |
|--------|-------|
| 9d-3 | `queue/controls.js`, admin routes, possibly frontend |

### Phase 9d-4 — Per-channel mirror removal (planned, one channel per commit)

| Commit | Scope |
|--------|-------|
| 9d-4a | Remove Pinterest mirror calls |
| 9d-4b | Remove WordPress mirror calls |
| 9d-4c | Remove AI image mirror calls |

### Phase 9d-5 — Calendar enrichment removal (planned)

| Commit | Scope |
|--------|-------|
| 9d-5 | `calendar/projections/queue-mirror-source.js`, channel providers |

### Phase 9d-6 — Cleanup (planned)

| Commit | Scope |
|--------|-------|
| 9d-6 | Retire channel exports from `mirrors.js`, stale row cleanup script |

---

## Files touched by future phases (reference)

| Phase | Files |
|-------|-------|
| 9d-0 | docs, `scripts/inventory-queue-mirrors.mjs` |
| 9d-1 | `mirrors.js`, `metrics.js`, `health/monitor.js`, `ownership.js`, `.env.example`, docs |
| 9d-2 | `routes/admin/queue.js`, new `admin-read/*` |
| 9d-3 | `controls.js`, `routes/admin/queue.js`, `AdminQueuePage.jsx` |
| 9d-4a | `routes/pinterest.js`, `publish-pipeline.js`, `pinterest-publish-queue.js` |
| 9d-4b | `wordpress-publish.js`, `wordpress-publish-queue.js` |
| 9d-4c | `routes/ai-pin-images.js`, `ai-pin-image-queue.js` |
| 9d-5 | Calendar providers + `queue-mirror-source.js` |
| 9d-6 | `mirrors.js`, cleanup scripts |

### Must remain untouched until explicit phase

- `main.js` bootstrap
- Channel poller execution logic (except mirror call removal in 9d-4)
- `queue/engine.js` native processing
- PocketBase migrations
- Billing, OAuth, Publishing History subsystems

---

## Constitution compliance

| Invariant | 9d-0 | Future 9d |
|-----------|------|-----------|
| Calendar SoT = channel collections | Preserved | Preserved |
| Publishing History = read model | Preserved | Preserved |
| Do not remove executors without replacement | Preserved | Poller flags (9b/9c) remain |
| Flags before deletion | Documented for 9d-1+ | Required |
| One subsystem per commit | Roadmap enforces | Required |

---

## Related channel poller flags (9b/9c — implemented)

Independent of mirror retirement:

| Flag | Gates |
|------|-------|
| `PINTEREST_QUEUE_ENABLED` | Pinterest poller startup |
| `WORDPRESS_QUEUE_ENABLED` | WordPress poller startup |
| `AI_PIN_IMAGE_QUEUE_ENABLED` | AI image poller startup |

Poller flags pause **execution**; they do not stop mirror writes on enqueue.

---

## Changing mirror behavior (engineers)

1. Read this document and [queue-ownership.md](./queue-ownership.md).
2. Run `node --env-file=apps/api/.env scripts/inventory-queue-mirrors.mjs` (manual only).
3. Do not remove mirror call sites until admin dual-read staging passes.
4. Keep one channel per commit; prefer env flags before deletion.
