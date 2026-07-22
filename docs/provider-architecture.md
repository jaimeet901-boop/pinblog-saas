# Chef IA — Provider, Integrations & Platform Architecture

> Documentation only. Covers AI providers/models, WordPress, Pinterest, queue, analytics, logging, notifications, file storage, and security patterns.

Related: [database-schema.md](./database-schema.md) · [api-contracts.md](./api-contracts.md) · [implementation-roadmap.md](./implementation-roadmap.md)

---

## 1. AI provider abstraction

### 1.1 Goals

- Single internal interface for text, image, and multimodal calls  
- Hot-swappable defaults + per-request model override  
- Health-aware routing with fallback chain  
- Quota/credit accounting before and after calls  
- Secrets never leave encrypted storage / server memory unnecessarily  

### 1.2 Internal interface (conceptual)

```ts
interface AiProviderAdapter {
  code: ProviderCode;
  healthCheck(): Promise<HealthResult>;
  listModels(): Promise<RemoteModelMeta[]>;
  generateText(req: TextGenerationRequest): Promise<TextGenerationResult>;
  streamText?(req: TextGenerationRequest): AsyncIterable<TextChunk>;
  generateImage?(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
}
```

Router responsibilities:

1. Resolve provider + model from request → workspace plan allow-list → platform defaults.  
2. Reserve credits (optimistic).  
3. Execute with timeout + retries.  
4. On failure, try `fallback_model_id` / fallback provider.  
5. Finalize credits (burn or release).  
6. Emit AI audit log + metrics.

### 1.3 Supported providers

| Code | Vendor | Modes | Notes |
|------|--------|-------|-------|
| `openai` | OpenAI | text, image, vision | Primary text default candidate |
| `gemini` | Google Gemini | text, image, vision | Strong fallback |
| `claude` | Anthropic | text, vision | Long-context writing |
| `openrouter` | OpenRouter | multi | Gateway to many models |
| `deepseek` | DeepSeek | text | Cost-efficient |
| `mistral` | Mistral | text | EU-friendly option |
| `grok` | xAI | text | Optional |
| `replicate` | Replicate | image (models) | Image pipelines |
| `fal` | Fal.ai | image | Current image default in admin mocks |

---

## 2. Per-provider blueprint

Common columns for every provider:

| Concern | Spec |
|---------|------|
| **Configuration** | `endpoint`, `api_version`, `default_model`, `timeout_ms`, `retry_policy`, public headers/org |
| **Credential storage** | `ai_provider_secrets` ciphertext + KEK version; rotate without downtime |
| **Models** | Rows in `ai_models` linked by provider code |
| **Health check** | Lightweight authenticated probe every N minutes; status `healthy`/`degraded`/`down` |
| **Quota tracking** | Provider rate-limit headers + internal RPM/TPM counters; workspace credit ledger |
| **Retry strategy** | Exponential backoff on 429/5xx; no retry on 400/401/403 |
| **Timeout policy** | Text stream: 60–120s; image: 120–300s; health: 5s |
| **Fallback strategy** | Model-level then provider-level chain from platform settings |

### OpenAI

| Item | Value |
|------|-------|
| Config | Base `https://api.openai.com/v1`, org optional |
| Credentials | `api_key`, optional `organization_id` |
| Models (examples) | `gpt-4.1`, `gpt-4.1-mini`, `gpt-image-1` |
| Health | `GET /models` or tiny chat completion |
| Quota | Track TPM/RPM; map usage → credits |
| Retry | 3× exponential, honor `Retry-After` |
| Timeout | 60s non-stream; stream idle 30s |
| Fallback | → Gemini flash / OpenRouter twin |

### Gemini

| Item | Value |
|------|-------|
| Config | Google AI / Vertex endpoint flag |
| Credentials | `api_key` or service account (encrypted) |
| Models | `gemini-2.5-flash`, `gemini-2.5-pro` |
| Health | models.list |
| Quota | project quotas + internal credits |
| Retry | 3× on 429/503 |
| Timeout | 60–90s |
| Fallback | → OpenAI mini / DeepSeek |

### Claude

| Item | Value |
|------|-------|
| Config | Anthropic API base |
| Credentials | `api_key` |
| Models | `claude-sonnet-4`, `claude-haiku` (registry-driven) |
| Health | tiny messages call |
| Quota | token usage → credits |
| Retry | 2–3×; respect overload |
| Timeout | 90s |
| Fallback | → OpenAI / Gemini |

### OpenRouter

| Item | Value |
|------|-------|
| Config | `https://openrouter.ai/api/v1`, site headers |
| Credentials | `api_key` |
| Models | Passthrough registry entries (`vendor/model`) |
| Health | `/models` |
| Quota | credit balance webhook optional |
| Retry | 3× |
| Timeout | 90s |
| Fallback | Direct provider if OpenRouter down |

### DeepSeek / Mistral / Grok

Same adapter pattern: chat completions compatible where possible; registry defines quirks (`supports_json_mode`, `supports_tools`).

### Replicate / Fal.ai (image)

| Item | Value |
|------|-------|
| Config | model version pins, webhook URL for async |
| Credentials | `api_key` |
| Models | e.g. Fal `flux-pro`; Replicate model versions |
| Health | account/model probe |
| Quota | concurrent job limits + credits |
| Retry | poll failures; re-queue up to `max_attempts` |
| Timeout | submit 15s; poll overall 5–10 min |
| Fallback | featured image / alternate image provider |

---

## 3. Model registry

Each `ai_models` record:

| Field | Purpose |
|-------|---------|
| Capabilities | `text`, `image`, `vision`, `embedding`, streaming, tools, json |
| Pricing | `input_cost_per_1k`, `output_cost_per_1k` (USD) → credit formula |
| Token limits | `context_window`, `max_output_tokens` |
| Availability | enabled regions, plan allow-list |
| Priority | integer; lower = preferred within capability |
| Fallback chain | `fallback_model_id` → next; platform default chain as last resort |

**Resolution order:**

1. Explicit request model (if allowed)  
2. Workspace/plan default  
3. Platform default for capability  
4. Fallback chain while providers healthy  

---

## 4. WordPress integration

### Authentication

- Application password or equivalent stored encrypted per `websites` (migrate off plaintext field).  
- Test endpoint validates credentials without publishing.

### Publishing

- Create/update post via WP REST (`/wp-json/wp/v2/posts`).  
- Map Chef IA article body → content/blocks; set title, slug, excerpt, status (`draft`/`publish`/`future`).  
- Categories/tags from platform or site defaults.

### Media upload

- Upload featured image to WP media library before post when required.  
- Persist media id on article metadata.

### Scheduling

- Prefer WP `future` status with `date_gmt`, or Chef IA scheduler that publishes at time.

### Retry

- Max 3 attempts; exponential backoff; classify auth errors as non-retryable.  
- Job type: `wordpress_publishing`.

### Error handling

| Class | Action |
|-------|--------|
| 401/403 | Mark site `failed`; notify owner; no retry |
| 404/invalid URL | Fail job; ask user to fix URL |
| 5xx / network | Retry then dead-letter |
| Validation | Return field errors to client |

---

## 5. Pinterest integration

### OAuth

- Existing flow: `POST /pinterest/oauth/start` → state in `pinterest_oauth_states` → callback → secrets in `pinterest_account_secrets`.  
- Reconnect refreshes tokens; mark `expired`/`error` on failure.

### Boards

- Sync via `POST /pinterest/boards/sync`; store `pinterest_boards`; default board per account.

### Publishing & scheduling

- Immediate: `POST /pinterest/publish`  
- Schedule: `POST /pinterest/schedule` → `pinterest_publish_jobs`  
- Workers claim jobs; create pin; write events; update `ai_pins`  

### Media upload

- Prefer hosted image URL accepted by Pinterest; otherwise upload binary from object storage.

### Retry

- Retryable: 429, 5xx, transient network.  
- Non-retryable: invalid board, revoked token (trigger reconnect).  
- Align with existing `attempt_count` / `max_attempts` fields.

### Error handling

- Surface `publish_error` on pin + job; calendar/history show failed; Admin queue mirrors jobs.

---

## 6. Queue system

### Job types

| Type | Source UI |
|------|-----------|
| `ai_article_generation` | Writer |
| `recipe_generation` | Writer variants |
| `image_generation` | Images / AI Pins |
| `ai_pin_analyze` | AI Pins |
| `ai_pin_prompt` | AI Pins |
| `pinterest_publishing` | Pins / Calendar |
| `wordpress_publishing` | Writer / WP |
| `bulk_publishing` | Admin / future |
| `seo_optimization` | Writer tools |
| `template_rendering` | Templates |
| `website_scan` | Website dashboard |
| `import` / `export` | Settings / history |
| `webhook_delivery` | Integrations |
| `email_notification` | Notifications |
| `analytics_sync` | Pinterest analytics worker |

### Priority levels

`low` < `normal` < `high` < `critical`  
Plan `priority_queue` elevates customer jobs.

### Retry policy

| Attempt | Delay |
|---------|-------|
| 1 | immediate / short |
| 2 | +30s (or exponential base) |
| 3 | +2m |
| max | mark `failed`, `dead_letter=true` |

### Workers

- Dedicated workers: AI text, AI image, Pinterest publish, WP publish, scan, email.  
- Heartbeats → Admin System Health `workersOnline`.  
- Idempotent claim via `claim_token` / version fields (already on publish jobs).

### Dead letter queue

- Failed after max attempts; Admin can Requeue / Delete.  
- Retain payload + last error for 14–30 days.

### Cancellation / pause

- `cancelled` terminal; `paused` holds claim.  
- Global pause queue (Admin) stops new claims.

### Progress events

- Write `platform_job_events` + optional SSE/WebSocket later.  
- Progress 0–100 for long jobs (matches Admin Queue UI).

---

## 7. Analytics

### Workspace metrics (existing `/pinterest/analytics`)

Pin impressions, saves, clicks, outbound; filter by account/board/date.

### Platform metrics (Admin Analytics)

| KPI | Aggregation |
|-----|-------------|
| Total/Active/New users | users + auth events |
| Workspaces active | workspaces.status |
| Articles / images / pubs | count by day |
| Credits consumed | credit_ledger burns |
| MRR / ARR | subscriptions × plans |
| Provider mix / top models | AI logs |
| Queue depth / fail rate | platform_jobs |
| System health | health_checks |

### Aggregation strategy

- Hot path: incremental counters / daily rollup tables (proposed `analytics_daily`).  
- Cold path: query raw events for custom ranges.  

### Storage & caching

- Rollups in PB or SQL sidecar; cache KPI responses 60–300s (platform `cacheTtl`).  

### Refresh policy

- User refresh button busts cache.  
- Background sync for Pinterest analytics (existing worker).  
- Admin ranges: today / 7d / 30d / 90d / custom.

---

## 8. Logging

| Stream | Contents | Retention |
|--------|----------|-----------|
| **Audit logs** | Authz, admin mutations, billing, secret access | 90d default |
| **System logs** | API errors, worker crashes, health | 30–90d |
| **Security logs** | Failed logins, rate limits, anomaly | 180d |
| **AI logs** | provider, model, tokens, latency, correlation (no secrets) | 30–90d |
| **Publishing logs** | WP/Pinterest attempts, responses redacted | 90d |

Redaction: API keys, app passwords, OAuth tokens, Authorization headers, WP passwords.

---

## 9. Notifications

| Channel | Use |
|---------|-----|
| **In-app** | Job failures, quota warnings, admin announcements |
| **Email** | Receipts, security alerts, digests (SMTP from settings) |
| **System alerts** | Worker down, provider down → Admin System |
| **Admin alerts** | Incident acknowledge/resolve workflow |

Templates managed in Admin Notifications; sends are queued as `email_notification` jobs.

---

## 10. File storage

| Asset | Store | Lifecycle |
|-------|-------|-----------|
| Generated images | Object storage + CDN URL on records | Plan storage quota |
| Uploads (logos) | Object storage | Soft-delete with brand kit |
| Exports (CSV/JSON) | Signed URL, short TTL | Auto-expire 24–72h |
| Logs archives | Cold bucket | Per retention |
| Backups | Encrypted snapshots | Daily schedule from settings |

PocketBase `_integratedAiImages` may remain for small AI artifacts; large pin images should prefer object storage.

---

## 11. Security architecture

| Topic | Design |
|-------|--------|
| **RBAC** | See [rbac.md](./rbac.md); enforce on API |
| **API keys** | Prefixed keys, hashed at rest, scoped, rotatable |
| **Secrets** | AES-GCM (or KMS) with `kek_version`; never in logs |
| **Encryption** | TLS in transit; secrets encrypted at rest |
| **Rate limits** | Global + per-user + per-key + per-IP (existing `globalRateLimit` pattern) |
| **CSRF** | OAuth `state`; cookie sessions would need CSRF tokens if cookie auth added — current Bearer model reduces CSRF |
| **CORS** | Allowlist from `CORS_ORIGIN` / platform settings |
| **Session** | PocketBase auth token; API uses encoded `{token,record}` header; timeout from settings (e.g. 7d) |
| **Helmet** | Already on API; keep |
| **Input sanitize** | Continue request sanitization middleware |

---

## 12. REST API structure (cross-cutting)

| Topic | Convention |
|-------|------------|
| Base | `/hcgi/api` (workspace) · `/hcgi/api/admin/v1` (admin) |
| Versioning | `/v1` for new admin routes; existing workspace routes stay stable, wrap under `/v1` when breaking |
| Auth | `Authorization: Bearer <pb-encoded-or-api-key>` |
| Pagination | `page`, `perPage` (max 100); response `{ items, page, perPage, totalItems, totalPages }` |
| Filtering | query params (`status`, `q`, `workspaceId`, date ranges) |
| Sorting | `sort=field` or `-field` |
| Idempotency | `Idempotency-Key` on publish/generate |
| Errors | `{ message, errorCode, details? }` |

See [api-contracts.md](./api-contracts.md) for full contracts.
