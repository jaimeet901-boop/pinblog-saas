# Facebook Channel Pack — Architecture Decision Record (F0)

**Status:** Phases **F0–F8 complete** — Facebook Channel Pack certified for release.  
**ADR ID:** `ADR-FB-CHANNEL-PACK-001`  
**Last updated:** 2026-08-07  
**Scope:** F0–F8 complete. OAuth, publish, schedule, studio assets, publishing history, insights, hardening, and release documentation.

Related: [facebook-channel-pack-schema.md](./facebook-channel-pack-schema.md) · [facebook-channel-pack-f1-apply-report.md](./facebook-channel-pack-f1-apply-report.md) · [facebook-channel-pack-f2-report.md](./facebook-channel-pack-f2-report.md) · [facebook-channel-pack-f6-certification-report.md](./facebook-channel-pack-f6-certification-report.md) · [facebook-channel-pack-f7-certification-report.md](./facebook-channel-pack-f7-certification-report.md) · [facebook-channel-pack-f8-certification-report.md](./facebook-channel-pack-f8-certification-report.md) · [facebook-channel-pack-release-checklist.md](./facebook-channel-pack-release-checklist.md) · [facebook-channel-pack-operations.md](./facebook-channel-pack-operations.md) · [calendar-architecture.md](./calendar-architecture.md) · [provider-architecture.md](./provider-architecture.md) · [api-contracts.md](./api-contracts.md)

---

## 1. Architecture Decision Record

### Context

AI Facebook Pages today is a Content Studio product shell: shared atelier UI, destination-adapter stubs, and a Unified Calendar C9 channel reservation. Generation, drafts, images, and templates still flow through AI Pins (`/ai-pins`, `ai_pins`). There is no Graph OAuth, no `/facebook` API, no `facebook_*` PocketBase collections, and no publish worker.

Building Facebook as a near-copy of AI Pins would fork the atelier, duplicate generation, and risk Calendar / Pinterest regressions.

### Decision

| # | Decision | Choice |
|---|----------|--------|
| D1 | Product UX | **Single shared Content Studio** (`ContentStudioPage` + product configs) |
| D2 | Facebook delivery model | **Channel Pack** (destination + Graph + jobs + queue + Insights), not a forked product |
| D3 | Studio artifact (near-term) | **Option A** — keep `ai_pins` as the studio draft/artifact store; add channel-aware metadata in later phases without renaming collections in F0–F5 |
| D4 | Channel write SoT | **`facebook_publish_jobs`** (reserved; schema in F1+, not F0) |
| D5 | Calendar | **Reuse** existing Facebook provider + mutation adapters; **no** facade/router redesign |
| D6 | Pinterest | **Frozen behavior** — Facebook work must not change Pinterest routes, jobs, workers, or UI contracts |
| D7 | Schedule policy | **App-side scheduling** (job row + worker), same pattern as Pinterest/WordPress, so Unified Calendar remains SoT projector |
| D8 | Generation | **Shared** AI Pins generation/image APIs for F1–F6; Facebook-specific **prompt/export packs** only (not a second generation stack) |
| D9 | Destination seam | Live `facebookDestinationAdapter` (from F3+) mirroring the existing destination-adapter contract |
| D10 | F0 deliverable | Architecture lock only — **no code, no migrations, no OAuth, no publish** |

### Consequences

- Facebook Pages remains a studio product (`AI_FACEBOOK_PAGES_PRODUCT`) whose network behavior lives in the channel pack.
- Calendar already registers `facebook` / `facebook_publish_jobs`; later phases fill the SoT, they do not invent a second calendar.
- `ai_pins` naming debt is accepted until after publish is production-usable (optional rename = F8 backlog).
- Graph-native `scheduled_publish_time` is **out of scope** for v1; may be evaluated later without changing Calendar architecture.

### Non-goals (F0 and explicit bans until later phases)

- Forking `ContentStudioPage` into a Facebook-only studio
- Redesigning Unified Calendar facade / mutation router
- Changing Pinterest OAuth, publish, queue, or analytics
- Implementing OAuth, Graph publish, or workers in F0
- Creating or applying PocketBase migrations in F0
- Renaming `ai_pins` / `components/ai-pins` in F0

---

## 2. Domain model

Logical entities (not schema — F0 has no migrations).

### Shared studio domain

| Entity | Current store | Role |
|--------|---------------|------|
| Studio artifact | `ai_pins` | Draft / composed item before or beside channel publish |
| Template | `ai_pin_templates` (+ versions/assets) | Multi-channel design asset |
| Brand kit | `brand_kits` | Workspace brand |
| Image job | `ai_pin_image_jobs` | Shared image generation queue |
| Generation run | `ai_pin_generation_runs` | Module 7 orchestration |
| Website / article | `websites`, `website_articles` | Content sources |

### Facebook channel domain (future SoT — F1+)

| Entity | Intended collection | Role |
|--------|---------------------|------|
| Facebook account | `facebook_accounts` | Connected Meta user/business binding (workspace-scoped) |
| Account secrets | `facebook_account_secrets` | Encrypted tokens (never to browser) |
| Facebook Page | `facebook_pages` | Publish destination (parallel to Pinterest board) |
| Publish job | `facebook_publish_jobs` | **Write SoT** for schedule/publish; Calendar projects these |
| Publish event | `facebook_publish_events` | Job audit trail |
| Publish history | `facebook_publish_history` (optional) | Denormalized history / Insights snapshot |

### Relationships

```
Website ──< Studio artifact (ai_pins)
                │
                │  publish_job_id / channel link (later)
                ▼
Facebook account ──< Facebook Page ──< facebook_publish_jobs
                                              │
                                              ├── projected by Calendar provider (channel=facebook)
                                              └── processed by facebook-publish-queue (F4+)
```

### Identity vocabulary (lock)

| Concept | Facebook term | Must not pretend to be |
|---------|---------------|------------------------|
| Destination | **Page** | Board |
| Network item | **Post** | Pin |
| External id | `facebook_post_id` | `pinterest_pin_id` |
| Studio link field (jobs) | Prefer `ai_pin` / studio artifact id (compat) | New required rename in F0 |
| Calendar channel id | `facebook` | — |
| Calendar refType | `facebook_publish_jobs` | — |

Deep-link field `studioPinId` in Calendar projections remains for backward compatibility; additive alias `studioItemId` added in F8-4 (same opaque value). Both channels may share the opaque link key.

---

## 3. Facebook Channel Pack boundaries

### In pack (owns)

- Meta Graph client + token lifecycle (F2+)
- `/facebook/*` HTTP API (F2+)
- Destination adapter **live** paths for Facebook (F3+)
- `facebook_*` collections + publish worker + mirrors (F1 / F4+)
- Facebook Hub UI connect/list flows (F2+)
- Facebook validators (caption/media/link) (F3+)
- Insights sync + publishing-history normalizer for `facebook` (F7+)
- Feature catalog key `facebook` + plan gates (F1 / F8)
- Prompt/export **packs** keyed by channel (F6)

### Shared (must not fork)

- `ContentStudioPage` + `lib/studio/products.js` product configs
- `components/ai-pins/*` atelier widgets (path rename optional later)
- `/ai-pins`, `/ai-pin-images`, generation services
- Image provider registry + `ai_pin_image_jobs` worker
- Credits engine
- Unified Calendar facade, mutation router, C8 projections
- Template engine + `/workspace/v1/templates`
- Destination-adapter **contract** shape (shared file OK; implementations diverge)

### Out of pack (forbidden to change for Facebook work)

- Pinterest routes, services, workers, collections, Hub UI behavior
- WordPress publish path
- Calendar facade/router **core** (no Facebook SoT strings in core)
- Dual-write freeze (jobs must not write publish schedules into `calendar_events`)

### Boundary rule

> Studio creates/edits artifacts.  
> Channel pack publishes/schedules and owns network SoT.  
> Calendar only projects channel jobs + allowed overlays.

---

## 4. Integration diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│ Web                                                                  │
│  AIFacebookPagesPage ──► ContentStudioPage(AI_FACEBOOK_PAGES_PRODUCT)│
│       │                         │                                    │
│       │                         ├── /ai-pins/*  (shared generation)  │
│       │                         └── getDestinationAdapter('facebook')│
│       ▼                                                              │
│  FacebookPage (Hub) ──► /facebook/* (F2+)                            │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────────┐
│ API                                                                  │
│  Shared: ai-pins · ai-pin-images · pin-generation · image-providers  │
│  Pack:   facebook routes · facebook-api · secrets · publish-queue    │
│  Cal:    providers/facebook · mutations/adapters/facebook (exists)   │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────────┐
│ Data                                                                 │
│  Shared SoT (studio): ai_pins, templates, brand_kits, image jobs     │
│  Channel SoT (F1+):   facebook_accounts/pages/publish_jobs/…         │
│  Calendar read:       projects facebook_publish_jobs → Scheduled Item│
└─────────────────────────────┬────────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────────┐
│ External (F2+)                                                       │
│  Meta OAuth · Graph Pages · Graph feed publish · Insights            │
└──────────────────────────────────────────────────────────────────────┘
```

Pinterest remains a **sibling** channel pack with the same studio entry pattern (`AI_PINS_PRODUCT` → `pinterest` destination). Facebook must parallel that seam, not replace it.

---

## 5. Folder structure

### Locked target layout (create in later phases — not in F0)

```
apps/api/src/
  routes/
    facebook.js                 # F2+ mount /facebook
  services/
    facebook/                   # Channel pack root (F2+)
      api.js                    # Graph HTTP
      oauth.js                  # OAuth start/callback helpers
      secrets.js                # Token vault helpers
      accounts.js               # Account sync
      pages.js                  # Page listing/sync
      publish.js                # Create jobs / publish-now orchestration
      publish-queue.js          # Worker
      analytics-sync.js         # Insights (F7)
      validators.js             # FB-specific publish validation
    calendar/
      providers/facebook.js     # EXISTS — keep
      providers/facebook-source.js
      mutations/adapters/facebook.js
      mutations/adapters/facebook-live.js
  services/publishing-history/
    normalize-facebook.js       # F7

apps/web/src/
  pages/app/
    AIFacebookPagesPage.jsx     # EXISTS — keep thin wrapper
    FacebookPage.jsx            # EXISTS — evolve in F2 (no fork of studio)
  lib/studio/products.js        # EXISTS — product config only
  services/studio/
    destinationAdapters.js      # EXISTS — FB adapter goes live F3+
  # Do NOT add pages/app/FacebookStudioPage.jsx
  # Do NOT copy ContentStudioPage for Facebook

apps/pocketbase/pb_migrations/
  <timestamp>_facebook_channel_pack.js   # F1 only — not F0

docs/
  facebook-channel-pack-architecture.md  # THIS ADR (F0)
```

### Explicit non-structure

- No `apps/web/src/pages/app/FacebookContentStudioPage.jsx`
- No `apps/api/src/routes/ai-facebook-pins.js` generation fork
- No Facebook logic inside `calendar/facade.js` or `mutations/router.js` cores

---

## 6. Development rules

### Must

1. Keep a **single** Content Studio; Facebook differences go through `product` config + destination adapter + channel pack APIs.
2. Put network SoT writes only in **`facebook_publish_jobs`** (once schema exists).
3. Register Calendar behavior only via **provider / mutation adapter** files under `calendar/`.
4. Preserve Pinterest behavior: no drive-by edits to `routes/pinterest.js`, `pinterest-publish-queue.js`, or Pinterest Hub unless fixing a proven shared-studio bug with an isolated test.
5. Treat destination-adapter methods as the only studio→network publish/schedule entry for Facebook.
6. Encrypt tokens server-side; never return access tokens to the web client.
7. Feature-gate with catalog key **`facebook`** once F1 lands (today’s default-ON stub is debt to close).
8. Prefer shared generation; add **channel prompt/export packs**, not duplicated analyze/image stacks.
9. Add tests that lock: Calendar facade stays free of `facebook_publish_jobs` string literals in core; Pinterest publish regression suite still green.

### Must not

1. Fork AI Pins / Content Studio into a Facebook-only atelier.
2. Redesign Unified Calendar.
3. Dual-write Facebook schedules into `calendar_events`.
4. Reuse `pinterest_publish_jobs` or Pinterest OAuth collections for Facebook.
5. Ship OAuth, publish, workers, or PB migrations in **F0**.
6. Map Facebook Pages to Pinterest “boards” in user-facing copy (internal adapter shims only until F3 cleans validators/labels).
7. Implement Reels/Stories as F1–F5 scope (export sizes may exist; product backlog only).

### Review checklist (every FB PR)

- [ ] Does this change Pinterest behavior? If yes → reject unless intentional shared fix.
- [ ] Does this put Facebook SoT logic into Calendar core? → reject.
- [ ] Does this fork ContentStudioPage? → reject.
- [ ] Is schema/OAuth/publish appearing before its phase? → reject.

---

## 7. Migration strategy

Phased; **F0 creates no data migration**.

| Phase | Data / API migration | Notes |
|-------|----------------------|-------|
| **F0** | None | ADR lock only |
| **F1** | Add `facebook_*` collections + feature catalog `facebook` | Empty tables; Calendar source stays graceful `[]` until jobs exist |
| **F2** | OAuth + accounts/pages rows | No publish yet |
| **F3** | Adapter read paths | Still no Graph write |
| **F4** | Jobs + worker + Graph publish | Link studio artifact ↔ job |
| **F5** | Schedule fields + Calendar verification | App-side `scheduled_at` |
| **F6** | Product routes (history), prompt/export packs | No collection rename required |
| **F7** | Insights fields / history normalizer | Fill performance blobs |
| **F8** | Hardening / naming / release docs | Test stabilization, read-path polish, cosmetic aliases, certification |

### Studio artifact policy

- **F1–F8:** keep writing drafts via existing `/ai-pins` + `ai_pins` (Option A).
- **F8-4:** additive `studioItemId` alias alongside `studioPinId`; no collection rename.
- Optional full `studio_items` collection rename remains **deferred post-release** backlog.
- Optional additive fields (e.g. channel hint) only when a concrete publish path needs them — not speculative F0 schema.
- **No** backfill of Pinterest pins into Facebook jobs.
- Rollback: disable `facebook` feature flag; Calendar provider may remain registered (empty source is safe).

### Untracked local migrations

Do **not** apply local/untracked PocketBase migrations for Facebook. Only committed F1+ migrations apply in deploy.

---

## 8. Risk assessment

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R1 | Accidental Pinterest regression while editing shared studio | Med | High | Rules §6; shared PRs require Pinterest smoke; prefer adapter-only edits |
| R2 | `ai_pins` Pin semantics confuse Facebook posts | High | Med | F0 Option A accepted; F6 copy/prompts; F8 optional rename |
| R3 | Calendar shows nothing until F4/F5 | Certain | Low | Expected; provider already empty-safe |
| R4 | Feature flag `facebook` defaults ON before catalog entry | Med | Med | Close in F1; do not market Hub as ready |
| R5 | Board/`boardId` shims leak into UX | Med | Med | F3 validators + labels; ban user-facing “board” for FB |
| R6 | Temptation to use Graph native schedule and bypass Calendar | Low | High | D7 lock: app-side jobs only for v1 |
| R7 | Token leakage via logs/API | Med | Critical | Secrets collection + redacted logs (F2 rules) |
| R8 | Scope creep (Reels/Stories/IG) | Med | Med | Explicit non-goals through F8 |
| R9 | Duplicate calendar adapter drift vs Pinterest | Low | Low | Shared projection helpers; tests in `facebook.test.js` |

---

## 9. Technical constraints

1. **Unified Calendar C10 lock remains in force** — channel-agnostic core; Facebook stays in provider/adapter files only. See [calendar-architecture.md](./calendar-architecture.md).
2. **No schema changes in F0** — including additive fields on `ai_pins`.
3. **No OAuth / Graph publish in F0**.
4. **Destination contract** must stay compatible with `getDestinationAdapter(destinationId)` used by Content Studio.
5. **Workspace isolation** — all future `facebook_*` rows must be workspace-scoped like Pinterest.
6. **Plan access** — publishing must eventually respect plan features; generation continues to use existing AI credit features.
7. **Export sizes** `facebook_post` / `facebook_story` may be used by the shared export engine; they do not imply Stories product scope.
8. **Publishing history** already lists `facebook` in `PUBLISHING_CHANNELS` but has **no** job collection mapping until F1/F7 — do not fake history from Pinterest data.
9. **Platform analytics** `publishing.facebook: 0` remains until F7 — do not invent counts.
10. **Single deployable monorepo** — pack code lives in-repo; no separate Facebook microservice in v1.

---

## 10. Phase lock

### Current phase

| Field | Value |
|-------|--------|
| Phase | **F8** |
| Name | Hardening, Naming & Release Readiness |
| Status | **Complete** |
| Baseline | `origin/main` @ `c8720bf` (F8-4 code) + F8-5 documentation |
| Certification | [F8 Certification Report](./facebook-channel-pack-f8-certification-report.md) |

### Phase gate table

| Phase | Name | Status | Allowed work |
|-------|------|--------|--------------|
| **F0** | Architecture lock | **Complete** | Docs only |
| **F1** | Schema + feature catalog design | **Complete** | Docs only |
| **F1-Apply** | PB migrations + catalog + permissions | **Complete** | Foundation only |
| **F2** | OAuth + Hub + Admin | **Complete** | Connect/list accounts & pages |
| **F3** | Destination read path | **Complete** | Live adapter list; validators |
| **F4** | Publish now + queue | **Complete** | Graph write + jobs worker |
| **F5** | Schedule + Calendar verify | **Complete** | App-side schedule; mutation smoke |
| **F6** | Studio packs (prompts/sizes/routes) | **Complete** | [F6 cert](./facebook-channel-pack-f6-certification-report.md) |
| **F7** | Analytics + publishing history | **Complete** | [F7 cert](./facebook-channel-pack-f7-certification-report.md) |
| **F8** | Hardening / naming / release docs | **Complete** | [F8 cert](./facebook-channel-pack-f8-certification-report.md) · [Release checklist](./facebook-channel-pack-release-checklist.md) |

### Exit criteria for F0 (met)

- [x] ADR recorded with decisions D1–D10
- [x] Domain model documented without schema DDL
- [x] Channel pack boundaries defined
- [x] Integration diagram recorded
- [x] Target folder structure locked
- [x] Development rules published
- [x] Migration strategy phased without executing migrations
- [x] Risks and constraints listed
- [x] Phase lock table set to F0 complete

### Exit criteria for F1 (met)

- [x] PocketBase collections + fields designed
- [x] Relationships + indexes + validation rules designed
- [x] Feature flags + channel capabilities + permissions designed
- [x] Data lifecycle + migration plan documented
- [x] API contracts drafted (design only)
- [x] Feature catalog entry designed (`facebook`)
- [x] Risks / compatibility + architecture verification recorded

### Exit criteria for F1-Apply (met)

- [x] PocketBase migration `1785400000_facebook_channel_pack.js`
- [x] Feature catalog `facebook` registered
- [x] `PUBLISHING_JOB_COLLECTIONS.facebook` registered
- [x] Workspace RBAC `workspace.facebook.manage` / `publish`
- [x] Channel pack registry (`services/facebook/channel-pack.js`)
- [x] Isolation inventory lists updated
- [x] Tests + verification
- [x] No OAuth / Graph / publish / workers / Content Studio / Calendar redesign / Pinterest changes

### Exit criteria for F2 (met)

- [x] Facebook OAuth start/callback + long-lived token exchange
- [x] Admin Facebook Accounts page (credentials + inventory)
- [x] Encrypted account + page token storage
- [x] Connect / reconnect / disconnect + token refresh
- [x] Pages sync + default Page / account
- [x] Health / sync / error surfaces + audit logs
- [x] Workspace Hub Accounts + Pages
- [x] Tests; no publish / schedule / queue

### Exit criteria for F3–F5 (met)

- [x] Destination read service + validation API (F3)
- [x] Publish API + executor + queue worker (F4)
- [x] Schedule endpoint + Calendar adapter mutations (F5)

### Exit criteria for F6 (met)

- [x] Channel prompt packs, export profiles, template pack (F6-2–F6-4)
- [x] Product routes + studio asset capabilities (F6-5)
- [x] [F6 Certification Report](./facebook-channel-pack-f6-certification-report.md)

### Exit criteria for F7 (met)

- [x] Publishing history normalizer + `GET /facebook/history` (F7-2–F7-3)
- [x] Insights sync worker (F7-4)
- [x] Studio publishing history UI + analytics rollup (F7-5–F7-6)
- [x] Capability flags: `publishingHistory`, `insights`, `analytics`
- [x] [F7 Certification Report](./facebook-channel-pack-f7-certification-report.md)

### Exit criteria for F8 (met)

- [x] Web test stabilization — full suite green (F8-1)
- [x] Phase test hygiene + frozen boundary guards (F8-2)
- [x] Read-path resilience + operations doc (F8-3)
- [x] Cosmetic naming aliases — `studioItemId`, Page/Post labels (F8-4)
- [x] Release documentation + certification (F8-5)
- [x] [F8 Certification Report](./facebook-channel-pack-f8-certification-report.md)
- [x] [Release Checklist](./facebook-channel-pack-release-checklist.md)

### Explicit stop

**Stop after F8.** Facebook Channel Pack F0–F8 is complete and certified for release. Do not start post-release feature work without separate approval.

---

## Appendix — Decision traceability

| Analysis finding | F0 lock |
|------------------|---------|
| Exact page wrappers / product twins | Keep; do not fork studio |
| Destination adapter stubs | Remain until F3; contract stays |
| Calendar C9 Facebook provider | Keep; fill SoT later |
| No `facebook_*` PB collections | Schema deferred to F1 |
| History routes point at AI Pins / Pinterest | Fix in F6, not F0 |
| Option A vs B vs C studio artifact | **A** selected for velocity |

---

*End of ADR-FB-CHANNEL-PACK-001 (F0).*
