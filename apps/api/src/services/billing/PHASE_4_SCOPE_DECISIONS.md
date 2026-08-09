# Phase 4.0 — Billing Scope Lock & Product Decisions

**Program:** Paddle Billing Rewrite — Phase 4: Billing Lifecycle Completion & Entitlement Hardening  
**Status:** Phase 4.0 — Scope Locked  
**Date:** 2026-08-09  
**Certified baseline:** Phases 0 → 3.8 complete · **289/289** billing tests passing  

This document locks product and engineering decisions for Phase 4. It is the authoritative reference for sub-phases 4.1 → 4.7. **No implementation is authorized by this document alone** — each sub-phase requires its own implementation plan, focused tests, and certification report before the next sub-phase begins.

---

## 1. Status

**Phase 4.0 — Scope Locked**

Phase 4 scope, refund policy, user cancellation contract, and admin drift contract are formally decided. Implementation begins at **Phase 4.1** only after explicit authorization for that sub-phase.

---

## 2. Certified baseline

| Item | Value |
|------|-------|
| Phases complete | 0 → 3.8 |
| Billing test baseline | **289/289** passing |
| Phase 3.8 | Yearly/monthly price registry resolution (backend) |
| Post-3.8 fix | Scheduler test timing flakes resolved in `subscriptions-lifecycle.test.js` |

Every Phase 4 sub-phase must preserve **289/289** as the minimum regression floor and add focused tests for its own behavior.

---

## 3. Refund / chargeback policy

### Decision

**Hybrid policy (derived from Options B + A + E):**

| Purchase type | Policy | Option basis |
|---------------|--------|--------------|
| **Recurring subscriptions** (Paddle, PayPal) | **Period-end downgrade** — entitlement remains until `current_period_end`; then downgrade to `free`, sync mirrors, set terminal billing status | **Option B** |
| **One-time credit packs** (Paddle verified pack fulfillment) | **Immediate strict handling** — on verified refund/chargeback/adjustment: claw back pack credits (clamp `purchased_credits` / `credits_balance`), persist audit, fail-closed if clawback would go negative without explicit policy | **Option A** |
| **Provider implementation** | Paddle first; PayPal parity where sale-reversal / refund events exist and can be API-verified | **Option E** |
| **Stripe / Lemon Squeezy** | **Deferred** — observe-only until Provider Hardening (Phase 4.7) unless explicitly approved | Out of Phase 4.2 scope |

### Options evaluated

| Option | Subscriptions | Credit packs | Verdict |
|--------|---------------|--------------|---------|
| **A — Immediate revoke** | Abrupt feature loss; conflicts with “paid through period” UX | Correct for one-time purchases | **Rejected for subscriptions**; **selected for packs** |
| **B — Period-end downgrade** | Aligns with existing `cancel_at_period_end` / period semantics; user keeps paid access until paid period ends | Too lenient — refunded packs should not remain spendable | **Selected for subscriptions** |
| **C — Credits-only clawback** | Leaves plan features active after refund — entitlement/fraud gap | Partial fix only | **Rejected** — insufficient for subscriptions |
| **D — Observe-only** | Current effective state; entitlement survives verified refund | Pack credits remain after refund | **Rejected** — fails fraud prevention |
| **E — Provider-scoped** | Required because Paddle and PayPal event shapes differ | Same | **Selected as implementation strategy** |

### Rationale

**Repository evidence:**

- Paddle webhook classifier routes subscription lifecycle via `transaction.completed` (activate/renew) and `subscription.canceled` (cancel). Refund/adjustment/chargeback event types are **not classified** and fall through to `ignored`.
- PayPal has verified activation/renewal/cancel paths; no refund fulfillment path exists.
- Generic `webhooks.js` cancel handling for Stripe/LS returns `{ cancelled: true }` without DB mutation — not a refund model.
- `revenue-aggregation.js` counts refund-like events for analytics only; no entitlement mutation.
- Paddle credit-pack fulfillment (Phase 3.4) credits `purchased_credits` with idempotency — refunds must reverse this explicitly.
- Subscription fulfillment sets `credits_balance` to plan quota; monthly reset uses `plan.credits` — subscription refund policy must not double-penalize legitimately consumed monthly quota before period end.

**Subscriptions — Option B:**

- **Customer experience:** User retains paid features until the end of the billing period they paid for (or already received via verified activation). Matches Paddle cancel-at-period-end semantics already partially implemented in `handlePaddleCancellation`.
- **Fraud prevention:** Prevents indefinite free use after refund by scheduling authoritative downgrade at period boundary; webhook + idempotency key prevents duplicate downgrades.
- **Implementation complexity:** Moderate — extends existing cancel/period-end patterns; does not require immediate credit pro-rata math.
- **Idempotency:** Refund/downgrade events must use scoped idempotency keys (e.g. `refund:{event_id}`) consistent with Phase 3 activation/renewal patterns.
- **Auditability:** `logBillingAction` + `webhook_events` status machine + `credit_transactions` for any credit adjustments at downgrade.

**Credit packs — Option A:**

- One-time purchases have no “period end” concept. Allowing pack credits to remain after verified refund is a direct fraud vector.
- Paddle pack fulfillment is API-verified today; refund handling must be equally verified before mutation.
- Clawback targets `purchased_credits` first, then reduces `credits_balance` — consistent with Phase 3.4 purchased-credit preservation model.

**Provider scope:**

- **Paddle:** Primary implementation in Phase 4.2 (transaction/adjustment/refund events as Paddle documents them, with API verification where required).
- **PayPal:** Parity for subscription sale reversals and pack refunds when events are verifiable; stub-only paths remain deferred.
- **Stripe / Lemon Squeezy:** Not in Phase 4.2 unless production-active and explicitly approved.

### Refund policy contract (normative)

1. **No entitlement mutation on unverified webhook payload alone** — same fail-closed principle as Phase 2–3 Paddle/PayPal fulfillment.
2. **Subscription refund/chargeback:** Set `billing_status` to a terminal refund state, schedule downgrade at `current_period_end` (or immediate downgrade only if period already ended). Do **not** revoke access mid-period unless product explicitly overrides (not selected).
3. **Credit-pack refund:** On verified refund, deduct granted pack credits immediately; record `credit_transactions` type `refund` or `clawback`; fail-closed if subscription record cannot be matched.
4. **Idempotency:** All refund handlers must claim idempotency keys before mutation; duplicates return prior result.
5. **Mirrors:** Downgrade triggers `syncEntitlementMirrors()` to `free` (or target plan) — same engine as Phase 3.3; internals not redesigned.
6. **Observability:** All refund events persist through `webhook_events` status machine regardless of policy branch.

---

## 4. User cancellation contract

### Core invariant

> **A user must never lose entitlement merely because a remote provider cancellation request failed.**

Local state must not claim successful cancellation unless the provider confirms cancellation (or the subscription is provider-free).

### Who can cancel

| Actor | Scope | Path (future) |
|-------|-------|---------------|
| **Workspace owner / billing manager** | Own workspace subscription | `POST /workspace/v1/subscription/cancel` (Phase 4.3 — not implemented in 4.0) |
| **Admin / support** | Any workspace | Existing admin tooling; provider cancel via support workflow or future admin endpoint — must obey same remote-confirmation rule for paid providers |
| **Provider webhook** | System-initiated | Verified Paddle/PayPal cancel webhooks (`handlePaddleCancellation`, PayPal equivalent) |

### Required permission

- Workspace route: `workspace.billing.manage` capability (same as checkout/change).
- Admin route: existing admin authentication + audit identity.

### Provider-aware behavior

#### Paddle (paid, `paddle_subscription_id` present)

1. Client requests cancel (default: **at period end**).
2. Server calls Paddle `cancelSubscription` API (Phase 4.3 implementation).
3. **On API success:** Update local flags only:
   - `cancel_at_period_end: true`
   - `billing_status: cancel_scheduled`
   - Do **not** downgrade plan or credits yet.
4. **On API failure:** Return error to client; **no local cancellation flags**; entitlement unchanged.
5. **Webhook confirmation:** Verified `subscription.canceled` webhook completes lifecycle via existing `handlePaddleCancellation` (API re-verify subscription state). Immediate cancel only when Paddle confirms immediate termination.

#### PayPal (paid, provider subscription present)

- Same principle: remote PayPal cancel API must succeed before local `cancel_scheduled` flags.
- Webhook confirmation completes lifecycle when API-verified.

#### Free / non-provider (`provider: none` or no provider subscription ID)

- Local cancellation permitted directly:
  - At period end: set `cancel_at_period_end` + `billing_status: cancel_scheduled`.
  - Immediate: downgrade to `free` via authoritative subscription update + `syncEntitlementMirrors`.
- No remote call required.

### Access until period end

| Mode | Entitlement during period | After period end |
|------|---------------------------|------------------|
| **Cancel at period end** (default) | Full paid plan + credits until `current_period_end` | Downgrade to `free`; scheduler or webhook applies downgrade |
| **Immediate cancel** (explicit opt-in where provider supports) | Until provider confirms immediate termination | Downgrade on verified webhook or confirmed API response |

Default for user-facing cancel: **at period end**.

### Webhook completion

- Paddle: `subscription.canceled` / `subscription.cancelled` → verified API read → `handlePaddleCancellation`.
- PayPal: equivalent verified cancel event path.
- Webhook is the **authoritative completion** for provider-managed subscriptions; HTTP cancel initiates remote request and sets **scheduled** state only.

### Repeated cancellation requests

- If already `cancel_scheduled` with `cancel_at_period_end: true`: return **200 idempotent success** with current state; do not call provider again unless resuming.
- If already canceled/downgraded: return **409** or idempotent **200** with `already_canceled` — no double provider calls.
- Idempotency key scope: `cancel:{workspace_key}:{provider_subscription_id}` for provider API calls.

### Audit

- Every cancel attempt logs `logBillingAction` with `eventType: cancelled` or `cancel_scheduled`.
- Include: actor, workspace, provider, remote result, `atPeriodEnd` flag, idempotency key.
- Failed remote attempts log with `result: failed` and **no entitlement mutation**.

### Idempotency

- HTTP handler: idempotency key from client or derived from workspace + action.
- Provider API call: single flight per subscription cancel initiation.
- Webhook handler: existing event idempotency via `webhook_events` + fulfillment keys.

### Explicit non-goals (Phase 4.0)

- No HTTP route implementation.
- No provider API call implementation.
- No change to existing verified Paddle webhook cancel handler internals.

---

## 5. Admin workspace plan drift contract

### Decision: **Option A — Block direct `plan_slug` editing**

Admin workspace update (`updateAdminWorkspace`) must **not** accept `plan` / `plan_slug` mutations. Plan changes must use **`assignWorkspacePlan()`** via `POST /admin/plans/assign`.

### Why Option A over Option B

**Repository evidence:**

- `ENTITLEMENT_CONTRACT.md` declares `workspace_subscriptions.plan` authoritative; `workspaces.plan_slug` is a mirror.
- `assignWorkspacePlan()` (Phase 3.3) already enforces: required `reason`, override metadata, `syncEntitlementMirrors`, billing audit, and Paddle identity preservation.
- **Admin Console workflow:** Plan assignment is on **Admin → Plans** (`AdminPlansPage.jsx` → `POST /admin/v1/plans/assign`). The **Admin → Workspaces** page does not expose plan editing — the Edit action is a placeholder toast directing to PATCH for field updates; no plan form exists.
- `updateAdminWorkspace()` accepting `payload.plan` → `plan_slug` is an **API-only drift vector**, not a required operator workflow.

Option B (silent reroute) would hide misconfigured clients and make audit trails ambiguous (workspace PATCH vs plan assign). Option A fails closed and directs operators to the hardened path.

### Admin drift contract (normative)

1. `PATCH /admin/v1/workspaces/:id` rejects `plan` / `plan_slug` with **422** and message directing to `POST /admin/plans/assign`.
2. All plan changes go through `assignWorkspacePlan()` with required reason and entitlement sync.
3. `workspaces.plan_slug` is written only by `syncEntitlementMirrors()` or equivalent mirror sync — never directly by workspace admin PATCH.
4. Phase 4.5 implements Option A; Admin Console may add UX link from workspace drawer to Plans assign (optional, not required for 4.5 API contract).

---

## 6. Official Phase 4 roadmap

### In scope

| Sub-phase | Title | Objective |
|-----------|-------|-------------|
| **4.0** | Scope lock & product decisions | This document — **complete** |
| **4.1** | `billing_type` enforcement | Close `$0 paid-slug` bypass; checkout/change use authoritative `plans.billing_type` instead of `planIsPaid()` price heuristic |
| **4.2** | Refund / chargeback lifecycle | Implement Section 3 policy; Paddle first; PayPal parity where applicable |
| **4.3** | User cancellation | Provider-aware cancel; remote confirmation before local state; workspace HTTP endpoint only after provider integration is safe |
| **4.4** | Paddle subscription reconciliation | Handle verified `subscription.updated`; reconcile identity, status, plan, price, billing interval — **without replacing** `transaction.completed` activate/renew |
| **4.5** | Admin workspace plan drift protection | Implement Option A — block direct `plan_slug` edit; enforce assign workflow |
| **4.6** | Frontend yearly/monthly selector | UI sends `billingInterval: monthly \| yearly`; server-side price registry validation remains authoritative |
| **4.7** | Stripe / Lemon Squeezy hardening | Separate track; API-verified fulfillment; only if production-active or explicitly approved |

### Recommended implementation sequence

```
4.0 (locked) → 4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6 → 4.7 (conditional)
```

4.1 before 4.2: closes checkout bypass independent of refund work.  
4.3 before 4.4: cancellation semantics stabilize before reconciliation adds state transitions.  
4.6 after 4.1 (and ideally 4.4): frontend interval selector must not precede server enforcement certification.

### Deferred

| Item | Reason |
|------|--------|
| Stripe / Lemon Squeezy refund/cancel parity | Phase 4.7 — not production-verified |
| `upgradeSubscription()` HTTP exposure | Frozen per `UPGRADE_HTTP_DECISION.md` Option A+C |
| Runtime enforcement of `plans.limits.*` | Separate product/AI track |
| Per-plan feature cost overrides | Separate product/AI track |
| Removing hardcoded `PLAN_CREDITS` display map | Separate product/AI track |

### Out of scope (Phase 4 entirely)

- Free-plan AI limit changes (see Section 8)
- Paddle HMAC / transaction verification core redesign
- Entitlement sync engine internal redesign
- New migrations unless a sub-phase explicitly authorizes them
- `POST /workspace/v1/subscription/upgrade` route

---

## 7. Frozen architecture

Phase 4 **must not redesign** the following certified Phase 0 → 3.8 behaviors:

| Area | Frozen behavior |
|------|-----------------|
| Paddle webhook ingress | HMAC signature verification |
| Paddle fulfillment | Transaction API verification before entitlement mutation |
| PayPal fulfillment | Verified webhook + transaction verification architecture |
| Webhook persistence | Event status machine (`webhook_events`) |
| Activation / renewal | Idempotency claim-before-mutate pattern |
| Entitlement sync | `syncEntitlementMirrors()` engine internals |
| Paddle credit packs | Verified pack fulfillment + purchased-credit model |
| Scheduler | Paddle provider-managed subscription protection |
| Admin assign | `assignWorkspacePlan()` audit contract (reason, override metadata) |
| HTTP upgrade gate | No route exposing `upgradeSubscription()` |
| Price registry | Architecture + yearly/monthly resolution (Phase 3.8) |
| Checkout paid path | Paid activation only via verified webhook fulfillment |

Phase 4 may **extend** these systems (new event types, new routes, new guards) but not replace their core verification or idempotency models.

---

## 8. Free plan AI limits — separate track

**Not part of Phase 4 billing implementation.**

### Repository findings (locked)

| Control | Location | Enforced at runtime? |
|---------|----------|---------------------|
| `plans.credits` (Free ≈ 50) | Admin → Plans → Free → **Credits** | **Yes** — wallet quota + monthly reset |
| `plans.limits.aiRequests` / `imagesPerMonth` | Admin → Plans → Limits grid | **No** — catalog/display only |
| `platform_settings.credits.featureCosts` | Admin → Settings → Credits & Subscription | **Yes** — global burn rates (**all plans**) |

AI text and image generation share **`workspace_subscriptions.credits_balance`**; differentiation is via global feature costs (`ai_writer`, `ai_image`), not separate enforced monthly caps.

### Phase 4 boundary

- Do **not** modify free-plan credits, limits, or feature costs during Phase 4.
- Reducing Free consumption today: **Admin → Plans → Free → Credits** (operator action, no Phase 4 code).
- Separate **product/AI-credit track** required for: per-plan feature costs, runtime `plans.limits` enforcement, free-only text vs image caps.

---

## 9. Certification requirements

Every Phase 4 sub-phase (4.1 → 4.7) must:

1. **Preserve 289/289 baseline** — no regressions in existing billing tests.
2. **Add focused tests** — new behavior covered; no unrelated test churn.
3. **Pass full billing suite** — all files in `apps/api` billing test script.
4. **No unrelated modifications** — minimal diff scoped to sub-phase.
5. **Stop after its own final report** — sub-phase certification document before proceeding.
6. **Not auto-start the next sub-phase** — explicit authorization required.

### Billing test command (reference)

```powershell
cd apps/api; $env:NODE_ENV='test'
node --test src/services/billing/price-registry-sync.test.js src/services/billing/credit-pack-paddle.test.js src/services/billing/plans-assign.test.js src/services/billing/entitlement-sync.test.js src/services/billing/subscriptions-lifecycle.test.js src/services/billing/providers/paddle.test.js src/services/billing/providers/paddle-api-client.test.js src/services/billing/providers/paddle-environment.test.js src/services/billing/paddle-transaction-verification.test.js src/services/billing/paypal-transaction-verification.test.js src/services/billing/paypal-webhook-fulfillment.test.js src/services/billing/upgrade-subscription-gate.test.js src/services/billing/webhook-events.test.js src/services/billing/webhooks.test.js src/services/billing/control-plane.test.js src/services/billing/health-engine.test.js src/services/billing/billing-model.test.js src/services/billing/price-registry.test.js src/services/billing/providers/paypal.test.js
```

---

## Related documents

| Document | Role |
|----------|------|
| `ENTITLEMENT_CONTRACT.md` | Authoritative vs mirror entitlement hierarchy |
| `UPGRADE_HTTP_DECISION.md` | Internal-only `upgradeSubscription()` |
| Phase 4 Scope Definition (read-only audit) | Evidence base for this lock |

---

**Phase 4.1 has not started.** This document completes Phase 4.0 only.
