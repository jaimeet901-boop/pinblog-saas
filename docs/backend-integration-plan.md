# Chef IA SaaS — Backend Integration Plan

> **Status:** Architecture / documentation only  
> **Constraint:** This pack does **not** implement backend code, migrations, API routes, services, or frontend changes.  
> **Date baseline:** July 2026 · Commit context includes Admin Console polish (`ce59ed2`) and existing Workspace + `/hcgi/api` stack.

## Document map

| Doc | Contents |
|-----|----------|
| [api-contracts.md](./api-contracts.md) | Endpoints, schemas, validation, errors, shared TS types |
| [database-schema.md](./database-schema.md) | PocketBase collections existing + proposed |
| [rbac.md](./rbac.md) | Roles, capabilities, feature matrix |
| [provider-architecture.md](./provider-architecture.md) | AI providers/models, WP, Pinterest, queue, analytics, logs, storage, security |
| [implementation-roadmap.md](./implementation-roadmap.md) | Phases 1–10 |

---

## 1. Current architecture snapshot

```
┌─────────────────┐     Bearer {token,record}      ┌──────────────────┐
│  apps/web       │ ─────────────────────────────► │  apps/api        │
│  /app/*         │                                 │  /hcgi/api       │
│  /admin/* (UI)  │                                 │  workers: pins,  │
└────────┬────────┘                                 │  images, WP, …   │
         │ PB SDK                                    └────────┬─────────┘
         ▼                                                    │
┌─────────────────┐◄──────────────────────────────────────────┘
│  PocketBase     │
│  /hcgi/platform │
└─────────────────┘
```

| Surface | Backend today |
|---------|---------------|
| Auth | PocketBase users + OAuth |
| Workspace `/app/*` | Mix of PB CRUD + `/hcgi/api` (websites, AI Pins, Pinterest, WP, integrated AI) |
| Admin `/admin/*` | **Frontend mock only** (`BACKEND_READY = false`) |
| Legacy `/app/admin` | Live PB users list (read-only) |

**Integration goal:** Keep Workspace flows hardening; add **Admin `/hcgi/api/admin/v1`** + platform collections; unify jobs, credits, providers, logs; enforce RBAC server-side.

---

## 2. Cross-cutting frontend states (apply to every page)

| State | Requirement |
|-------|-------------|
| Loading | Skeletons/spinners; disable destructive actions |
| Empty | Explicit empty component when filters/list = 0 |
| Error | Map `errorCode` → toast/banner; retry where safe |
| Unauthorized | 401 → login; 403 → restricted copy (Admin already has pattern) |
| Success | Toast + cache invalidation / refetch |

---

## 3. Page-by-page backend requirements

For full request/response schemas see [api-contracts.md](./api-contracts.md). Below: integration checklist per page.

### 3.1 Authentication

| Page | APIs | Methods | Authz | Notes |
|------|------|---------|-------|-------|
| Login | PB `authWithPassword` | — | public | Loading on submit; invalid credentials error |
| Signup | PB create + auth | body: name, email, password | public if registration allowed | Default `plan=free`, `role=member` |
| Forgot password | PB `requestPasswordReset` | email | public | Always generic success message |
| OAuth | PB OAuth2 | google, pinterest | public | CreateData plan/role defaults |

**Do not redesign auth** in implementation phases without a dedicated auth project. Instrument audit only.

---

### 3.2 Workspace pages

#### Dashboard (`/app`)

| Item | Spec |
|------|------|
| Endpoints | Aggregate reads: websites, articles, pins, Pinterest accounts, calendar/history summaries |
| Methods | GET |
| Query | date window optional |
| Response | KPI DTO + health chips |
| Validation | — |
| Authz | `workspace.read` |
| Errors | 401/403/5xx |
| UI loading/error | Dashboard skeletons; soft-fail sections |

#### Websites (`/app/websites`)

| Item | Spec |
|------|------|
| Endpoints | `/websites` CRUD, `/wordpress/test` |
| Body | name, url, wp_username, wp_app_password |
| Authz | `workspace.websites.manage` |
| Errors | validation, WP auth failed |
| UI | Modal form pending; table empty state |

#### Website dashboard + articles

| Item | Spec |
|------|------|
| Endpoints | `POST /websites/:id/scan`, `GET /websites/:id/articles` |
| Query | page, perPage, q, status |
| Authz | websites manage / read |
| UI | Scan button loading; paginated list |

#### Writer (`/app/writer`)

| Item | Spec |
|------|------|
| Endpoints | `POST /integrated-ai/stream`, PB articles create/update, `POST /wordpress/publish` |
| Body | prompt/SEO fields; publish payload |
| Authz | `workspace.ai.generate`, `workspace.content.write`, `workspace.wordpress.publish` |
| Errors | credits, provider down, WP failures |
| UI | stream loading; save/publish error toasts |

#### Images (`/app/images`)

| Item | Spec |
|------|------|
| Endpoints | stream generate; PB `pins` |
| Authz | `workspace.ai.generate` |
| UI | generate pending; gallery empty |

#### AI Pins (`/app/ai-pins`)

| Item | Spec |
|------|------|
| Endpoints | `/ai-pins/*`, `/ai-pin-images/jobs*`, publish/schedule |
| Authz | content + AI + pinterest publish |
| UI | multi-step drawers; job polling skeletons |

#### Templates / Brand kit / AI Pin history

| Page | Endpoints | Authz |
|------|-----------|-------|
| Templates | PB `ai_pin_templates` (target: REST wrapper) | `workspace.templates.manage` |
| Brand kit | `/ai-pins/brand-kits` | `workspace.brandkits.manage` |
| History | `/ai-pins/history` | read + export |

#### Pinterest hub / Calendar / Publishing history / Analytics

| Page | Endpoints | Gaps |
|------|-----------|------|
| Pinterest | accounts, OAuth, boards, defaults | Wire hub Publish/Retry/Cancel placeholders |
| Calendar | calendar GET, job PATCH/retry/cancel | — |
| History | history GET + job actions | — |
| Analytics | `/pinterest/analytics` | export |

#### Subscription

| Item | Spec |
|------|------|
| Today | PB `users.update({ plan })` for free/starter/pro/agency |
| Target | `subscriptions` + billing provider; Admin plans catalog |
| Placeholders | Business/Enterprise, cards, invoices → future billing APIs |
| Authz | `workspace.billing.manage` for changes |

#### Settings / Profile

| Item | Spec |
|------|------|
| Live | profile name, password, OAuth connect/disconnect |
| Local | `chefia-workspace-prefs` → migrate to `/settings` |
| Unavailable | 2FA, delete workspace, sign-out-others → Phase 9+ |
| Authz | `workspace.settings.manage` / self profile |

#### Legacy Admin (`/app/admin`)

| Item | Spec |
|------|------|
| Today | PB users list read-only |
| Target | Redirect to `/admin/users` or keep as slim link-out |

---

### 3.3 Admin Console pages

All mutations currently disabled. Target base path: `/hcgi/api/admin/v1`.

#### Dashboard

| Required APIs | `GET /dashboard` |
| HTTP | GET |
| Response | stats, alerts, activity, chart |
| Authz | `platform.analytics.read` (or dashboard.read) |
| UI | mock → skeleton → live cards |

#### Users

| APIs | `GET/PATCH /users`, suspend/activate/reset-password/delete |
| Query | q, role, status, plan, registeredWithin, page |
| Body (PATCH) | name, plan, role, status |
| Authz | `platform.users.read/write` |
| Errors | not found, cannot demote last admin |
| UI | table, drawer, pagination, empty filters |

#### Workspaces

| APIs | list/detail/patch/suspend/activate/transfer/delete |
| Query | q, plan, status, creditsRange, page |
| Authz | `platform.workspaces.*` |
| UI | drawer connections empty states |

#### Plans & Credits

| APIs | plans CRUD; credits summary/ledger/grant |
| Authz | `platform.plans.*`, `platform.credits.*` |
| UI | plan cards; ledger list |

#### Providers

| APIs | list/detail/patch/secrets/test/enable/disable |
| Authz | providers write; secrets Super Admin |
| UI | configure + test drawers |

#### Models

| APIs | CRUD, enable/disable, set default |
| Query | provider, capability, status, context, q, page |
| Authz | `platform.models.*` |

#### Websites / Pinterest (inventory)

| APIs | `GET /inventory/websites`, `GET /inventory/pinterest-accounts` |
| Authz | platform read |
| UI | search/filter empty states (already polished) |

#### Analytics

| APIs | `GET /analytics/overview`, export |
| Query | range, from, to |
| Authz | `platform.analytics.read` |
| UI | KPI grid, charts, refresh |

#### Queue Monitor / Jobs

| APIs | summary, jobs list/detail, retry/cancel/pause/resume/requeue/delete, global pause |
| Query | type, status, priority, provider, workspace, date, q, page |
| Authz | `platform.queue.read/control` |
| UI | progress bars, drawer actions |

#### Logs

| APIs | list/detail/export + security/admin subsets |
| Query | severity, category, workspace, user, service, provider, date, q |
| Authz | `platform.logs.read/export` |
| UI | live refresh pulse; drawer detail |

#### Notifications

| APIs | templates CRUD, schedule, broadcast |
| Authz | `platform.notifications.write` |
| UI | compose disabled until live |

#### Global Settings

| APIs | GET/PUT settings; PATCH group; feature flags |
| Authz | settings read/write (security → Super Admin) |
| Body | mirrors `platformSettingsMock` |
| UI | local form → dirty save |

#### System Health

| APIs | health, run checks, incidents, ack/resolve alerts |
| Authz | `platform.system.read/control` |
| UI | service cards, resource charts |

---

## 4. PocketBase collections

See **[database-schema.md](./database-schema.md)** for fields, indexes, relationships, permissions, and examples.

**Summary:** keep existing Workspace collections; add `workspaces`, membership, plans, credits ledger, providers/models/secrets, platform jobs, audit logs, notifications, platform settings, API keys, health/incidents.

---

## 5. Roles & permissions

See **[rbac.md](./rbac.md)**.

Target roles: Super Admin, Admin, Workspace Owner, Editor, Author, Viewer, API Client — with full feature matrix.

---

## 6. AI providers & models

See **[provider-architecture.md](./provider-architecture.md)** §§1–3.

Providers: OpenAI, Gemini, Claude, OpenRouter, DeepSeek, Mistral, Grok, Replicate, Fal.ai — each with config, secrets, health, quota, retry, timeout, fallback.

Models: registry with capabilities, pricing, token limits, availability, priority, fallback chain.

---

## 7. WordPress & Pinterest

See **[provider-architecture.md](./provider-architecture.md)** §§4–5 and existing routes in [api-contracts.md](./api-contracts.md).

---

## 8. Queue, analytics, logging, notifications, storage

See **[provider-architecture.md](./provider-architecture.md)** §§6–10.

---

## 9. API structure & security

See [api-contracts.md](./api-contracts.md) §0 and [provider-architecture.md](./provider-architecture.md) §§11–12.

Highlights:

- Workspace: `/hcgi/api`  
- Admin: `/hcgi/api/admin/v1`  
- Versioning, pagination, filtering, sorting, rate limits  
- RBAC, API keys, encrypted secrets, CORS allowlist, Helmet, sanitize middleware  

---

## 10. Shared types

Canonical TypeScript interfaces live in [api-contracts.md](./api-contracts.md) (errors, pagination, enums, Admin DTOs, BrandKit, jobs, settings, credits).

Implementation tip: publish a future `packages/contracts` package — **not** created in this docs task.

---

## 11. Implementation order

See **[implementation-roadmap.md](./implementation-roadmap.md)**.

| Phase | Focus |
|------:|-------|
| 1 | Authentication foundation / admin gate / audit hooks |
| 2 | Providers |
| 3 | Models |
| 4 | Workspace APIs + tenancy |
| 5 | Publishing |
| 6 | Analytics |
| 7 | Queue |
| 8 | Logs |
| 9 | Settings (global + plans/credits/notifications) |
| 10 | Optimization |

---

## 12. Non-goals (this documentation pack)

- No backend code, services, workers, or route handlers added  
- No PocketBase migrations authored  
- No frontend or Admin/Workspace UI modifications  
- No authentication flow changes  
- No enabling of `BACKEND_READY`  

---

## 13. Readiness checklist for implementers

1. Read rbac + schema before writing any Admin route.  
2. Match Admin mock field names where practical to reduce UI churn.  
3. Prefer expanding `apps/api` routers (`routes/index.js`) with an `admin/` namespace.  
4. Dual-write jobs into `platform_jobs` while old queues remain.  
5. Flip Admin pages from mock → API one screen at a time with feature flags.  
6. Update these docs when contracts change (docs-as-code).
