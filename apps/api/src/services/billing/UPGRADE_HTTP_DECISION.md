# Phase 3.7 — `upgradeSubscription()` HTTP Exposure Decision

**Decision:** **Option A (keep internal)** + **Option C (admin override for operations)**

**Date:** Phase 3.7 audit  
**Baseline:** Billing 255/255 (Phases 0–3.6 certified)

---

## Summary

`upgradeSubscription()` remains **internal-only**. There is **no** workspace HTTP upgrade route (`POST /workspace/v1/subscription/upgrade` was **not** implemented).

Paid plan changes for workspace owners must use:

1. **`POST /workspace/v1/subscription/checkout`** — starts provider checkout; activation only after verified webhook fulfillment (Paddle Phase 3.4+, PayPal Phase 3.6+).
2. **`POST /workspace/v1/subscription/change`** — **free / $0 plans only**; paid targets return `402 CHECKOUT_REQUIRED`.

Operational / support plan moves use:

3. **`POST /admin/plans/assign`** — Phase 3.3 hardened `assignWorkspacePlan()` with required `reason`, override metadata, audit, and entitlement sync.

---

## Call graph

```
upgradeSubscription()
  └── exported from billing/index.js
  └── implemented in billing/subscriptions.js
  └── callers: NONE (no routes, no scheduler, no other services)

Workspace HTTP (does NOT call upgradeSubscription):
  GET  /workspace/v1/subscription          → getWorkspaceSubscription()
  POST /workspace/v1/subscription/change   → changeWorkspacePlan() [free only]
  POST /workspace/v1/subscription/checkout   → startWorkspaceSubscriptionCheckout()

Admin HTTP (does NOT call upgradeSubscription):
  POST /admin/plans/assign                 → assignWorkspacePlan() [Phase 3.3]
```

---

## Provider capability findings

| Provider | `changeSubscriptionPlan()` | Remote confirmation | Safe for HTTP upgrade? |
|----------|---------------------------|---------------------|------------------------|
| **Paddle** | Stub: `{ changed: false }` | No API call | **No** |
| **PayPal** | Stub: `{ changed: false }` | No API call | **No** |
| **Stripe** | Stub: `{ changed: false }` | No API call | **No** |
| **Lemon Squeezy** | Stub: `{ changed: false }` | No API call | **No** |
| **none** | `{ localOnly: true }` | N/A (no billing) | N/A |

No provider returns `changed: true` with provider-confirmed plan mutation. Option B prerequisites are **not met**.

---

## Security analysis

### Internal `upgradeSubscription()` behavior

1. Calls `provider.changeSubscriptionPlan()`.
2. On provider throw: coerces to `{ localOnly: true }`.
3. Applies **immediate local entitlement write** when:
   ```js
   immediate || remote.localOnly !== false
   ```
   Because `immediate` defaults to `true` and provider stubs omit `localOnly: false`, the local path runs for **all** providers including Paddle/PayPal.

4. Local path mutates:
   - `workspace_subscriptions.plan`
   - `credits_balance` (may increase via `Math.max(current, plan.credits)`)
   - `syncEntitlementMirrors()` → workspace + user mirrors
   - `logBillingAction()` (no idempotency key)

### Exposure risk

Exposing this over HTTP would allow **paid entitlement escalation without verified provider payment** for any workspace on a paid provider.

### Current mitigations (production)

- Function is **not wired to any HTTP route**.
- Workspace `changeWorkspacePlan()` **rejects paid plans** before any local mutation.
- Paid activation path is **checkout → verified webhook only**.
- Admin moves use **audited override**, not `upgradeSubscription()`.

---

## Product reasoning

| Need | Supported path |
|------|----------------|
| User upgrades to paid plan | Checkout + webhook fulfillment |
| User switches to free plan | `POST /subscription/change` |
| Support / staff correction | `POST /admin/plans/assign` with reason |
| Provider mid-cycle plan change API | **Not implemented** — defer until provider adapters return confirmed remote change |

---

## Option B deferred criteria

Implement `POST /workspace/v1/subscription/upgrade` only when **all** are true:

- Provider adapter performs real remote plan change (or proration checkout) and returns `{ changed: true, localOnly: false }` with verifiable provider reference.
- HTTP handler rejects local-only responses for paid plans (fail-closed).
- Idempotency + audit + entitlement sync on confirmed success only.
- Paddle/PayPal verified webhook parity preserved for activation/renewal paths.

---

## Files touched in Phase 3.7

- This document (`UPGRADE_HTTP_DECISION.md`)
- JSDoc on `upgradeSubscription()` (internal-only notice)
- `upgrade-subscription-gate.test.js` (focused gate tests)

**No HTTP route added. No provider/webhook/scheduler/registry changes.**
