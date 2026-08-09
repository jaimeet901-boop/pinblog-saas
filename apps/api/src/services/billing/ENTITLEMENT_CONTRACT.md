# Billing Entitlement Contract (Phase 1)

This document defines the intended entitlement source hierarchy for the Paddle billing rewrite.
**Phase 1 establishes the contract only.** Synchronization behavior is unchanged until Phase 2/3.

## Authoritative source

`workspace_subscriptions.plan` (relation → `plans` record) is the **authoritative** entitlement for server-side behavior:

- Feature access (`plan-access.js` → `resolveActivePlan(req.workspaceSubscription)`)
- Credit quota (`getSubscriptionPlan(subscription).credits`)
- Credit balance (`workspace_subscriptions.credits_balance`)
- Billing lifecycle state (`status`, `billing_status`, `provider`, period fields)

## Mirror fields

| Field | Role | Updated by (today) |
|-------|------|---------------------|
| `workspaces.plan_slug` | Workspace-level mirror for listings/DTOs | Free checkout, webhook fulfillment; **not** admin assign |
| `users.plan` | Auth record / sidebar UI mirror | Free checkout, webhook fulfillment (best-effort); **not** admin assign |

Mirrors may drift. Phase 1 adds `entitlement_sync_version` and `last_entitlement_sync_at` on
`workspace_subscriptions` to track future sync operations.

## Phase 1 schema additions (not yet enforced)

- `plans.billing_type`: `free` | `paid` — future replacement for price-heuristic `planIsPaid()`
- `workspace_subscriptions.activation_source`: how entitlement was activated
- `workspace_subscriptions.billing_source`: payment/admin origin metadata
- `workspace_subscriptions.billing_environment`: `sandbox` | `live` (nullable for legacy rows)
- Paddle identity fields: `paddle_customer_id`, `paddle_subscription_id`, `paddle_transaction_id`, `paddle_price_id`

## Intended future flow

```
Paddle verified webhook (Phase 2+)
        ↓
workspace_subscriptions.plan  ← authoritative write
        ↓ sync (Phase 3)
workspaces.plan_slug          ← mirror
        ↓ sync (Phase 3)
users.plan                      ← UI/auth mirror
```

## Non-authoritative UI sources

- Header / workspace switcher: `workspace_subscriptions` (via `GET /workspace/v1/workspaces`)
- Subscription page: `workspace_subscriptions` (via `GET /workspace/v1/subscription`)
- Sidebar user card: `users.plan` from AuthContext (may be stale)
