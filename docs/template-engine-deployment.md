# Template Engine — Deployment Notes

## PocketBase migrations

Apply in order (Engine-related):

- `1783980000` template engine collections  
- `1783981000` / `1783982000` template fields + uuid/revision  
- `1783983000` `ai_pin_generation_runs`

Verify with `apps/pocketbase/scripts/verify-template-engine-schema.mjs` when available.

## Environment

| Variable | Purpose |
|---|---|
| Existing PB / API env | Auth, workspace |
| `AI_IMAGE_QUEUE_POLL_MS` | Image worker poll |
| `AI_IMAGE_QUEUE_BATCH` | Jobs per tick |

Export pixel encode is client/worker-side today (`nativeWorker: false` on plans). Queue types `export` / `template_rendering` are ready for a future Node canvas worker.

## Preview cache

Invalidate by **config checksum**, not `updated` time. Upsert via workspace preview-cache routes after editor Preview/save if desired.

## Security checklist (ops)

- API-only PB rules for template collections (null list/view; API RBAC).
- Composed upload MIME allowlist already on `/ai-pin-images/composed`.
- Reject oversized template JSON (&gt; ~1.5MB) and private image hosts on create/update/import.
- Keep provider API keys in encrypted settings — never in template JSON.

## Rollback

Migrations are reversible (`down` deletes new collections / additive fields). Prefer soft-delete templates (`deleted_at`) over hard delete in production.
