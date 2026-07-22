# Chef IA — Implementation Roadmap

> Documentation only. Ordered phases for backend integration.  
> **Do not** implement these phases in this documentation task.

Related: [backend-integration-plan.md](./backend-integration-plan.md) · [api-contracts.md](./api-contracts.md) · [provider-architecture.md](./provider-architecture.md) · [rbac.md](./rbac.md) · [database-schema.md](./database-schema.md)

---

## Principles for every phase

1. Ship behind feature flags; keep Admin `BACKEND_READY` flips per page.  
2. Enforce authz on API (never rely on frontend gates alone).  
3. Audit sensitive mutations.  
4. No plaintext secrets in new code paths.  
5. Add contract tests for each new Admin route group.  
6. Prefer extending `apps/api` + PocketBase; avoid parallel conflicting models.

---

## Phase 1 — Authentication & identity foundation

**Goal:** Stable identity for Workspace + Admin without changing UX auth flows.

| Deliverable | Detail |
|-------------|--------|
| Document current PB auth | Already live — freeze breaking changes |
| `platform_role` readiness | Design dual-read (`role` + future `platform_role`) |
| Admin API gate middleware | `requirePlatformAdmin` |
| Session/header contract | Formalize Bearer encoding used by `apiServerClient` |
| Audit auth events | login success/failure, OAuth link/unlink |

**Exit criteria:** Admin routes 401/403 correctly; auth events in audit stream (even if UI still mock).

**Depends on:** none  
**Risk:** low if no UX auth redesign

---

## Phase 2 — Providers

**Goal:** Platform-managed AI provider registry with encrypted secrets.

| Deliverable | Detail |
|-------------|--------|
| Collections | `ai_providers`, `ai_provider_secrets` |
| Admin CRUD + test | `/admin/v1/providers*` |
| Adapter interface | OpenAI, Gemini first; stub others |
| Health worker | periodic probes |
| Wire integrated-ai router | resolve default provider from registry |

**Exit criteria:** Admin Providers page can load/save/test against live data; Writer still works via router.

**Depends on:** Phase 1  
**Risk:** medium (secret handling)

---

## Phase 3 — Models

**Goal:** Model registry drives routing, pricing, fallbacks.

| Deliverable | Detail |
|-------------|--------|
| Collection | `ai_models` |
| Admin Models APIs | list/filter/CRUD/default |
| Credit formula | tokens × price → credits |
| Plan allow-lists | restrict models by plan |
| Fallback chains | registry fields honored by router |

**Exit criteria:** Admin Models page live; generate calls pick default/fallback correctly.

**Depends on:** Phase 2

---

## Phase 4 — Workspace APIs

**Goal:** Harden and complete Workspace domain APIs; introduce workspaces tenancy.

| Deliverable | Detail |
|-------------|--------|
| `workspaces` + `workspace_members` | backfill 1:1 from owners |
| Stabilize websites/WP/AI Pins/Pinterest | validation, credits, errors |
| Settings sync API | replace pure localStorage for critical prefs |
| Subscription read model | plans from `plans` collection |
| Brand kits / templates | consistent DTO layer |
| Wire remaining Pinterest hub placeholders | publish/retry/cancel |

**Exit criteria:** All primary `/app/*` flows use documented contracts; membership checks pass.

**Depends on:** Phase 1–3 (providers/models for AI paths)  
**Risk:** medium (tenancy migration)

---

## Phase 5 — Publishing

**Goal:** Reliable WordPress + Pinterest publishing with observability.

| Deliverable | Detail |
|-------------|--------|
| WP secrets migration | off plaintext fields |
| Unified publish job events | |
| Calendar/history parity | Admin inventory read APIs |
| Idempotency keys | publish/schedule |
| Dead-letter + retry UX | already partially present |

**Exit criteria:** Publish failure rates measurable; retries safe; Admin can list sites/accounts.

**Depends on:** Phase 4  
**Risk:** medium (external APIs)

---

## Phase 6 — Analytics

**Goal:** Workspace + platform analytics from real data.

| Deliverable | Detail |
|-------------|--------|
| Keep Pinterest analytics sync | |
| Daily rollups | `analytics_daily` (proposed) |
| Admin `/analytics/overview` | replace mock |
| Caching + export | |

**Exit criteria:** Admin Analytics + app Analytics show live KPIs for non-mock ranges.

**Depends on:** Phase 4–5  
**Risk:** low–medium (aggregation cost)

---

## Phase 7 — Queue

**Goal:** Unified `platform_jobs` visible in Admin Queue/Jobs.

| Deliverable | Detail |
|-------------|--------|
| Job parent records | link existing image/publish jobs |
| Admin queue APIs | summary, filters, controls |
| Workers heartbeats | System Health |
| Global pause/resume | |
| Progress events | |

**Exit criteria:** Admin Queue mutations work; mirrors Writer/Pins/Publish activity.

**Depends on:** Phase 5  
**Risk:** medium (concurrency)

---

## Phase 8 — Logs

**Goal:** Queryable audit/security/AI/publishing logs for Admin Logs.

| Deliverable | Detail |
|-------------|--------|
| `audit_logs` writers | across API |
| Admin logs APIs | filter/export |
| Redaction pipeline | |
| Retention job | |

**Exit criteria:** Admin Logs page live; exports work; no secrets in payloads.

**Depends on:** Phase 1+ (instrumentation throughout)  
**Risk:** low if volume controlled

---

## Phase 9 — Settings

**Goal:** Global platform settings + notifications + credits/plans admin.

| Deliverable | Detail |
|-------------|--------|
| `platform_settings` + feature flags | |
| Admin settings APIs | group patch |
| Plans/credits Admin | full CRUD + ledger grants |
| Notification templates | compose/schedule |
| License/security fields | Super Admin only |

**Exit criteria:** Admin Settings/Plans/Credits/Notifications pages operational.

**Depends on:** Phase 1–3, 8  
**Risk:** low–medium

---

## Phase 10 — Optimization

**Goal:** Performance, cost, reliability hardening.

| Deliverable | Detail |
|-------------|--------|
| Query indexes review | |
| Cache KPI/analytics | |
| Provider cost dashboards | |
| Rate-limit tuning | |
| Storage lifecycle policies | |
| Load tests on publish + AI | |
| Remove Admin mocks | `BACKEND_READY=true` everywhere |
| Deprecate legacy `/app/admin` or redirect | |

**Exit criteria:** SLOs defined (p95 API, queue lag, error budgets); mocks removed from Admin.

**Depends on:** Phases 1–9

---

## Suggested timeline (indicative)

| Phase | Relative effort |
|-------|-----------------|
| 1 Auth foundation | 1–2 weeks |
| 2 Providers | 2–3 weeks |
| 3 Models | 1–2 weeks |
| 4 Workspace APIs | 3–5 weeks |
| 5 Publishing | 2–4 weeks |
| 6 Analytics | 2–3 weeks |
| 7 Queue | 2–3 weeks |
| 8 Logs | 1–2 weeks |
| 9 Settings | 2–3 weeks |
| 10 Optimization | ongoing |

Parallelization: Phase 8 instrumentation can start early; Phase 6 can overlap late Phase 5; Phase 9 plans/credits can start after Phase 4 tenancy.

---

## Definition of done (program)

- [ ] All Admin Console pages load from APIs (no mock modules required)  
- [ ] Workspace critical paths audited and credit-safe  
- [ ] RBAC enforced server-side per [rbac.md](./rbac.md)  
- [ ] Provider secrets encrypted; health + fallback live  
- [ ] Queue visible and controllable  
- [ ] Logs retained/redacted per policy  
- [ ] Docs updated when contracts change  
- [ ] Production build + API tests green  

---

## Out of scope for early phases

- Redesigning frontend Admin/Workspace UI  
- Changing PocketBase auth UX flows  
- Multi-region active-active  
- Full Stripe billing (stub external IDs until dedicated billing phase if needed)  
