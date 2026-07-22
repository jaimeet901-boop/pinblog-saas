# Chef IA — Database Schema Blueprint

> **Documentation only.** Do not treat this file as an executable migration.  
> Current runtime store: **PocketBase** (`/hcgi/platform`).  
> Status: **existing collections** vs **proposed** for Admin Console / multi-seat workspaces.

Related docs: [backend-integration-plan.md](./backend-integration-plan.md) · [api-contracts.md](./api-contracts.md) · [rbac.md](./rbac.md)

---

## 1. Design principles

| Principle | Rule |
|-----------|------|
| Source of truth | PocketBase collections for durable entities; object storage for binaries |
| Tenancy | Prefer `workspace` relation; today most records use `owner` → `users` |
| Secrets | Never store plaintext provider/OAuth secrets in listable fields; use `*_secrets` + encryption at rest |
| Soft deletes | Prefer `status` / `deleted_at` for users, workspaces, jobs; hard-delete only for ephemeral OAuth state |
| Indexes | Index foreign keys, status+created, and unique natural keys |
| Auditability | Mutations that affect billing, auth, providers, or publishing emit `audit_logs` |

### Migration path (conceptual)

1. Keep existing `owner`-scoped collections working for Workspace.  
2. Introduce `workspaces` + `workspace_members` (proposed).  
3. Backfill `workspace` from `owner` (1:1 personal workspace).  
4. Admin APIs query by workspace; Workspace APIs continue owner/workspace membership checks.

---

## 2. Collection inventory

### 2.1 Existing (in production migrations)

| Collection | Purpose |
|------------|---------|
| `users` | Auth users, plan, role, credit counters |
| `websites` | Customer WordPress sites |
| `articles` | AI Writer drafts / scheduled / published |
| `pins` | Simple image-studio pins (legacy/simple path) |
| `user_settings` | Per-user integration keys (legacy; migrate secrets off) |
| `website_articles` | Discovered WP article inventory |
| `brand_kits` | Brand kits for AI Pins |
| `ai_pins` | Pin generation pipeline records |
| `ai_pin_templates` | Pin template configurations |
| `ai_pin_image_jobs` | Image generation jobs |
| `ai_pin_generation_history` | AI Pins event history |
| `pinterest_accounts` | Connected Pinterest accounts (non-secret metadata) |
| `pinterest_boards` | Synced boards |
| `pinterest_publish_jobs` | Publish/schedule jobs |
| `pinterest_publish_events` | Job event trail |
| `pinterest_oauth_states` | OAuth CSRF/state |
| `pinterest_account_secrets` | Encrypted tokens |
| `_integratedAiMessages` | Integrated AI chat persistence |
| `_integratedAiImages` | Generated image files |

### 2.2 Proposed (Admin Console + platform ops)

| Collection | Purpose |
|------------|---------|
| `workspaces` | Tenant / billing unit |
| `workspace_members` | Membership + workspace roles |
| `plans` | Commercial plan catalog |
| `credit_ledger` | Credit grants, burns, adjustments |
| `subscriptions` | Workspace subscription state |
| `ai_providers` | Platform AI provider configs (non-secret) |
| `ai_provider_secrets` | Encrypted provider credentials |
| `ai_models` | Model registry |
| `platform_jobs` | Unified job queue (admin-visible) |
| `platform_job_events` | Job timeline / progress |
| `audit_logs` | Security + admin + domain audit |
| `system_logs` | Operational / infra logs (or ship to log store) |
| `notifications` | In-app notifications |
| `notification_templates` | Admin announcement templates |
| `platform_settings` | Singleton/global settings document |
| `feature_flags` | Feature flag records |
| `api_keys` | Workspace/API client keys |
| `health_checks` | Latest health probe results |
| `incidents` | System incidents / alerts |

---

## 3. Existing collections (detail)

### `users` (auth)

| Field | Type | Notes |
|-------|------|-------|
| `id` | text | PB id |
| `email` | email | unique |
| `emailVisibility` | bool | PB system |
| `verified` | bool | |
| `password` | password | |
| `name` | text | |
| `avatar` | file | optional |
| `plan` | select | `free` \| `starter` \| `pro` \| `agency` |
| `role` | select | Today: `member` \| `admin`. Target RBAC expands via membership + platform roles (see [rbac.md](./rbac.md)) |
| `ai_credits_used` | number | ≥ 0 |
| `image_credits_used` | number | ≥ 0 |
| `created` / `updated` | autodate | |

**Indexes:** unique `email`; index `role`; index `plan`.  
**Permissions (target):** self read/update profile; platform Admin+ list/manage; never expose password hashes.  
**Example:**

```json
{
  "id": "usr_01",
  "email": "leo@sundaykitchen.example",
  "name": "Leo Martins",
  "plan": "pro",
  "role": "member",
  "verified": true,
  "ai_credits_used": 420,
  "image_credits_used": 88
}
```

---

### `websites`

| Field | Type | Notes |
|-------|------|-------|
| `owner` | relation → users | required |
| `name` | text | |
| `url` | url | site base URL |
| `domain` | text | derived |
| `wp_username` | text | |
| `wp_app_password` | text | **migrate to secrets collection** |
| `status` | select | `untested` \| `connected` \| `failed` \| `active` |
| `discovery_status` | select | `pending` \| `ready` \| `running` \| `failed` |
| `favicon` | text/url | |
| `last_scan_at` | date | |
| `next_scan_at` | date | |
| `last_scan_summary` | json | |

**Indexes:** `owner`; `status`; unique `(owner, url)` preferred.  
**Relationships:** owner → users; optional future `workspace`.  
**Permissions:** owner / workspace members with Website permission; Admin read-all.

---

### `articles`

| Field | Type | Notes |
|-------|------|-------|
| `owner` | relation → users | |
| `keyword` | text | |
| `seo_title` | text | |
| `meta_description` | text | |
| `slug` | text | |
| `language` | text | |
| `country` | text | |
| `tone` | text | |
| `body` | json | structured recipe/HTML payload |
| `status` | select | `draft` \| `scheduled` \| `published` |
| `scheduled_at` | date | |

---

### `pins`

Simple gallery pins from Images studio.

| Field | Type |
|-------|------|
| `owner` | relation |
| `title` | text |
| `image_url` | url/text |
| `board` | text |
| `format` | select `square` \| `portrait` \| `landscape` |
| `status` | select `draft` \| `scheduled` \| `published` |
| `scheduled_at` | date |

---

### `user_settings`

Legacy per-user keys (`openai_key`, `gemini_key`, `fal_key`, `pinterest_token`, …).  
**Target:** deprecate in favor of platform `ai_providers` + encrypted secrets; keep only non-secret prefs if needed.

---

### `website_articles`

Discovered inventory from WP scans.

| Field | Type | Notes |
|-------|------|-------|
| `websiteId` | relation → websites | |
| `owner` | relation → users | |
| `url`, `slug`, `title`, `meta_description` | text | |
| `featured_image` | url/text | |
| `publish_date`, `last_modified_date` | date | |
| `category`, `author`, `language` | text | |
| `status` | select | `new` \| `imported` \| `published` |
| `source` | text | |
| `scan_run_id` | text | |

**Indexes:** `(websiteId, slug)`; `owner`; `status`.

---

### `brand_kits`

| Field | Type |
|-------|------|
| `owner` | relation |
| `name` | text |
| `logo_url` | text |
| `primary_color`, `secondary_color`, `accent_color` | text |
| `font_heading`, `font_body` | text |
| `watermark_text`, `watermark_url` | text |
| `website_url` | text |
| `is_default` | bool |

API layer exposes camelCase DTOs (`logoUrl`, …).

---

### `ai_pins`

| Field | Type | Notes |
|-------|------|-------|
| `owner` | relation | |
| `articleId` | text/relation | source article |
| `websiteId` | relation | |
| `brand_kit` | relation | |
| `image_prompt`, `overlay_text`, `title`, `description` | text | |
| `suggested_keywords`, `suggested_hashtags` | json | |
| `target_audience`, `tone_of_voice`, `language` | text | |
| `status` | select | `draft` \| `scheduled` \| `publishing` \| `published` \| `failed` |
| `image_url` | text | |
| `scheduled_at` | date | |
| `scheduled_timezone` | text | |
| `pinterest_board_id`, `pinterest_board_name` | text | |
| `pinterest_account_id`, `pinterest_account_label` | text | |
| `pinterest_pin_id`, `pinterest_pin_url` | text | |
| `publish_job_id` | text/relation | |
| `published_at` | date | |
| `publish_error` | text | |
| `performance` | json | |
| `image_source` | select | `featured` \| `ai_generated` \| `featured_fallback` |
| `image_generation_status` | select | `idle` \| `queued` \| `processing` \| `completed` \| `failed` \| `fallback` |
| `image_generation_error` | text | |
| `image_job_id` | text/relation | |
| `analysis` | json | |
| `cta`, `pinterest_category`, `style` | text | |
| `editor_state` | json | |
| `ai_credits_used`, `image_credits_used` | number | |

---

### `ai_pin_templates`

| Field | Type |
|-------|------|
| `owner` | relation |
| `name` | text |
| `thumbnail` | text/file |
| `configuration` | json |
| `is_default` | bool |

---

### `ai_pin_image_jobs`

| Field | Type | Notes |
|-------|------|-------|
| `owner` | relation | |
| `ai_pin` | relation | |
| `websiteId`, `articleId` | text/relation | |
| `client_token` | text | idempotency |
| `source_type` | select | `preview` \| `pin` |
| `image_mode` | select | `generate_ai` \| `use_featured` |
| `prompt` | text | |
| `prompt_payload` | json | |
| `featured_image_url`, `image_url` | text | |
| `status` | select | `queued` \| `processing` \| `completed` \| `failed` \| `fallback` |
| `attempt_count`, `max_attempts` | number | |
| `next_retry_at` | date | |
| `last_error` | text | |
| `completed_at` | date | |

**Indexes:** `status + next_retry_at`; `owner`; `ai_pin`.

---

### `ai_pin_generation_history`

| Field | Type |
|-------|------|
| `owner` | relation |
| `ai_pin`, `articleId`, `websiteId` | refs |
| `event_type` | select `analyze` \| `prompt` \| `image` \| `save` \| `edit` \| `bulk` |
| `prompt`, `image_url` | text |
| `analysis`, `metadata` | json |
| credit fields | number |

---

### Pinterest collections

#### `pinterest_accounts`

Metadata only: `owner`, `pinterest_user_id`, `username`, `label`, `account_name`, `profile_image_url`, `scope`, `connected`, `status` (`connected` \| `expired` \| `error`), `status_error`, `token_expires_at`, `last_sync_at`, `is_default`, `connected_at`.  
**Unique:** `(owner, pinterest_user_id)`.

#### `pinterest_boards`

`owner`, `account` → accounts, `board_id`, `name`, `thumbnail_url`, `description`, `privacy`, `is_default`, denormalized account labels.

#### `pinterest_publish_jobs`

`owner`, `ai_pin`, website/article refs, board fields, account relation, `scheduled_at`, `timezone`, `status` (`scheduled` \| `publishing` \| `published` \| `failed` \| `cancelled`), attempts/retry, pin ids/urls, `performance`, claim fields, `analytics_synced_at`.

#### `pinterest_publish_events`

`owner`, `job`, `event_type`, `message`, `payload`.

#### `pinterest_oauth_states`

`owner`, `state`, `expires_at`, `used`, optional `account_id`, `requested_label`.

#### `pinterest_account_secrets`

`owner`, `account`, encrypted `access_token`, `refresh_token`. **Admin list never returns these.**

---

### Integrated AI

#### `_integratedAiMessages`

`userId`, `role` (`user` \| `assistant`), `content` (json).

#### `_integratedAiImages`

`file` (jpeg/png/webp ≤ 20MB).

---

## 4. Proposed collections (detail)

### `workspaces`

| Field | Type | Notes |
|-------|------|-------|
| `name` | text | |
| `slug` | text | unique |
| `owner` | relation → users | primary owner |
| `plan` | select / relation → plans | |
| `status` | select | `active` \| `trial` \| `suspended` \| `closed` |
| `credits_balance` | number | |
| `credits_used` | number | |
| `storage_used_bytes` | number | |
| `storage_limit_bytes` | number | |
| `billing_email` | email | |
| `metadata` | json | |

**Indexes:** unique `slug`; `owner`; `status`; `plan`.  
**Example:**

```json
{
  "id": "ws_sunday",
  "name": "Sunday Kitchen",
  "slug": "sunday-kitchen",
  "owner": "usr_01",
  "plan": "pro",
  "status": "active",
  "credits_balance": 5000,
  "credits_used": 1240
}
```

---

### `workspace_members`

| Field | Type | Notes |
|-------|------|-------|
| `workspace` | relation | |
| `user` | relation | |
| `role` | select | `owner` \| `editor` \| `author` \| `viewer` |
| `status` | select | `active` \| `invited` \| `removed` |
| `invited_by` | relation | |
| `joined_at` | date | |

**Unique:** `(workspace, user)`.

---

### `plans`

| Field | Type | Notes |
|-------|------|-------|
| `code` | text | unique (`free`, `starter`, `pro`, `agency`, future `business`) |
| `name` | text | |
| `price_monthly_cents` | number | |
| `currency` | text | `USD` |
| `status` | select | `active` \| `deprecated` \| `hidden` |
| `credits` | number | monthly allocation |
| `bonus_credits` | number | |
| `rollover` | bool | |
| `topup_allowed` | bool | |
| `limits` | json | workspaces, WP sites, Pinterest accounts, storage, API |
| `ai_models` | json | allow-list |
| `publishing_limits` | json | |
| `features` | json | feature flags per plan |
| `priority_queue` | bool | |
| `support_tier` | text | |

---

### `subscriptions`

| Field | Type |
|-------|------|
| `workspace` | relation |
| `plan` | relation / code |
| `status` | `trialing` \| `active` \| `past_due` \| `canceled` |
| `current_period_start` / `end` | date |
| `seats` | number |
| `external_customer_id` | text |
| `external_subscription_id` | text |

---

### `credit_ledger`

| Field | Type | Notes |
|-------|------|-------|
| `workspace` | relation | |
| `user` | relation | actor |
| `type` | select | `grant` \| `burn` \| `refund` \| `adjust` \| `expire` |
| `amount` | number | signed or absolute + direction |
| `balance_after` | number | |
| `reason` | text | |
| `ref_type` / `ref_id` | text | job, pin, article |
| `metadata` | json | |

**Indexes:** `(workspace, created)`; `type`.

---

### `ai_providers`

| Field | Type | Notes |
|-------|------|-------|
| `code` | text | unique: `openai`, `gemini`, `claude`, … |
| `name` | text | |
| `category` | select | `text` \| `image` \| `multi` |
| `enabled` | bool | |
| `status` | select | `healthy` \| `degraded` \| `down` \| `disabled` |
| `endpoint` | url | |
| `api_version` | text | |
| `default_model` | text | |
| `rate_limit` | json | |
| `timeout_ms` | number | |
| `retry_policy` | json | |
| `health` | json | last check |
| `config_public` | json | non-secret knobs |
| `last_success_at`, `last_error_at` | date | |
| `last_error` | text | |

---

### `ai_provider_secrets`

| Field | Type |
|-------|------|
| `provider` | relation |
| `key_name` | text | `api_key`, `org_id`, … |
| `ciphertext` | text | |
| `kek_version` | text | |
| `rotated_at` | date |

---

### `ai_models`

| Field | Type | Notes |
|-------|------|-------|
| `provider` | relation / code | |
| `model_id` | text | provider native id |
| `display_name` | text | |
| `capability` | select | `text` \| `image` \| `vision` \| `embedding` |
| `capabilities` | json | array |
| `context_window` | number | |
| `max_output_tokens` | number | |
| `input_cost_per_1k` | number | |
| `output_cost_per_1k` | number | |
| `is_default` | bool | |
| `priority` | number | routing order |
| `status` | select | `active` \| `deprecated` \| `disabled` |
| `availability` | json | regions / quotas |
| `fallback_model_id` | text | |
| `features` | json | streaming, tools, json_mode |

**Unique:** `(provider, model_id)`.

---

### `platform_jobs`

Unified admin-visible queue (can wrap existing image/publish jobs or become the parent table).

| Field | Type | Notes |
|-------|------|-------|
| `type` | select | see Job Types in provider-architecture |
| `workspace` | relation | |
| `owner` | relation | |
| `priority` | select | `low` \| `normal` \| `high` \| `critical` |
| `status` | select | `queued` \| `waiting` \| `running` \| `completed` \| `failed` \| `retrying` \| `paused` \| `cancelled` |
| `progress` | number | 0–100 |
| `provider`, `model` | text | |
| `worker_id` | text | |
| `inputs`, `outputs` | json | |
| `credits` | number | |
| `attempt_count`, `max_attempts` | number | |
| `next_retry_at` | date | |
| `failure_reason` | text | |
| `correlation_id` | text | |
| `started_at`, `completed_at` | date | |
| `dead_letter` | bool | |

**Indexes:** `status + priority + created`; `workspace`; `type`; `correlation_id`.

---

### `platform_job_events`

`job`, `at`, `level`, `message`, `payload`.

---

### `audit_logs`

| Field | Type |
|-------|------|
| `category` | select `auth` \| `admin` \| `billing` \| `ai` \| `publishing` \| `security` \| `system` |
| `severity` | select `debug` \| `info` \| `warn` \| `error` \| `critical` |
| `actor_user` | relation | |
| `workspace` | relation | |
| `action` | text | |
| `result` | select `success` \| `denied` \| `failure` |
| `resource_type`, `resource_id` | text |
| `ip`, `user_agent` | text |
| `provider`, `model` | text |
| `credits` | number |
| `duration_ms` | number |
| `correlation_id` | text |
| `request`, `response`, `metadata` | json | redact secrets |

**Indexes:** `(created)`; `category + severity`; `actor_user`; `workspace`; `correlation_id`.  
**Retention:** default 90 days (configurable in platform settings).

---

### `notifications` / `notification_templates`

**notifications:** `user`, `workspace`, `channel` (`in_app` \| `email`), `title`, `body`, `severity`, `read_at`, `meta`.  
**notification_templates:** `code`, `title`, `body`, `channel`, `status` (`draft` \| `scheduled` \| `active`).

---

### `platform_settings`

Singleton (id fixed) or key/value rows:

| Key groups | Examples |
|------------|----------|
| `general` | platformName, timezone, allowRegistration, maintenanceMode |
| `ai` | defaultProvider/Model, fallback, temperature, streaming |
| `content` | articleLength, SEO defaults |
| `images` | default image provider/model, size, watermark |
| `wordpress` | default publish status, retry |
| `pinterest` | scheduling, retry, ratio |
| `email` | SMTP meta (secrets elsewhere), limits |
| `security` | sessionTimeout, passwordPolicy, require2fa, rate limits, CORS |
| `system` | logRetention, backupSchedule, cacheTtl, region |

---

### `api_keys`

| Field | Type |
|-------|------|
| `workspace` | relation |
| `name` | text |
| `prefix` | text | public prefix |
| `hash` | text | bcrypt/argon of secret |
| `scopes` | json | |
| `status` | `active` \| `revoked` |
| `last_used_at` | date |
| `created_by` | relation |

---

### `health_checks` / `incidents`

Probe snapshots and operational alerts for System Health admin page.

---

## 5. Relationships (ER overview)

```
users 1──* workspace_members *──1 workspaces 1──1 subscriptions *──1 plans
workspaces 1──* websites 1──* website_articles
workspaces 1──* articles | ai_pins | brand_kits | pins
ai_pins 1──* ai_pin_image_jobs
ai_pins 1──* pinterest_publish_jobs 1──* pinterest_publish_events
users 1──* pinterest_accounts 1──* pinterest_boards
pinterest_accounts 1──1 pinterest_account_secrets
ai_providers 1──* ai_models
ai_providers 1──* ai_provider_secrets
workspaces 1──* platform_jobs 1──* platform_job_events
workspaces 1──* credit_ledger
* ── audit_logs (polymorphic refs)
```

---

## 6. Indexing checklist

| Pattern | Apply to |
|---------|----------|
| FK indexes | every relation field |
| Status queues | `platform_jobs(status, priority, created)`, image/publish jobs |
| Time-range analytics | `audit_logs(created)`, `credit_ledger(created)`, publish jobs `published_at` |
| Uniques | emails, slugs, `(owner, pinterest_user_id)`, `(provider, model_id)`, API key prefix |
| Partial | optional “active only” indexes where engine supports |

---

## 7. Permissions summary (PocketBase rules target)

| Collection class | List/View | Create/Update/Delete |
|------------------|-----------|----------------------|
| Owner-scoped workspace data | member of workspace OR admin | role-gated (see rbac) |
| Secrets | never via public PB rules; API only | Admin / system |
| Plans / providers / models | authenticated read of non-secret | Super Admin / Admin |
| Audit logs | Admin+ | system append-only |
| Platform settings | Admin+ | Super Admin |

Exact rule expressions belong in a future migration PR — **not** created by this documentation task.

---

## 8. Example records (platform)

### `ai_providers`

```json
{
  "id": "prov_openai",
  "code": "openai",
  "name": "OpenAI",
  "category": "multi",
  "enabled": true,
  "status": "healthy",
  "endpoint": "https://api.openai.com/v1",
  "default_model": "gpt-4.1",
  "timeout_ms": 60000,
  "retry_policy": { "maxAttempts": 3, "backoff": "exponential", "baseMs": 500 }
}
```

### `platform_jobs`

```json
{
  "id": "job_9901",
  "type": "ai_article_generation",
  "workspace": "ws_sunday",
  "owner": "usr_01",
  "priority": "high",
  "status": "running",
  "progress": 68,
  "provider": "openai",
  "model": "gpt-4.1",
  "credits": 12,
  "attempt_count": 1,
  "max_attempts": 3,
  "correlation_id": "corr_abc123"
}
```
