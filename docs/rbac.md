# Chef IA — RBAC Blueprint

> Documentation only. Frontend today gates Admin Console with `user.role === 'admin'`.  
> PocketBase today: `users.role` ∈ {`member`, `admin`}.  
> This document defines the **target** permission model for backend enforcement.

Related: [database-schema.md](./database-schema.md) · [api-contracts.md](./api-contracts.md) · [backend-integration-plan.md](./backend-integration-plan.md)

---

## 1. Role model

### 1.1 Platform roles (global)

| Role | Scope | Description |
|------|-------|-------------|
| **Super Admin** | Platform | Full console + secrets + billing overrides + destroy operations |
| **Admin** | Platform | Operate Admin Console; manage users/workspaces/providers/models/queue/logs; cannot rotate master encryption keys without Super Admin |
| **API Client** | Key-scoped | Machine access via `api_keys`; scopes subset of workspace APIs; never Admin Console |

### 1.2 Workspace roles (tenant)

| Role | Description |
|------|-------------|
| **Workspace Owner** | Full control of one workspace: billing, members, integrations, delete |
| **Editor** | Create/edit content, publish, manage templates/brand kits/websites/Pinterest (non-billing) |
| **Author** | Create drafts, generate AI content, schedule; limited publish settings |
| **Viewer** | Read-only dashboards, analytics, history |

### 1.3 Mapping from current data

| Today | Target |
|-------|--------|
| `users.role = admin` | Platform **Admin** (promote subset to Super Admin via allow-list / `platform_role`) |
| `users.role = member` | No platform privilege; workspace role from `workspace_members.role` |
| Personal owner of records | Backfill as **Workspace Owner** of personal workspace |
| New `api_keys` | **API Client** |

Recommended field additions (future migration — not in this task):

- `users.platform_role`: `none` \| `admin` \| `super_admin`
- Keep `users.role` during transition or deprecate after dual-write

---

## 2. Permission vocabulary

Use capability strings in policy checks and API key scopes:

```
platform.admin.access
platform.users.read | platform.users.write
platform.workspaces.read | platform.workspaces.write
platform.plans.read | platform.plans.write
platform.credits.read | platform.credits.write
platform.providers.read | platform.providers.write | platform.providers.secrets
platform.models.read | platform.models.write
platform.analytics.read
platform.queue.read | platform.queue.control
platform.logs.read | platform.logs.export
platform.notifications.write
platform.settings.read | platform.settings.write
platform.system.read | platform.system.control

workspace.read
workspace.members.manage
workspace.billing.manage
workspace.websites.manage
workspace.wordpress.publish
workspace.pinterest.manage
workspace.pinterest.publish
workspace.content.write
workspace.content.publish
workspace.ai.generate
workspace.templates.manage
workspace.brandkits.manage
workspace.analytics.read
workspace.settings.manage
workspace.api_keys.manage
workspace.exports.create
```

---

## 3. Default capability grants

| Capability | Super Admin | Admin | Owner | Editor | Author | Viewer | API Client* |
|------------|:-----------:|:-----:|:-----:|:------:|:------:|:------:|:-----------:|
| `platform.admin.access` | ✓ | ✓ | | | | | |
| `platform.users.*` | ✓ | ✓ | | | | | |
| `platform.workspaces.*` | ✓ | ✓ | | | | | |
| `platform.plans.write` | ✓ | ✓ | | | | | |
| `platform.credits.write` | ✓ | ✓ | | | | | |
| `platform.providers.secrets` | ✓ | read† | | | | | |
| `platform.providers.write` | ✓ | ✓ | | | | | |
| `platform.models.write` | ✓ | ✓ | | | | | |
| `platform.analytics.read` | ✓ | ✓ | | | | | |
| `platform.queue.control` | ✓ | ✓ | | | | | |
| `platform.logs.export` | ✓ | ✓ | | | | | |
| `platform.settings.write` | ✓ | limited‡ | | | | | |
| `platform.system.control` | ✓ | ✓ | | | | | |
| `workspace.read` | ✓§ | ✓§ | ✓ | ✓ | ✓ | ✓ | scoped |
| `workspace.members.manage` | ✓§ | ✓§ | ✓ | | | | |
| `workspace.billing.manage` | ✓§ | ✓§ | ✓ | | | | |
| `workspace.websites.manage` | | | ✓ | ✓ | | | scoped |
| `workspace.wordpress.publish` | | | ✓ | ✓ | ✓ | | scoped |
| `workspace.pinterest.manage` | | | ✓ | ✓ | | | |
| `workspace.pinterest.publish` | | | ✓ | ✓ | ✓ | | scoped |
| `workspace.content.write` | | | ✓ | ✓ | ✓ | | scoped |
| `workspace.content.publish` | | | ✓ | ✓ | limited | | scoped |
| `workspace.ai.generate` | | | ✓ | ✓ | ✓ | | scoped |
| `workspace.templates.manage` | | | ✓ | ✓ | | | |
| `workspace.brandkits.manage` | | | ✓ | ✓ | | | |
| `workspace.analytics.read` | | | ✓ | ✓ | ✓ | ✓ | scoped |
| `workspace.settings.manage` | | | ✓ | limited | | | |
| `workspace.api_keys.manage` | | | ✓ | | | | |
| `workspace.exports.create` | | | ✓ | ✓ | ✓ | ✓ | scoped |

\* API Client: only explicitly granted scopes on the key.  
† Admin may update non-secret config and trigger tests; viewing raw secrets masked; Super Admin rotates secrets.  
‡ Admin can edit operational flags; Super Admin edits security/license/master keys.  
§ Platform roles access **any** workspace via Admin APIs only (impersonation/audit required for write).

---

## 4. Feature access matrix

Legend: **F**ull · **R**ead · **L**imited · **—** none · **A**dmin API only

### 4.1 Authentication & account

| Feature | Super Admin | Admin | Owner | Editor | Author | Viewer | API Client |
|---------|:-----------:|:-----:|:-----:|:------:|:------:|:------:|:----------:|
| Login / logout / refresh | F | F | F | F | F | F | — (key auth) |
| Signup (if enabled) | F | F | F | F | F | F | — |
| Password reset | F | F | F | F | F | F | — |
| OAuth Google connect | F | F | F | F | F | F | — |
| OAuth Pinterest connect | F | F | F | F | L | — | — |
| Manage own profile | F | F | F | F | F | F | — |
| Force logout others | F | F | L | — | — | — | — |
| Impersonate user | F | L | — | — | — | — | — |

### 4.2 Workspace product

| Feature | Super Admin | Admin | Owner | Editor | Author | Viewer | API Client |
|---------|:-----------:|:-----:|:-----:|:------:|:------:|:------:|:----------:|
| Dashboard | A/R | A/R | F | F | F | R | R |
| Websites CRUD | A | A | F | F | R | R | scoped |
| WP connection test | A | A | F | F | — | — | scoped |
| Website scan | A | A | F | F | L | — | scoped |
| Discovered articles | A | A | F | F | F | R | R |
| AI Writer generate | A | A | F | F | F | — | scoped |
| AI Writer save article | A | A | F | F | F | — | scoped |
| Publish to WordPress | A | A | F | F | L | — | scoped |
| Images studio | A | A | F | F | F | R | scoped |
| AI Pins pipeline | A | A | F | F | F | R | scoped |
| Templates | A | A | F | F | R | R | — |
| Brand kits | A | A | F | F | R | R | — |
| AI Pin history | A | A | F | F | F | R | R |
| Pinterest accounts | A | A | F | F | R | R | — |
| Pinterest publish/schedule | A | A | F | F | L | — | scoped |
| Calendar | A | A | F | F | F | R | R |
| Publishing history | A | A | F | F | F | R | R |
| Workspace analytics | A | A | F | F | R | R | R |
| Subscription / plan change | A | A | F | R | R | R | — |
| Workspace settings | A | A | F | L | L | R | — |

### 4.3 Admin Console

| Feature | Super Admin | Admin | Workspace roles | API Client |
|---------|:-----------:|:-----:|:---------------:|:----------:|
| `/admin/*` access | F | F | — | — |
| Users management | F | F | — | — |
| Workspaces management | F | F | — | — |
| Plans & credits | F | F | — | — |
| AI providers (config) | F | F | — | — |
| Provider secrets | F | L (masked) | — | — |
| AI models registry | F | F | — | — |
| Platform websites/Pinterest inventory | F | F | — | — |
| Platform analytics | F | F | — | — |
| Queue monitor / control | F | F | — | — |
| Jobs list | F | F | — | — |
| Logs & audit | F | F | — | — |
| Notifications compose | F | F | — | — |
| Global settings | F | L | — | — |
| System health / controls | F | F | — | — |

---

## 5. Authorization enforcement points

| Layer | Responsibility |
|-------|----------------|
| **PocketBase API rules** | Coarse owner/membership for direct SDK calls |
| **Express `/hcgi/api` middleware** | Resolve user + workspace membership + capability; reject before handlers |
| **Admin middleware** | Require `platform.admin.access`; audit every mutation |
| **Worker/queue** | Jobs carry `workspace` + `owner`; workers do not trust client-supplied credits |
| **API keys** | Hash compare; scope intersection; rate limit per key |

### Decision algorithm (workspace request)

1. Authenticate (PB session or API key).  
2. Resolve `workspaceId` (header, path, or resource ownership).  
3. Load membership (or platform role).  
4. Require capability for route.  
5. Enforce plan limits (credits, seats, feature flags).  
6. Proceed; emit audit for sensitive actions.

### Decision algorithm (admin request)

1. Authenticate.  
2. Require platform Admin or Super Admin.  
3. For secret/destructive ops, require Super Admin.  
4. Always write `audit_logs`.

---

## 6. Error codes (authz)

| HTTP | Code | When |
|------|------|------|
| 401 | `UNAUTHENTICATED` | Missing/invalid session or key |
| 403 | `FORBIDDEN` | Authenticated but lacks capability |
| 403 | `WORKSPACE_SUSPENDED` | Workspace status blocks action |
| 403 | `PLAN_FEATURE_DISABLED` | Plan/feature flag denies |
| 403 | `ADMIN_REQUIRED` | Non-admin hits `/admin` APIs |
| 429 | `RATE_LIMITED` | Per user/key/IP |

Frontend mapping: show **Access restricted** (already used in AdminRoute) or toast + empty error state.

---

## 7. Sensitive operations (dual control)

Require **Super Admin** (or Admin + confirmation token):

- Delete workspace  
- Grant/revoke platform Admin  
- Rotate provider master secrets  
- Disable registration / maintenance mode  
- Export full audit logs  
- Purge user PII  
- Pause global publish queue  

All must be audited with IP, actor, before/after metadata (redacted).
