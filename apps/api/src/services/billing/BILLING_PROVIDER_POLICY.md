# Billing Provider Policy

**Status:** Active product policy  
**Date:** 2026-08-09  
**Supersedes:** Phase 4.7 implementation authorization only — does not rewrite Phase 4.0–4.6 certification or `PHASE_4_SCOPE_DECISIONS.md` historical record.

---

## Official supported providers

| Provider | Role | Implementation status |
|----------|------|------------------------|
| **Paddle** | **Primary** official billing provider | Certified — API-verified fulfillment, reconciliation, refunds, cancellation, yearly billing |
| **PayPal** | **Supported** official billing provider | Certified — API-verified fulfillment, refunds, cancellation |
| **Stripe** | Scaffolding only | Checkout scaffold; no API-verified fulfillment, refund parity, cancellation parity, or webhook hardening |
| **Lemon Squeezy** | Scaffolding only | Checkout scaffold; webhook verification not wired; no certified fulfillment path |

Paddle and PayPal are both **official** provider paths. The deployment selects **one** active runtime provider via Admin Control Plane (`platform_settings.payload.billing.provider`). The architecture does not run Paddle and PayPal simultaneously unless explicitly configured for failover (separate operational concern).

---

## Runtime provider selection

- **Active provider:** `platform_settings.payload.billing.provider` — set by Admin → Billing Providers → **Activate** (requires connected credentials and passing validation).
- **Enabled:** per-provider `billing.providers.{code}.enabled` toggle.
- **Configured / connected:** encrypted admin credentials or environment-variable fallback.
- **Checkout enabled:** global `billing.checkoutEnabled` — managed only from Billing Providers (single write authority).

Production provider selection is an **operational decision**. This document does not prescribe a production value and must not be used to override live configuration without operator action.

---

## Explicitly not authorized

- **Phase 4.7** — Stripe / Lemon Squeezy hardening is **intentionally skipped** under this policy.
- Stripe / Lemon Squeezy API verification, refund parity, cancellation parity, webhook hardening, yearly billing, or checkout hardening.
- New provider implementation files such as `stripe-transaction-verification.js`, `stripe-webhook-fulfillment.js`, `lemonsqueezy-transaction-verification.js`, `lemonsqueezy-webhook-fulfillment.js`.
- Stripe SDK dependencies.
- **Phase 4.8** — no sub-phase is defined or authorized beyond this policy lock.

---

## Frozen certified paths (unchanged by this policy)

Paddle and PayPal certified billing logic (webhook verification, transaction verification, fulfillment, reconciliation, idempotency, entitlement sync internals, scheduler core, price registry architecture, Phase 4.3–4.6 deliverables) remain frozen per their certification documents.

---

## Related documents

| Document | Role |
|----------|------|
| `PHASE_4_SCOPE_DECISIONS.md` | Historical Phase 4 roadmap (includes conditional 4.7 — superseded for implementation by this policy) |
| `PHASE_4_4_FINAL_CERTIFICATION.md` | Paddle reconciliation certification |
| `PHASE_4_5_FINAL_CERTIFICATION.md` | Admin plan drift guard certification |
| `PHASE_4_6_FINAL_CERTIFICATION.md` | Frontend billing interval selector certification |
| `ENTITLEMENT_CONTRACT.md` | Authoritative entitlement hierarchy |
