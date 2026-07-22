# Chef IA — API Contracts

> Documentation only. Describes **existing** Workspace APIs under `/hcgi/api` and **proposed** Admin APIs under `/hcgi/api/admin/v1`.  
> Auth today: PocketBase session encoded as `Authorization: Bearer` (see `getPocketbaseAuthHeader`). Do not change auth in this planning phase.

Related: [rbac.md](./rbac.md) · [database-schema.md](./database-schema.md) · [backend-integration-plan.md](./backend-integration-plan.md)

---

## 0. Shared conventions

### 0.1 Error envelope

```ts
interface ApiError {
  message: string;
  errorCode: string;
  details?: Record<string, unknown>;
}
```

### 0.2 Pagination

```ts
interface PageQuery {
  page?: number;      // default 1
  perPage?: number;   // default 20, max 100
  q?: string;
  sort?: string;      // e.g. "-created"
}

interface Page<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}
```

### 0.3 Common enums

```ts
type PlanCode = 'free' | 'starter' | 'pro' | 'agency';
type PlatformRole = 'none' | 'admin' | 'super_admin';
type WorkspaceRole = 'owner' | 'editor' | 'author' | 'viewer';
type JobStatus =
  | 'queued' | 'waiting' | 'running' | 'completed'
  | 'failed' | 'retrying' | 'paused' | 'cancelled';
type JobPriority = 'low' | 'normal' | 'high' | 'critical';
type ProviderStatus = 'healthy' | 'degraded' | 'down' | 'disabled';
```

---

## 1. Authentication surfaces (document current; no redesign)

| Concern | Contract |
|---------|----------|
| Login | PocketBase `users.authWithPassword` |
| Signup | PB create + auth + verification |
| OAuth | PB `authWithOAuth2` (google, pinterest) |
| Password reset | PB `requestPasswordReset` |
| API calls | Bearer with encoded `{ token, record }` |

**Frontend loading/error:** auth pages show form pending + inline errors; AdminRoute shows skeleton then restricted UI.

---

## 2. Workspace APIs (existing + gaps)

Base: `/hcgi/api`

### 2.1 Health

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/health` (or health-check route) | public/limited | `{ status: 'ok' }` |

---

### 2.2 Websites

| Method | Path | Body / Query | Response |
|--------|------|--------------|----------|
| GET | `/websites` | — | `Website[]` |
| POST | `/websites` | `{ name, url, wp_username, wp_app_password }` | `Website` |
| GET | `/websites/:id` | — | `Website` |
| PATCH | `/websites/:id` | partial Website | `Website` |
| DELETE | `/websites/:id` | — | `{ ok: true }` |
| POST | `/websites/metadata` | `{ url }` | metadata DTO |
| POST | `/websites/:id/scan` | — | `{ scanRunId, status }` |
| GET | `/websites/:id/articles` | `page,perPage,q,status` | `Page<WebsiteArticle>` |

```ts
interface Website {
  id: string;
  name: string;
  url: string;
  domain?: string;
  status: 'untested' | 'connected' | 'failed' | 'active';
  discovery_status?: 'pending' | 'ready' | 'running' | 'failed';
  last_scan_at?: string;
  last_scan_summary?: Record<string, unknown>;
}
```

**Validation:** URL required/https preferred; credentials max length; name non-empty.  
**Authz:** `workspace.websites.manage` (write), read for members.  
**Errors:** `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `WP_AUTH_FAILED`.  
**UI:** WebsitesPage modal save; skeletons on list; toast on error.

---

### 2.3 WordPress

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/wordpress/test` | `{ websiteId }` or credentials | `{ ok, message }` |
| POST | `/wordpress/publish` | `{ websiteId, articleId?, title, content, status, ... }` | `{ postId, url, status }` |

**Errors:** `WP_AUTH_FAILED`, `WP_PUBLISH_FAILED`, `MEDIA_UPLOAD_FAILED`.  
**UI:** Writer publish buttons; loading overlay; error banner.

---

### 2.4 Integrated AI

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/integrated-ai/stream` | multipart/JSON prompt payload | SSE stream chunks |

**Authz:** `workspace.ai.generate` + credits.  
**Errors:** `INSUFFICIENT_CREDITS`, `PROVIDER_UNAVAILABLE`, `RATE_LIMITED`.  
**UI:** Writer/Images streaming; abort; error toast.

---

### 2.5 AI Pins

| Method | Path | Notes |
|--------|------|-------|
| GET | `/ai-pins/articles` | article picker |
| POST | `/ai-pins/manual-articles` | manual article create |
| GET | `/ai-pins/credits` | `{ ai, image, limits }` |
| GET/POST | `/ai-pins/brand-kits` | list/create |
| PUT/PATCH | `/ai-pins/brand-kits/:id` | update |
| DELETE | `/ai-pins/brand-kits/:id` | delete |
| POST | `/ai-pins/analyze` | analysis JSON |
| POST | `/ai-pins/prompts` | prompt pack |
| GET | `/ai-pins/history` | `page,perPage` filters |
| POST | `/ai-pins/pins/:id/editor` | save editor_state |

```ts
interface BrandKitDto {
  id: string;
  name: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  fontHeading?: string;
  fontBody?: string;
  watermarkText?: string;
  watermarkUrl?: string;
  websiteUrl?: string;
  isDefault?: boolean;
}
```

**UI:** AIPinsPage drawers; BrandKitPage forms; history export.

---

### 2.6 AI Pin images

| Method | Path | Body / Query |
|--------|------|--------------|
| POST | `/ai-pin-images/jobs` | `{ aiPinId, mode, prompt, clientToken, ... }` |
| GET | `/ai-pin-images/jobs` | `ids=` |
| POST | `/ai-pin-images/jobs/:id/regenerate` | — |

**Statuses:** `queued|processing|completed|failed|fallback`.  
**UI:** poll jobs; progress; regenerate.

---

### 2.7 Pinterest

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/pinterest/accounts` | list (`filter`) |
| POST | `/pinterest/oauth/start` | start OAuth |
| POST | `/pinterest/accounts/:id/reconnect` | reconnect |
| POST | `/pinterest/accounts/:id/disconnect` | disconnect |
| POST | `/pinterest/accounts/:id/default` | set default account |
| PATCH | `/pinterest/accounts/:id` | rename label |
| POST | `/pinterest/boards/sync` | sync boards |
| GET | `/pinterest/boards` | `accountId` |
| POST | `/pinterest/accounts/:id/boards/:boardId/default` | default board |
| POST | `/pinterest/publish` | publish now |
| POST | `/pinterest/schedule` | schedule |
| GET | `/pinterest/calendar` | `month=` |
| GET | `/pinterest/history` | filters + page |
| PATCH | `/pinterest/jobs/:id` | reschedule |
| POST | `/pinterest/jobs/:id/retry` | retry |
| POST | `/pinterest/jobs/:id/cancel` | cancel |
| GET | `/pinterest/analytics` | metrics |

```ts
interface PinterestPublishJob {
  id: string;
  status: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
  scheduled_at?: string;
  timezone?: string;
  board_id?: string;
  board_name?: string;
  pinterest_pin_url?: string;
  publish_error?: string;
  account_label?: string;
}
```

**Gaps:** Hub “Publish Now / Retry / Cancel” placeholders should call the same job endpoints.  
**UI:** Calendar drag-reschedule; history filters; analytics export.

---

### 2.8 Settings (workspace)

Existing `settings` route — document as profile/integration prefs proxied server-side.  
Target: move secrets to encrypted storage; prefs currently partially in `localStorage` (`chefia-workspace-prefs`) should sync via API.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/settings` | workspace + user prefs |
| PATCH | `/settings` | update non-secret prefs |
| POST | `/settings/export` | export bundle |
| POST | `/settings/import` | import bundle |

---

### 2.9 Direct PocketBase (still used by frontend)

Collections: `users`, `websites`, `articles`, `pins`, `ai_pins`, `ai_pin_templates`.  
**Target:** gradually route mutations through `/hcgi/api` for consistent validation, credits, and audit.

---

## 3. Admin APIs (proposed)

Base: `/hcgi/api/admin/v1`  
**Authz:** `platform.admin.access` on all routes.

### 3.1 Dashboard

| Method | Path | Query | Response |
|--------|------|-------|----------|
| GET | `/dashboard` | — | `AdminDashboardDto` |

```ts
interface AdminDashboardDto {
  stats: {
    activeUsers: number;
    workspaces: number;
    creditsUsed: number;
    aiRequests: number;
    revenue: number;
    serverHealth: string;
  };
  alerts: Array<{ id: string; text: string; tone: 'green' | 'amber' | 'red' }>;
  activity: Array<{ id: string; text: string; time: string }>;
  chart: Array<{ label: string; value: number }>;
}
```

**UI:** AdminDashboardPage skeletons → cards; error state banner.

---

### 3.2 Users

| Method | Path | Body / Query | Notes |
|--------|------|--------------|-------|
| GET | `/users` | `q,role,status,plan,registeredWithin,page,perPage` | list |
| GET | `/users/:id` | — | detail + workspaces/websites |
| PATCH | `/users/:id` | `{ name?, plan?, role?, status? }` | edit |
| POST | `/users/:id/suspend` | `{ reason? }` | |
| POST | `/users/:id/activate` | — | |
| POST | `/users/:id/reset-password` | — | sends reset email |
| DELETE | `/users/:id` | — | Super Admin; soft-delete preferred |

```ts
interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'invited' | 'suspended';
  plan: PlanCode;
  credits: number;
  workspaces: string[];
  created: string;
  lastLogin?: string;
  subscription?: { plan: string; renews?: string; seats?: number };
  websites?: Array<{ domain: string; status: string }>;
  activity?: Array<{ text: string; time: string }>;
}
```

**Validation:** email unique; plan enum; cannot demote last Super Admin.  
**Errors:** `USER_NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`.  
**UI:** table filters, drawer, disabled mutations until wired; empty/pagination states exist.

---

### 3.3 Workspaces

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/workspaces` | filters: `q,plan,status,createdWithin,creditsRange,page` |
| GET | `/workspaces/:id` | detail + connections |
| PATCH | `/workspaces/:id` | name/plan/status/limits |
| POST | `/workspaces/:id/suspend` | |
| POST | `/workspaces/:id/activate` | |
| POST | `/workspaces/:id/transfer` | `{ newOwnerUserId }` |
| DELETE | `/workspaces/:id` | Super Admin |

```ts
interface AdminWorkspace {
  id: string;
  name: string;
  owner: string;
  ownerEmail: string;
  plan: PlanCode;
  credits: number;
  creditsUsed: number;
  status: 'active' | 'trial' | 'suspended';
  created: string;
  lastActivity?: string;
  websites: string[];
  pinterestConnected: boolean;
  wordpressConnected: boolean;
  storageUsedGb: number;
  storageLimitGb: number;
}
```

**UI:** AdminWorkspacesPage table + drawer empty sections.

---

### 3.4 Plans & credits

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/plans` | catalog |
| POST | `/plans` | create |
| PATCH | `/plans/:id` | update |
| POST | `/plans/:id/duplicate` | |
| POST | `/plans/:id/enable` / `/disable` | |
| DELETE | `/plans/:id` | if no active subs |
| GET | `/credits/summary` | issued/burned/avg/topups |
| GET | `/credits/ledger` | `page`, workspace filter |
| POST | `/credits/grant` | `{ workspaceId, amount, reason }` |

```ts
interface PlanDto {
  id: string;
  code: PlanCode | string;
  name: string;
  price: number;
  status: 'active' | 'deprecated' | 'hidden';
  credits: number;
  bonusCredits: number;
  rollover: boolean;
  topupAllowed: boolean;
  subscribers: number;
  limits: Record<string, unknown>;
}
```

**UI:** AdminPlansPage cards/drawer; AdminCreditsPage stats + ledger.

---

### 3.5 Providers

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/providers` | list (secrets masked) |
| GET | `/providers/:id` | detail + health history |
| PATCH | `/providers/:id` | public config |
| PUT | `/providers/:id/secrets` | Super Admin; write secrets |
| POST | `/providers/:id/test` | health/test call |
| POST | `/providers/:id/enable` / `/disable` | |

```ts
interface ProviderDto {
  id: string;
  code: string;
  name: string;
  status: ProviderStatus;
  enabled: boolean;
  health: string;
  currentModel?: string;
  endpoint?: string;
  rateLimit?: string;
  lastSuccess?: string;
  lastError?: string;
  models: string[];
  config: {
    apiKeyMasked?: string;
    baseUrl?: string;
    timeout?: number;
    retryPolicy?: string;
    defaultModel?: string;
  };
}
```

**UI:** AdminProvidersPage configure/test drawers; save disabled until backend.

---

### 3.6 Models

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/models` | filters capability/provider/status/q/page |
| GET | `/models/:id` | |
| POST | `/models` | |
| PATCH | `/models/:id` | |
| POST | `/models/:id/enable` / `/disable` | |
| POST | `/models/:id/default` | set default for capability |
| DELETE | `/models/:id` | |

```ts
interface ModelDto {
  id: string;
  name: string;
  provider: string;
  capability: 'text' | 'image' | 'vision' | 'embedding';
  contextWindow: number;
  inputCost: number;
  outputCost: number;
  isDefault: boolean;
  status: 'active' | 'deprecated' | 'disabled';
  priority?: number;
  fallbackModelId?: string;
  capabilities: string[];
}
```

---

### 3.7 Admin websites & Pinterest inventory

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/inventory/websites` | `q,status,page` |
| GET | `/inventory/pinterest-accounts` | `q,status,page` |

Read-only cross-tenant views for AdminWebsitesPage / AdminPinterestPage.

---

### 3.8 Platform analytics

| Method | Path | Query | Response |
|--------|------|-------|----------|
| GET | `/analytics/overview` | `range=today\|7d\|30d\|90d\|custom&from&to` | KPIs + charts + breakdowns |
| GET | `/analytics/export` | same | CSV/JSON (Admin) |

Matches `platformAnalyticsMock` shape.

**UI:** range select, refresh, export disabled until wired.

---

### 3.9 Queue & jobs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/queue/summary` | counts + health |
| GET | `/queue/jobs` | rich filters + page |
| GET | `/queue/jobs/:id` | detail timeline/logs |
| POST | `/queue/jobs/:id/retry` | |
| POST | `/queue/jobs/:id/cancel` | |
| POST | `/queue/jobs/:id/pause` | |
| POST | `/queue/jobs/:id/resume` | |
| POST | `/queue/jobs/:id/requeue` | from DLQ |
| DELETE | `/queue/jobs/:id` | |
| POST | `/queue/pause` | global pause |
| POST | `/queue/resume` | |

```ts
interface QueueJobDto {
  id: string;
  type: string;
  workspace: string;
  owner: string;
  provider?: string;
  model?: string;
  priority: JobPriority;
  status: JobStatus;
  progress: number;
  worker?: string;
  created: string;
  started?: string;
  duration?: string;
  credits?: number;
  retries: number;
  failureReason?: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  timeline: Array<{ text: string; time: string }>;
  logs: string[];
}
```

**UI:** AdminQueuePage / AdminJobsPage filters, drawer actions, pagination.

---

### 3.10 Logs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/logs` | filters: date, type, severity, workspace, user, service, provider, q, page |
| GET | `/logs/:id` | detail |
| GET | `/logs/export` | same filters |
| GET | `/logs/security` | security subset |
| GET | `/logs/admin-activity` | |

```ts
interface AuditLogDto {
  id: string;
  category: string;
  severity: string;
  message: string;
  user?: string;
  workspace?: string;
  service?: string;
  action?: string;
  result?: string;
  ip?: string;
  duration?: number;
  provider?: string;
  model?: string;
  credits?: number;
  correlationId?: string;
  at: string;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  timeline?: Array<{ text: string; time: string }>;
}
```

**UI:** AdminLogsPage stream, drawer, bookmark local-only until backend bookmarks exist.

---

### 3.11 Notifications

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/notifications/templates` | list |
| POST | `/notifications/templates` | compose |
| PATCH | `/notifications/templates/:id` | |
| POST | `/notifications/templates/:id/schedule` | |
| POST | `/notifications/broadcast` | Super Admin |

---

### 3.12 Global settings

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/settings` | full `PlatformSettingsDto` |
| PUT | `/settings` | replace groups |
| PATCH | `/settings/:group` | `general\|ai\|content\|…` |
| GET | `/settings/feature-flags` | |
| PATCH | `/settings/feature-flags/:id` | `{ enabled }` |

Shape mirrors `platformSettingsMock.js`.

**Authz:** writes Super Admin for `security` / license; Admin for operational groups.

---

### 3.13 System health

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/system/health` | overall + services + resources |
| POST | `/system/checks/run` | trigger probes |
| GET | `/system/incidents` | |
| POST | `/system/alerts/:id/acknowledge` | |
| POST | `/system/alerts/:id/resolve` | |
| GET | `/system/certificates` | |

Matches `systemHealthMock` structure.

---

## 4. Page → API mapping (quick index)

| Page | Primary endpoints |
|------|-------------------|
| Login/Signup/Forgot | PocketBase auth |
| Dashboard | PB aggregates + accounts/calendar (existing) |
| Websites* | `/websites`, `/wordpress/test` |
| Writer | `/integrated-ai/stream`, PB articles, `/wordpress/publish` |
| Images | `/integrated-ai/stream`, PB pins |
| AI Pins* | `/ai-pins/*`, `/ai-pin-images/*`, `/pinterest/*` |
| Templates | PB `ai_pin_templates` |
| Brand Kit | `/ai-pins/brand-kits` |
| History | `/ai-pins/history` |
| Pinterest hub | `/pinterest/*` |
| Calendar / Pub history | `/pinterest/calendar`, `/history`, jobs |
| Analytics (app) | `/pinterest/analytics` |
| Subscription | PB `users.plan` → target `/billing/*` |
| Settings / Profile | PB users + `/settings` |
| Admin * | `/admin/v1/*` (proposed) |

---

## 5. Shared TypeScript interfaces (entities / DTOs)

```ts
/** Credit balance shown in AI Pins / billing */
interface CreditsDto {
  aiCreditsUsed: number;
  imageCreditsUsed: number;
  aiCreditsLimit: number;
  imageCreditsLimit: number;
  balance?: number;
}

interface WorkspaceMemberDto {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  status: 'active' | 'invited' | 'removed';
}

interface PlatformSettingsDto {
  general: Record<string, unknown>;
  ai: Record<string, unknown>;
  content: Record<string, unknown>;
  images: Record<string, unknown>;
  wordpress: Record<string, unknown>;
  pinterest: Record<string, unknown>;
  email: Record<string, unknown>;
  security: Record<string, unknown>;
  system: Record<string, unknown>;
  featureFlags: Array<{ id: string; label: string; enabled: boolean }>;
  license?: Record<string, unknown>;
}

type NotificationChannel = 'in_app' | 'email';
type NotificationTemplateStatus = 'draft' | 'scheduled' | 'active';

interface NotificationTemplateDto {
  id: string;
  title: string;
  channel: NotificationChannel;
  status: NotificationTemplateStatus;
  body?: string;
}
```

---

## 6. Frontend state contracts (all pages)

| State | Behavior |
|-------|----------|
| **Loading** | Skeleton rows/cards (`AdminSkeleton` / page spinners); disable submit |
| **Empty** | `AdminEmptyState` / workspace empty copy when filters yield 0 |
| **Error** | Inline banner or toast; `AdminErrorState` for hard failures; map `errorCode` |
| **Partial** | Show stale data + “last refreshed” when refresh fails |
| **Disabled mutations** | Until backend ready: keep buttons disabled with “Backend not available” (current Admin pattern) |

---

## 7. Rate limiting (API)

| Scope | Suggested default |
|-------|-------------------|
| Anonymous | low (health only) |
| Authenticated user | 120 req/min (align settings mock) |
| AI generate | stricter RPM + concurrent |
| Admin export | 10/hour |
| API key | per-key quota from plan |
